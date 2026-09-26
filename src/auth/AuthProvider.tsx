import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  makeRedirectUri,
  useAuthRequest,
  exchangeCodeAsync,
  type DiscoveryDocument,
} from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config';
import {
  clearCredentials,
  clearTokens,
  loadCredentials,
  loadTokens,
  saveCredentials,
  saveTokens,
  type Credentials,
  type TokenSet,
} from '@/auth/tokenStore';
import { ACTIVE_UNIT_KEY } from '@/units/storage';
import { demoIdToken, isDemo, loadDemoFlag, setDemo } from '@/api/demo';
import { startWebLogin, completeWebLogin } from '@/auth/webAuth';
import { parsePastedToken, refreshBridgeToken } from '@/auth/authToken';
import { headlessLogin } from '@/auth/headlessLogin';
import { setUnauthorizedHandler } from '@/api/client';
import { asyncStoragePersister } from '@/offline/queryClient';
import { clearCarHandoff } from '@/features/map/carHandoff';

loadDemoFlag();

WebBrowser.maybeCompleteAuthSession();

const discovery: DiscoveryDocument = {
  authorizationEndpoint: config.oidc.authorizationEndpoint,
  tokenEndpoint: config.oidc.tokenEndpoint,
};

/**
 * The access token lasts ~25 minutes and the server issues NO refresh token
 * (verified), so the only way to renew is a silent re-login with the saved
 * credentials. That costs four requests, so it happens only when needed: a
 * token about to lapse (within this margin) or one the server has rejected.
 */
const EXPIRY_SKEW_MS = 2 * 60_000;
/** While the app is open, check this often whether the token is about to lapse. */
const BACKGROUND_CHECK_MS = 60_000;
/** A login bounced back to the form is re-tried once before it counts. */
const BAD_CREDENTIALS_RETRY_MS = 3_000;

type AuthState = {
  ready: boolean;
  /** True whenever we hold credentials — stays true offline and across restarts. */
  isAuthenticated: boolean;
  tokens: TokenSet | null;
  signIn: () => Promise<void>;
  signInDemo: () => Promise<void>;
  /** Native username/password login (no browser). The credentials are always
   *  kept in the secure keychain so the session renews itself unattended. */
  signInWithPassword: (
    username: string,
    password: string,
    helpdesccode?: string,
  ) => Promise<void>;
  /** Whether credentials are saved for automatic re-login. */
  hasSavedCredentials: boolean;
  /** Set when the saved password stopped working and the user must sign in. */
  sessionMessage: string | null;
  /** Web login step 1: returns the PZŁ authorize URL to open. */
  beginWebLogin: () => Promise<string>;
  /** Web login step 2: exchange the pasted code/URL for tokens. */
  completeWebLogin: (input: string) => Promise<void>;
  /** Token-bridge login: paste an access token or oidc.user blob. */
  signInWithToken: (raw: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthState | null>(null);

function isRevoked(err: unknown): boolean {
  // Distinguish a truly revoked refresh token from a mere network failure.
  const msg = String((err as Error)?.message ?? err ?? '').toLowerCase();
  return msg.includes('invalid_grant') || msg.includes('invalid grant');
}

/** headlessLogin's "landed back on the login form" — wrong or changed password. */
function isBadCredentials(err: unknown): boolean {
  return String((err as Error)?.message ?? '').startsWith('Logowanie nie powiodło się');
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tokens, setTokens] = useState<TokenSet | null>(null);
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const tokensRef = useRef<TokenSet | null>(null);
  const credsRef = useRef<Credentials | null>(null);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  const redirectUri = makeRedirectUri({
    scheme: config.oidc.redirectScheme,
    path: config.oidc.redirectPath,
  });

  const [request, , promptAsync] = useAuthRequest(
    {
      clientId: config.oidc.clientId,
      scopes: [...config.oidc.scopes],
      redirectUri,
      usePKCE: true,
      responseType: 'code',
    },
    discovery,
  );

  /** Username of the account the cached data belongs to, once known. */
  const lastUsername = useRef<string | null>(null);

  const clearCachedData = useCallback(async () => {
    queryClient.clear();
    try {
      await asyncStoragePersister.removeClient();
      await AsyncStorage.removeItem(ACTIVE_UNIT_KEY);
    } catch {
      // Best effort; the in-memory cache is already gone.
    }
  }, [queryClient]);

  const persist = useCallback(async (t: TokenSet | null) => {
    tokensRef.current = t;
    setTokens(t);
    if (t) await saveTokens(t);
    else await clearTokens();
  }, []);

  useEffect(() => {
    Promise.all([loadTokens(), loadCredentials()]).then(([t, c]) => {
      tokensRef.current = t;
      credsRef.current = c;
      lastUsername.current = c?.username ?? null;
      setTokens(t);
      setHasSavedCredentials(!!c);
      setReady(true);
    });
  }, []);

  /**
   * Renew the access token, cheapest way first: a refresh token if this token
   * set has one (only some login paths do), else a silent headless re-login
   * with the saved credentials. Concurrent callers share one attempt.
   *
   * Never drops the session on a network error (woods-friendly): the stale
   * token is kept and renewal is tried again later. The session ends only
   * when renewal is impossible — no credentials and no refresh token — or
   * the saved password is rejected twice, i.e. it was changed.
   */
  const doRefresh = useCallback(async (): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const current = tokensRef.current;
    const creds = credsRef.current;
    if (!creds && !current?.refreshToken) return current?.accessToken ?? null;

    refreshInFlight.current = (async () => {
      try {
        if (current?.refreshToken) {
          try {
            const next = await refreshBridgeToken(current);
            if (next) {
              await persist(next);
              return next.accessToken;
            }
          } catch (err) {
            if (!creds) throw err;
            // Fall through to a full login with the saved credentials.
          }
        }
        if (!creds) return current?.accessToken ?? null;
        let next: TokenSet;
        try {
          next = await headlessLogin(creds.username, creds.password, creds.helpdesccode);
        } catch (err) {
          if (!isBadCredentials(err)) throw err;
          // One bounce can be the server hiccuping; two in a row is a password
          // that no longer works.
          await wait(BAD_CREDENTIALS_RETRY_MS);
          next = await headlessLogin(creds.username, creds.password, creds.helpdesccode);
        }
        await persist(next);
        return next.accessToken;
      } catch (err) {
        if (isBadCredentials(err) || isRevoked(err)) {
          credsRef.current = null;
          setHasSavedCredentials(false);
          await clearCredentials();
          setSessionMessage(
            'Hasło zostało zmienione lub jest nieprawidłowe — zaloguj się ponownie.',
          );
          await persist(null);
          return null;
        }
        // Offline / transient: keep the (possibly stale) token, retry later.
        return current?.accessToken ?? null;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    return refreshInFlight.current;
  }, [persist]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const current = tokensRef.current ?? (await loadTokens());
    if (!current) return null;
    const valid =
      !current.expiresAt || current.expiresAt - Date.now() > EXPIRY_SKEW_MS;
    if (valid) return current.accessToken;
    if (!onlineManager.isOnline()) return current.accessToken; // use stale offline
    return doRefresh();
  }, [doRefresh]);

  /**
   * The server rejected `rejected` (HTTP 401). Renew once and hand back the new
   * token for a single retry. If the token has already been replaced by a
   * concurrent renewal, that one is used without logging in again. With no way
   * to renew, the session is over and the app returns to the login screen.
   */
  const onUnauthorized = useCallback(
    async (rejected: string | null): Promise<string | null> => {
      const current = tokensRef.current;
      if (!current) return null;
      if (rejected && current.accessToken !== rejected) return current.accessToken;
      if (!credsRef.current && !current.refreshToken) {
        setSessionMessage('Sesja wygasła — zaloguj się ponownie.');
        await persist(null);
        return null;
      }
      const next = await doRefresh();
      if (next && next !== rejected) return next;
      // The server answered (it sent the 401), so this is not a lost
      // connection: a refresh token that no longer works, with no saved
      // password to fall back on, means the session really is over.
      if (!credsRef.current && tokensRef.current?.accessToken === rejected) {
        setSessionMessage('Sesja wygasła — zaloguj się ponownie.');
        await persist(null);
      }
      return null;
    },
    [doRefresh, persist],
  );

  useEffect(() => {
    setUnauthorizedHandler(onUnauthorized);
  }, [onUnauthorized]);

  // Keep the token fresh while the app is open: checked every minute, on
  // returning to the foreground and on reconnect, and renewed only when it
  // would lapse before the next check. Requests renew on their own too
  // (getAccessToken), so this just keeps that off the user's critical path.
  useEffect(() => {
    if (!ready) return;
    const canRenew = () => !!credsRef.current || !!tokensRef.current?.refreshToken;

    const maybeReauth = () => {
      const t = tokensRef.current;
      if (!t?.expiresAt || !canRenew() || !onlineManager.isOnline()) return;
      if (t.expiresAt - Date.now() < EXPIRY_SKEW_MS + BACKGROUND_CHECK_MS) {
        void doRefresh();
      }
    };

    const interval = setInterval(maybeReauth, BACKGROUND_CHECK_MS);
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') maybeReauth();
    });
    const onlineUnsub = onlineManager.subscribe(() => maybeReauth());
    maybeReauth();

    return () => {
      clearInterval(interval);
      appSub.remove();
      onlineUnsub();
    };
  }, [ready, hasSavedCredentials, tokens?.accessToken, doRefresh]);

  const signIn = useCallback(async () => {
    // Native OAuth via pzl://auth (the registered mobile redirect).
    if (!request) return;
    const result = await promptAsync();
    if (result.type !== 'success' || !result.params.code) return;
    const tokenResult = await exchangeCodeAsync(
      {
        clientId: config.oidc.clientId,
        code: result.params.code,
        redirectUri,
        extraParams: request.codeVerifier
          ? { code_verifier: request.codeVerifier }
          : undefined,
      },
      discovery,
    );
    await persist({
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      idToken: tokenResult.idToken,
      expiresAt: tokenResult.expiresIn
        ? Date.now() + tokenResult.expiresIn * 1000
        : undefined,
    });
  }, [request, promptAsync, redirectUri, persist]);

  const signInWithPassword = useCallback(
    async (username: string, password: string, helpdesccode = '') => {
      const next = await headlessLogin(username, password, helpdesccode);
      // A different account must not inherit the previous one's cached data.
      const previous = lastUsername.current ?? (await loadCredentials())?.username;
      if (previous && previous.toLowerCase() !== username.toLowerCase()) {
        await clearCachedData();
      }
      // Always remembered: the session renews itself and the user never sees
      // the login screen again unless the password changes.
      const creds: Credentials = { username, password, helpdesccode };
      credsRef.current = creds;
      lastUsername.current = username;
      await saveCredentials(creds);
      setHasSavedCredentials(true);
      setSessionMessage(null);
      await persist(next);
    },
    [persist, clearCachedData],
  );

  const beginWebLogin = useCallback(() => startWebLogin(), []);

  const completeWebLoginCb = useCallback(
    async (input: string) => {
      const tokens = await completeWebLogin(input);
      await persist(tokens);
    },
    [persist],
  );

  const signInWithToken = useCallback(
    async (raw: string) => {
      const parsed = parsePastedToken(raw);
      if (!parsed) {
        throw new Error(
          'Nie rozpoznano tokenu. Wklej access_token lub obiekt oidc.user.',
        );
      }
      await persist(parsed);
    },
    [persist],
  );

  const signInDemo = useCallback(async () => {
    setDemo(true);
    await persist({
      accessToken: 'demo-access-token',
      idToken: demoIdToken(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
    });
  }, [persist]);

  const signOut = useCallback(async () => {
    if (isDemo()) setDemo(false);
    credsRef.current = null;
    lastUsername.current = null;
    setHasSavedCredentials(false);
    setSessionMessage(null);
    await clearCredentials();
    await persist(null);
    // Nothing of this account may outlive the sign-out: cached screens, the
    // chosen koło, and the file that hands the session to Android Auto.
    await clearCachedData();
    clearCarHandoff();
  }, [persist, clearCachedData]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      isAuthenticated: !!tokens?.accessToken,
      tokens,
      signIn,
      signInDemo,
      signInWithPassword,
      hasSavedCredentials,
      sessionMessage,
      beginWebLogin,
      completeWebLogin: completeWebLoginCb,
      signInWithToken,
      signOut,
      getAccessToken,
    }),
    [
      ready,
      tokens,
      signIn,
      signInDemo,
      signInWithPassword,
      hasSavedCredentials,
      sessionMessage,
      beginWebLogin,
      completeWebLoginCb,
      signInWithToken,
      signOut,
      getAccessToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

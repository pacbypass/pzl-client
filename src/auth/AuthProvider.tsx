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
import {
  makeRedirectUri,
  useAuthRequest,
  exchangeCodeAsync,
  type DiscoveryDocument,
} from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { onlineManager } from '@tanstack/react-query';
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
import { demoIdToken, isDemo, loadDemoFlag, setDemo } from '@/api/demo';
import { startWebLogin, completeWebLogin } from '@/auth/webAuth';
import { parsePastedToken, refreshBridgeToken } from '@/auth/authToken';
import { headlessLogin } from '@/auth/headlessLogin';

loadDemoFlag();

WebBrowser.maybeCompleteAuthSession();

const discovery: DiscoveryDocument = {
  authorizationEndpoint: config.oidc.authorizationEndpoint,
  tokenEndpoint: config.oidc.tokenEndpoint,
};

const EXPIRY_SKEW_MS = 60_000;
// How often to check, and how far before the (~30-day) token expires to
// proactively re-login in the background.
const BACKGROUND_CHECK_MS = 5 * 60_000;
const REAUTH_WINDOW_MS = 24 * 60 * 60_000; // 1 day

type AuthState = {
  ready: boolean;
  /** True whenever we hold credentials — stays true offline and across restarts. */
  isAuthenticated: boolean;
  tokens: TokenSet | null;
  signIn: () => Promise<void>;
  signInDemo: () => Promise<void>;
  /** Native username/password login (no browser). `remember` stores credentials
   *  in the secure keychain for automatic re-login when the 30-day token lapses. */
  signInWithPassword: (
    username: string,
    password: string,
    remember: boolean,
    helpdesccode?: string,
  ) => Promise<void>;
  /** Whether credentials are saved for automatic re-login. */
  hasSavedCredentials: boolean;
  /** Forget saved credentials but stay signed in on the current token. */
  disableAutoLogin: () => Promise<void>;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [tokens, setTokens] = useState<TokenSet | null>(null);
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
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
      setTokens(t);
      setHasSavedCredentials(!!c);
      setReady(true);
    });
  }, []);

  /** Renew the access token. These PZŁ clients issue a ~30-day token and NO
   *  refresh token, so renewal = a silent headless re-login with saved
   *  credentials. Never drops the session on a network error (woods-friendly). */
  const doRefresh = useCallback(async (): Promise<string | null> => {
    const current = tokensRef.current;
    const creds = credsRef.current;
    if (!creds && !current?.refreshToken) return current?.accessToken ?? null;
    if (refreshInFlight.current) return refreshInFlight.current;

    refreshInFlight.current = (async () => {
      try {
        if (creds) {
          const next = await headlessLogin(
            creds.username,
            creds.password,
            creds.helpdesccode,
          );
          await persist(next);
          return next.accessToken;
        }
        // Fallback for any token set that does carry a refresh token.
        const next = await refreshBridgeToken(current!);
        if (next) await persist(next);
        return next?.accessToken ?? null;
      } catch (err) {
        if (isRevoked(err)) {
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

  // Background re-login: periodic, on foreground, and on reconnect. Only does
  // anything when we can renew unattended (saved credentials or a refresh token).
  useEffect(() => {
    if (!ready) return;
    const canRenew = () => !!credsRef.current || !!tokensRef.current?.refreshToken;

    const maybeReauth = () => {
      const t = tokensRef.current;
      if (!t || !canRenew() || !onlineManager.isOnline()) return;
      const soon = !t.expiresAt || t.expiresAt - Date.now() < REAUTH_WINDOW_MS;
      if (soon) void doRefresh();
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
    async (
      username: string,
      password: string,
      remember: boolean,
      helpdesccode = '',
    ) => {
      const next = await headlessLogin(username, password, helpdesccode);
      if (remember) {
        const creds: Credentials = { username, password, helpdesccode };
        credsRef.current = creds;
        await saveCredentials(creds);
        setHasSavedCredentials(true);
      } else {
        credsRef.current = null;
        await clearCredentials();
        setHasSavedCredentials(false);
      }
      await persist(next);
    },
    [persist],
  );

  const disableAutoLogin = useCallback(async () => {
    credsRef.current = null;
    setHasSavedCredentials(false);
    await clearCredentials();
  }, []);

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
    setHasSavedCredentials(false);
    await clearCredentials();
    await persist(null);
  }, [persist]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      isAuthenticated: !!tokens?.accessToken,
      tokens,
      signIn,
      signInDemo,
      signInWithPassword,
      hasSavedCredentials,
      disableAutoLogin,
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
      disableAutoLogin,
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

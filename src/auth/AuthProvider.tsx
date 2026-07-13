import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import {
  makeRedirectUri,
  useAuthRequest,
  exchangeCodeAsync,
  refreshAsync,
  type DiscoveryDocument,
} from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { onlineManager } from '@tanstack/react-query';
import { config } from '@/config';
import {
  clearTokens,
  loadTokens,
  saveTokens,
  type TokenSet,
} from '@/auth/tokenStore';
import { demoIdToken, isDemo, loadDemoFlag, setDemo } from '@/api/demo';
import { startWebLogin, completeWebLogin } from '@/auth/webAuth';
import { parsePastedToken, refreshBridgeToken } from '@/auth/authToken';

loadDemoFlag();

const IS_WEB = Platform.OS === 'web';

WebBrowser.maybeCompleteAuthSession();

const discovery: DiscoveryDocument = {
  authorizationEndpoint: config.oidc.authorizationEndpoint,
  tokenEndpoint: config.oidc.tokenEndpoint,
};

// Refresh a bit before expiry; also the periodic background cadence.
const EXPIRY_SKEW_MS = 60_000;
const BACKGROUND_REFRESH_MS = 4 * 60_000;

type AuthState = {
  ready: boolean;
  /** True whenever we hold credentials — stays true offline and across restarts. */
  isAuthenticated: boolean;
  tokens: TokenSet | null;
  signIn: () => Promise<void>;
  signInDemo: () => Promise<void>;
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
  const tokensRef = useRef<TokenSet | null>(null);
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
    loadTokens().then((t) => {
      tokensRef.current = t;
      setTokens(t);
      setReady(true);
    });
  }, []);

  /** Refresh the access token. Never drops credentials on a network error —
   *  only when the refresh token is genuinely revoked. */
  const doRefresh = useCallback(async (): Promise<string | null> => {
    const current = tokensRef.current;
    if (!current?.refreshToken) return current?.accessToken ?? null;
    if (refreshInFlight.current) return refreshInFlight.current;

    refreshInFlight.current = (async () => {
      try {
        // Token-bridge sessions (and web in general) refresh via a direct POST
        // to the CORS-open token endpoint, using the issuing client.
        if (current.clientId || IS_WEB) {
          const next = await refreshBridgeToken(current);
          if (next) await persist(next);
          return next?.accessToken ?? null;
        }
        const r = await refreshAsync(
          { clientId: config.oidc.clientId, refreshToken: current.refreshToken },
          discovery,
        );
        const next: TokenSet = {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken ?? current.refreshToken,
          idToken: r.idToken ?? current.idToken,
          expiresAt: r.expiresIn ? Date.now() + r.expiresIn * 1000 : undefined,
          clientId: current.clientId,
        };
        await persist(next);
        return next.accessToken;
      } catch (err) {
        if (isRevoked(err)) {
          await persist(null); // real logout: token revoked server-side
          return null;
        }
        // Offline / transient: keep the (possibly stale) token, try again later.
        return current.accessToken ?? null;
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

  // Background refresh: periodic, on foreground, and on reconnect.
  useEffect(() => {
    if (!ready || !tokens?.refreshToken) return;

    const maybeRefresh = () => {
      const t = tokensRef.current;
      if (!t?.refreshToken || !onlineManager.isOnline()) return;
      const soon = !t.expiresAt || t.expiresAt - Date.now() < BACKGROUND_REFRESH_MS;
      if (soon) void doRefresh();
    };

    const interval = setInterval(maybeRefresh, BACKGROUND_REFRESH_MS);
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') maybeRefresh();
    });
    const onlineUnsub = onlineManager.subscribe(() => maybeRefresh());
    maybeRefresh();

    return () => {
      clearInterval(interval);
      appSub.remove();
      onlineUnsub();
    };
  }, [ready, tokens?.refreshToken, doRefresh]);

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
    await persist(null);
  }, [persist]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      isAuthenticated: !!tokens?.accessToken,
      tokens,
      signIn,
      signInDemo,
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

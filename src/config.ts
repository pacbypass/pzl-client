import Constants from 'expo-constants';

/**
 * Backend configuration recovered from the shipped app (`assets/app.config` +
 * decompiled Hermes bundle). See REVERSE_ENGINEERING.md.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

export const config = {
  apiBaseUrl: extra.apiBaseUrl ?? 'https://api.systemkl2.pzlow.pl',
  authIssuer: extra.authIssuer ?? 'https://auth.systemkl2.pzlow.pl',
  geoBaseUrl: extra.geoBaseUrl ?? 'https://geo.systemkl2.pzlow.pl',
  mapProxyUrl:
    (extra.apiBaseUrl ?? 'https://api.systemkl2.pzlow.pl') + '/maps/proxy',

  oidc: {
    clientId: extra.oidcClientId ?? 'pzl-mobile-client',
    // Native redirect the shipped app registers: `pzl://signed-in`
    // (verified: pzl://signed-in → /login = registered; pzl://auth is rejected).
    redirectScheme: 'pzl',
    redirectPath: 'signed-in',
    // Exactly what the shipped mobile app requests.
    scopes: ['openid', 'profile', 'email'],
    authorizationEndpoint:
      (extra.authIssuer ?? 'https://auth.systemkl2.pzlow.pl') + '/oauth2/authorize',
    tokenEndpoint:
      (extra.authIssuer ?? 'https://auth.systemkl2.pzlow.pl') + '/oauth2/token',

    // Web login uses the official browser client + its registered redirect
    // (the auth server rejects any other redirect, incl. localhost). We drive
    // the PKCE flow ourselves and capture the code the user pastes back.
    web: {
      clientId: 'pzl-web-client',
      redirectUri: 'https://systemkl2.pzlow.pl/auth',
      scopes: ['openid', 'profile', 'email'],
    },
  },
} as const;

export type AppConfig = typeof config;

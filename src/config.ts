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
    // Our app uses a UNIQUE scheme (`pzlrev://`) so it does NOT collide with the
    // original PZŁ app, which registers `pzl://` (and uses `pzl://signed-in` as
    // its OAuth redirect). We log in headlessly via the web client + an https
    // redirect, so we never actually need a custom-scheme callback — this scheme
    // only exists for expo-router/deep-linking and must stay distinct from the
    // original app's `pzl://` to avoid an Android app-chooser collision.
    redirectScheme: 'pzlrev',
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

import * as Crypto from 'expo-crypto';
import { config } from '@/config';
import type { TokenSet } from '@/auth/tokenStore';

/**
 * Headless username/password login — no browser.
 *
 * The PZŁ server has no password grant, but its login is a plain Spring form
 * (`POST /login`, no CSRF) and the access token lasts ~30 days. So we drive the
 * authorization-code flow ourselves: prime a session, POST the credentials, and
 * let `fetch` follow the redirect chain to `https://systemkl2.pzlow.pl/auth?code=…`
 * — an https URL we read from `response.url` (the mobile client's `pzl://` redirect
 * isn't readable by fetch; the web client's https redirect is, and has no consent
 * gate). Verified end-to-end against the live server.
 *
 * Native only: on web the cross-origin `/login` POST is blocked by CORS.
 */

const web = config.oidc.web;
const loginUrl = `${config.authIssuer}/login`;

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function headlessLogin(
  username: string,
  password: string,
  helpdesccode = '',
): Promise<TokenSet> {
  const verifier = base64url(Crypto.getRandomBytes(32));
  const challenge = await challengeFor(verifier);
  const state = base64url(Crypto.getRandomBytes(8));

  // Built with URLSearchParams (reliable on RN); `new URL()` is not.
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: web.clientId,
    redirect_uri: web.redirectUri,
    scope: web.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_mode: 'query',
  });
  const authorizeUrl = `${config.oidc.authorizationEndpoint}?${authParams.toString()}`;

  // 1. Prime the auth session (sets JSESSIONID in the native cookie jar).
  await fetch(authorizeUrl, { method: 'GET' });

  // 2. Authenticate the session with the credentials.
  const form = new URLSearchParams({ username, password, helpdesccode });
  await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  // 3. Re-issue the authorize on the now-authenticated session. With a valid
  //    session this is a single 302 straight to `…/auth?code=…`, which fetch
  //    follows — so `response.url` carries the code. (Auto-following the
  //    login→continue→code chain in one go is unreliable; this isn't.)
  const res = await fetch(authorizeUrl, { method: 'GET' });
  const code = extractCode(res.url);
  if (!code) {
    // Landed on /login instead of the code URL → bad credentials.
    throw new Error('Logowanie nie powiodło się — sprawdź numer i hasło.');
  }

  // 3. Exchange the code for tokens.
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: web.redirectUri,
    client_id: web.clientId,
    code_verifier: verifier,
  });
  const tr = await fetch(config.oidc.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });
  if (!tr.ok) {
    throw new Error(`Wymiana kodu nie powiodła się (${tr.status}).`);
  }
  const j = (await tr.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: j.access_token,
    // Kept so a session can be renewed without logging in again — the phone
    // already knows how (authToken.ts), and the car app needs it to keep
    // working while the phone app is closed.
    refreshToken: j.refresh_token,
    idToken: j.id_token,
    expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    clientId: web.clientId,
  };
}

function extractCode(url: string | undefined): string | null {
  if (!url) return null;
  // Regex parse (no `new URL()` — unreliable on React Native).
  const m = url.match(/[?&]code=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

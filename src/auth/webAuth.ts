import * as Crypto from 'expo-crypto';
import { config } from '@/config';
import type { TokenSet } from '@/auth/tokenStore';

/**
 * Web login via the official browser client (`pzl-web-client`) and its
 * registered redirect (`https://systemkl2.pzlow.pl/auth`) — the auth server
 * rejects every other redirect (localhost included). We generate our own PKCE,
 * send the user to log in, they land on the registered redirect with `?code=…`,
 * and paste that URL/code back. We then exchange it directly (token endpoint is
 * CORS-open) with our verifier. The official SPA can't consume the code because
 * its `state` won't match ours, so the code survives for us to use.
 */

const PKCE_KEY = 'pzl.web.pkce';
const web = config.oidc.web;

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

/** Build the authorize URL and stash the PKCE verifier/state. */
export async function startWebLogin(): Promise<string> {
  const verifier = base64url(Crypto.getRandomBytes(32));
  const challenge = await challengeFor(verifier);
  const state = base64url(Crypto.getRandomBytes(16));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));

  const url = new URL(config.oidc.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', web.clientId);
  url.searchParams.set('redirect_uri', web.redirectUri);
  url.searchParams.set('scope', web.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('response_mode', 'query');
  return url.toString();
}

/** Extract an authorization code from a pasted full URL or a raw code string. */
function extractCode(input: string): { code: string; state?: string } | null {
  const s = input.trim();
  if (!s) return null;
  if (s.includes('code=') || s.includes('://') || s.startsWith('?')) {
    try {
      const q = s.includes('?') ? s.slice(s.indexOf('?') + 1) : s;
      const params = new URLSearchParams(q);
      const code = params.get('code');
      if (code) return { code, state: params.get('state') ?? undefined };
    } catch {
      /* fall through */
    }
  }
  // Looks like a bare code (no spaces, reasonably long).
  if (!/\s/.test(s) && s.length > 12) return { code: s };
  return null;
}

/** Exchange the pasted code for tokens. */
export async function completeWebLogin(input: string): Promise<TokenSet> {
  const parsed = extractCode(input);
  if (!parsed) throw new Error('Nie znaleziono kodu w podanym tekście.');

  const stashRaw = sessionStorage.getItem(PKCE_KEY);
  if (!stashRaw) throw new Error('Sesja logowania wygasła — zacznij od nowa.');
  const { verifier, state } = JSON.parse(stashRaw) as {
    verifier: string;
    state: string;
  };
  if (parsed.state && parsed.state !== state) {
    throw new Error('Niezgodny parametr state — wklej adres z właściwego logowania.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: parsed.code,
    redirect_uri: web.redirectUri,
    client_id: web.clientId,
    code_verifier: verifier,
  });
  const res = await fetch(config.oidc.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  sessionStorage.removeItem(PKCE_KEY);
  if (!res.ok) {
    throw new Error(`Wymiana kodu nie powiodła się (${res.status}). Kod mógł już wygasnąć — spróbuj ponownie.`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    clientId: web.clientId,
  };
}

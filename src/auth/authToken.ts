import { config } from '@/config';
import type { TokenSet } from '@/auth/tokenStore';

/**
 * "Token bridge" login. Since the PZŁ auth server only accepts the official
 * clients' registered redirect URIs (never localhost), we can't run the OAuth
 * redirect ourselves on web. Instead the user logs into the official web app
 * and pastes their token here; the API + token endpoint are CORS-open, so our
 * client can call the API directly and refresh the token itself.
 *
 * Accepts either:
 *  - the raw access-token JWT string, or
 *  - the full `oidc.user:…` localStorage object (with refresh_token), which
 *    also enables silent refresh.
 */

// Minimal base64url decoder (no atob/Buffer dependency, works under Hermes).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64UrlDecode(input: string): string {
  const s = input.replace(/-/g, '+').replace(/_/g, '/');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    if (ch === '=') break;
    const idx = B64.indexOf(ch);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  // Handle UTF-8 sequences produced above.
  try {
    return decodeURIComponent(
      out
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
  } catch {
    return out;
  }
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function clientIdFor(accessToken: string): string {
  const claims = decodeJwtPayload(accessToken);
  const azp = claims?.azp ?? claims?.aud ?? claims?.client_id;
  return typeof azp === 'string' ? azp : config.oidc.clientId;
}

function expiryFrom(accessToken: string, explicit?: number): number | undefined {
  if (explicit) return explicit > 1e12 ? explicit : explicit * 1000;
  const exp = decodeJwtPayload(accessToken)?.exp;
  return typeof exp === 'number' ? exp * 1000 : undefined;
}

/** Parse a pasted access token or oidc.user JSON blob into a TokenSet. */
export function parsePastedToken(raw: string): TokenSet | null {
  const input = raw.trim();
  if (!input) return null;

  if (input.startsWith('{')) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(input);
    } catch {
      return null;
    }
    const accessToken = (obj.access_token ?? obj.accessToken) as string | undefined;
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: (obj.refresh_token ?? obj.refreshToken) as string | undefined,
      idToken: (obj.id_token ?? obj.idToken) as string | undefined,
      expiresAt: expiryFrom(accessToken, obj.expires_at as number | undefined),
      clientId: clientIdFor(accessToken),
    };
  }

  // Bare JWT.
  if (input.split('.').length === 3) {
    return {
      accessToken: input,
      expiresAt: expiryFrom(input),
      clientId: clientIdFor(input),
    };
  }
  return null;
}

/** Refresh a token bridge session directly against the (CORS-open) token endpoint. */
export async function refreshBridgeToken(current: TokenSet): Promise<TokenSet | null> {
  if (!current.refreshToken) return current;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: current.clientId ?? config.oidc.clientId,
  });
  const res = await fetch(config.oidc.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`refresh failed ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? current.refreshToken,
    idToken: json.id_token ?? current.idToken,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
    clientId: current.clientId,
  };
}

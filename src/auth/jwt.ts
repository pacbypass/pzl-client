/** Decode a JWT payload (no verification — just to read claims client-side). */
export function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** The current user's person id, from the access token's `person_id` claim. */
export function personIdFromToken(accessToken?: string): number | undefined {
  const claims = decodeJwtPayload(accessToken);
  const pid = claims?.person_id;
  return pid != null ? Number(pid) : undefined;
}

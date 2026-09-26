import { config } from '@/config';
import { demoResponse, isDemo } from '@/api/demo';
import { addLog } from '@/api/requestLog';

export class ApiError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: unknown,
  ) {
    super(ApiError.messageFrom(status, url, body));
    this.name = 'ApiError';
  }

  /**
   * The PZŁ API returns two error shapes: RFC-7807 `{ title, detail }` for
   * validation errors, and a business envelope `{ errorMessage, severity }`
   * (often with HTTP 200/400). Surface whichever message is present.
   */
  static messageFrom(status: number, url: string, body: unknown): string {
    const b = body as Record<string, unknown> | null;
    const msg =
      (b?.errorMessage as string) ??
      (b?.detail as string) ??
      (b?.title as string);
    return msg ? `${msg} (${status})` : `API ${status} on ${url}`;
  }
}

/** A business-envelope error can arrive with an HTTP 2xx status. */
function isBusinessError(data: unknown): boolean {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { success?: unknown }).success === false &&
    'errorMessage' in (data as object)
  );
}

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

/** Wired up by AuthProvider so every request carries a fresh bearer token. */
export function setTokenProvider(fn: TokenProvider) {
  tokenProvider = fn;
}

/** Given the token the server rejected, returns a renewed one (or null). */
type UnauthorizedHandler = (rejected: string | null) => Promise<string | null>;

let unauthorizedHandler: UnauthorizedHandler = async () => null;

/**
 * Wired up by AuthProvider: a 401 renews the session and the request is sent
 * once more, so an expired token never surfaces as an error on screen.
 */
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  unauthorizedHandler = fn;
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  /** override base (e.g. geo server) */
  baseUrl?: string;
};

function buildUrl(path: string, opts: RequestOptions): string {
  const base = opts.baseUrl ?? config.apiBaseUrl;
  let url = path.startsWith('http') ? path : base + path;
  // Build query manually — React Native's `new URL()`/`searchParams` is unreliable.
  if (opts.query) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    if (parts.length) url += (url.includes('?') ? '&' : '?') + parts.join('&');
  }
  return url;
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (isDemo()) {
    // Small delay so loading states are visible; no network involved.
    await new Promise((r) => setTimeout(r, 150));
    return demoResponse(path, opts.method ?? 'GET', opts.body) as T;
  }

  const token = await tokenProvider();
  try {
    return await send<T>(path, opts, token);
  } catch (e) {
    // 401 = the request was refused before anything happened, so resending
    // it — writes included — cannot apply it twice.
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    const renewed = await unauthorizedHandler(token);
    if (!renewed || renewed === token) throw e;
    return send<T>(path, opts, renewed);
  }
}

async function send<T>(
  path: string,
  opts: RequestOptions,
  token: string | null,
): Promise<T> {
  const url = buildUrl(path, opts);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const method = opts.method ?? 'GET';
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    addLog({
      ts: started,
      method,
      url,
      status: res.status,
      ok: res.ok,
      durationMs: Date.now() - started,
      requestBody: opts.body,
      responseData: data,
    });

    if (!res.ok) throw new ApiError(res.status, url, data);
    // Some endpoints return the business-error envelope with HTTP 200.
    if (isBusinessError(data)) throw new ApiError(res.status, url, data);
    return data as T;
  } catch (e) {
    // Network/abort failure (no HTTP response) — ApiError was already logged above.
    if (!(e instanceof ApiError)) {
      addLog({
        ts: started,
        method,
        url,
        durationMs: Date.now() - started,
        requestBody: opts.body,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    throw e;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

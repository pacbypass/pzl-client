import { config } from '@/config';
import { demoResponse, isDemo } from '@/api/demo';

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
  const url = new URL(path.startsWith('http') ? path : base + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
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
  const url = buildUrl(path, opts);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) throw new ApiError(res.status, url, data);
  // Some endpoints return the business-error envelope with HTTP 200.
  if (isBusinessError(data)) throw new ApiError(res.status, url, data);
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

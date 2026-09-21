/**
 * Authenticated fetch helper for the local backend API.
 *
 * The server gates all /api routes with a per-startup random bearer token
 * (see server/auth.ts). Same-origin pages obtain the token once from the
 * bootstrap endpoint — which itself is protected by the server-side
 * Host/Origin allowlist, so foreign web pages can neither read the token
 * nor call the APIs.
 *
 * Static demo deployments (GitHub Pages / file://) have no backend: the
 * bootstrap fetch simply fails, requests proceed without a token, and the
 * callers' existing offline fallbacks take over.
 */

let cachedToken: string | null = null;
let inflight: Promise<string | null> | null = null;

/** Fetch (once) and cache the API bearer token. Returns null when no backend is reachable. */
export async function getAuthToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch('/api/auth/bootstrap');
        if (!res.ok) return null;
        const json = (await res.json().catch(() => null)) as { token?: unknown } | null;
        cachedToken = typeof json?.token === 'string' && json.token ? json.token : null;
        return cachedToken;
      } catch {
        return null;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/** Drop the cached token (e.g. after a 401 — the server likely restarted). */
export function invalidateAuthToken(): void {
  cachedToken = null;
}

async function withAuthHeader(init: RequestInit, token: string | null): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * fetch() with automatic bearer-token attachment. On a 401 the token is
 * re-bootstrapped once and the request retried (transparent recovery when
 * the backend restarts while the page stays open).
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let token = await getAuthToken();
  let res = await fetch(url, await withAuthHeader(init, token));

  if (res.status === 401) {
    invalidateAuthToken();
    token = await getAuthToken();
    res = await fetch(url, await withAuthHeader(init, token));
  }

  return res;
}

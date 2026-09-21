/**
 * Localhost trust-boundary hardening.
 *
 * Threat model: the server listens on localhost, where ANY webpage the user
 * visits could issue cross-origin requests (or attempt DNS-rebinding) to
 * reach hosts/settings/terminal APIs. Two independent layers stop this:
 *
 *  1. Host + Origin allowlist — only localhost/127.0.0.1/[::1] on known ports
 *     may talk to the API at all (defeats DNS rebinding and drive-by pages;
 *     requests without an Origin header are local non-browser clients such as
 *     curl, node scripts or Electron, which are allowed through).
 *  2. Per-startup random bearer token — handed out ONLY by the bootstrap
 *     endpoint (itself behind layer 1) and required on every other /api route
 *     and on the WebSocket handshake (?token=...). Simple cross-site form
 *     POSTs that skip CORS preflight still lack the token and get 401.
 *
 * Local processes running AS THE SAME USER can still read the token (file
 * `server_token` in the data dir, mode 0600). That is intentional: they could
 * equally read SSH keys directly. Encrypted secrets are protected separately
 * by the optional master password (see storage.ts).
 */
import crypto from 'crypto';
import type { RequestHandler } from 'express';
import type { IncomingMessage } from 'http';

export interface AuthContext {
  /** Per-startup random bearer token. */
  token: string;
  /** Main server port plus allowed frontend dev-server ports (e.g. vite 5173). */
  allowedPorts: number[];
}

export const BOOTSTRAP_PATH = '/api/auth/bootstrap';

export function generateAuthToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Constant-time token comparison (length-safe). */
export function isTokenEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Host header must be a loopback address on one of the allowed ports. */
export function isAllowedHost(hostHeader: unknown, allowedPorts: number[]): boolean {
  if (typeof hostHeader !== 'string' || !hostHeader) return false;
  const h = hostHeader.toLowerCase();
  for (const p of allowedPorts) {
    if (h === `localhost:${p}` || h === `127.0.0.1:${p}` || h === `[::1]:${p}`) return true;
  }
  return false;
}

/**
 * Origin allowlist. An ABSENT Origin means a non-browser local client
 * (curl / node / Electron) and is permitted; a PRESENT Origin must be one of
 * the local loopback origins.
 */
export function isAllowedOrigin(origin: unknown, allowedPorts: number[]): boolean {
  if (origin === undefined || origin === null || origin === '') return true;
  if (typeof origin !== 'string') return false;
  for (const p of allowedPorts) {
    if (origin === `http://localhost:${p}` || origin === `http://127.0.0.1:${p}`) return true;
  }
  return false;
}

function isBearerValid(header: unknown, token: string): boolean {
  if (typeof header !== 'string') return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? isTokenEqual(m[1], token) : false;
}

/**
 * Express gate for every request:
 *  - Host/Origin allowlist first (all paths, including static files)
 *  - GET /api/auth/bootstrap → returns the token (protected by the allowlist)
 *  - all other /api/* → require a valid Bearer token
 */
export function createAuthMiddleware(ctx: AuthContext): RequestHandler {
  return (req, res, next) => {
    if (!isAllowedHost(req.headers.host, ctx.allowedPorts)) {
      res
        .status(403)
        .json({ success: false, error: 'Forbidden: 非法 Host 头（疑似 DNS rebinding）' });
      return;
    }
    if (!isAllowedOrigin(req.headers.origin, ctx.allowedPorts)) {
      res.status(403).json({ success: false, error: 'Forbidden: 跨域来源被拒绝' });
      return;
    }

    if (req.path === BOOTSTRAP_PATH) {
      if (req.method !== 'GET') {
        res.status(405).json({ success: false, error: 'Method Not Allowed' });
        return;
      }
      res.json({ success: true, token: ctx.token });
      return;
    }

    if (req.path.startsWith('/api/')) {
      if (!isBearerValid(req.headers.authorization, ctx.token)) {
        res.status(401).json({ success: false, error: 'Unauthorized: 缺少或无效的访问令牌' });
        return;
      }
    }

    next();
  };
}

/**
 * WebSocket handshake check: same Host/Origin allowlist plus the token in the
 * `?token=` query parameter (browsers cannot set headers on WS handshakes).
 */
export function checkWsAuth(req: IncomingMessage, ctx: AuthContext): boolean {
  if (!isAllowedHost(req.headers.host, ctx.allowedPorts)) return false;
  if (!isAllowedOrigin(req.headers.origin, ctx.allowedPorts)) return false;
  let tokenParam: string | null;
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    tokenParam = url.searchParams.get('token');
  } catch {
    return false;
  }
  return tokenParam !== null && isTokenEqual(tokenParam, ctx.token);
}

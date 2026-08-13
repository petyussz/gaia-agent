import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { config } from './config.ts';

const COOKIE_NAME = 'gaia_auth';

/**
 * Minimal `Cookie:` header parser.
 *
 * Express 5 does not parse cookies and we need exactly one value, so a dependency would be a
 * poor trade. Only the first occurrence of a name wins, matching browser semantics.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Constant-time comparison of two secrets.
 *
 * Both sides are hashed first so the buffers are always 32 bytes; `timingSafeEqual` throws on
 * length mismatch, and an early throw would itself leak the length of the expected token.
 */
function secretsMatch(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export function authRequired(): boolean {
  return config.accessToken !== '';
}

export function isAuthenticated(req: Request): boolean {
  if (!authRequired()) return true;
  const presented = readCookie(req.headers.cookie, COOKIE_NAME);
  return presented !== null && secretsMatch(presented, config.accessToken);
}

export function grantSession(res: Response): void {
  res.cookie(COOKIE_NAME, config.accessToken, {
    httpOnly: true,
    // Strict is doing double duty: it is the CSRF defence for POST /api/turn. The browser will
    // not attach this cookie to any request initiated from another site, so a hostile page on
    // the LAN cannot drive the agent even though it can reach the port.
    sameSite: 'strict',
    // Deliberately NOT `secure`. The app is served over plain http on a LAN address; a Secure
    // cookie would simply never be stored and auth would appear silently broken.
    secure: false,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function revokeSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Second CSRF layer, independent of SameSite.
 *
 * The API is same-origin by design, so a cross-origin `Origin` header on a mutating request is
 * never legitimate. Requests with no `Origin` at all (curl, native clients) are allowed through
 * — they carry no ambient cookie authority in a browser sense.
 */
export function sameOriginOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (origin === undefined) {
    next();
    return;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    res.status(403).json({ error: 'Bad Origin header.' });
    return;
  }

  if (originHost !== req.headers.host) {
    res.status(403).json({ error: 'Cross-origin request refused.' });
    return;
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Authentication required.' });
}

export function attemptLogin(token: unknown, res: Response): boolean {
  if (!authRequired()) return true;
  if (typeof token !== 'string' || token === '') return false;
  if (!secretsMatch(token, config.accessToken)) return false;
  grantSession(res);
  return true;
}

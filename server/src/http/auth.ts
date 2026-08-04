import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'node:http';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Session handling.
 *
 * The dashboard has exactly one operator account, so there is no user store —
 * credentials are an env-provided username and bcrypt hash. Sessions are signed
 * JWTs kept in an httpOnly, SameSite=Strict cookie: httpOnly puts the token out
 * of reach of any XSS in the SPA, and SameSite=Strict is enough CSRF protection
 * for an API that only ever accepts JSON from its own origin.
 */

export const SESSION_COOKIE = 'etl_session';

interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

export function issueToken(username: string): string {
  return jwt.sign({ sub: username }, env.SESSION_SECRET, {
    expiresIn: `${env.SESSION_TTL_HOURS}h`,
    issuer: 'etlegacy-dashboard',
  });
}

export function verifyToken(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, env.SESSION_SECRET, {
      issuer: 'etlegacy-dashboard',
    }) as SessionClaims;
  } catch {
    return null;
  }
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  // Always run the bcrypt compare, even for an unknown username, so response
  // time does not reveal whether the username was right.
  const hash = env.ADMIN_PASSWORD_HASH;
  const passwordOk = await bcrypt.compare(password, hash).catch((err) => {
    logger.error({ err }, 'bcrypt comparison failed — is ADMIN_PASSWORD_HASH a valid hash?');
    return false;
  });
  return passwordOk && timingSafeEqual(username, env.ADMIN_USERNAME);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.COOKIE_SECURE,
    maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1_000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: { username: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue' } });
    return;
  }

  const claims = verifyToken(token);
  if (!claims) {
    clearSessionCookie(res);
    res.status(401).json({ error: { code: 'session_expired', message: 'Your session has expired' } });
    return;
  }

  req.user = { username: claims.sub };
  next();
}

/**
 * Authenticates a WebSocket upgrade.
 *
 * Browsers cannot set headers on a WebSocket handshake, but they do send
 * cookies, so the same session cookie is reused here rather than inventing a
 * second token scheme.
 */
export function authenticateUpgrade(req: IncomingMessage): { username: string } | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== SESSION_COOKIE) continue;
    const claims = verifyToken(decodeURIComponent(rest.join('=')));
    return claims ? { username: claims.sub } : null;
  }
  return null;
}

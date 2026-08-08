import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'node:http';
import { env } from '../env.js';
import * as credentials from '../services/credentials.js';

/**
 * Session handling.
 *
 * Sessions are signed JWTs kept in an httpOnly, SameSite=Strict cookie:
 * httpOnly puts the token out of reach of any XSS in the SPA, and
 * SameSite=Strict is enough CSRF protection for an API that only ever accepts
 * JSON from its own origin.
 *
 * A valid signature is not sufficient on its own. Every request also re-checks
 * that the account still exists, because a token stays valid for hours after an
 * administrator is removed and revocation that takes until tomorrow is not
 * revocation.
 */

export const SESSION_COOKIE = 'etl_session';

interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

export function issueToken(username: string): string {
  return jwt.sign({ sub: username }, credentials.sessionSecret(), {
    expiresIn: `${env.SESSION_TTL_HOURS}h`,
    issuer: 'etl-control-panel',
  });
}

export function verifyToken(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, credentials.sessionSecret(), {
      issuer: 'etl-control-panel',
    }) as SessionClaims;
  } catch {
    return null;
  }
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  return credentials.verify(username, password);
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

  if (!credentials.exists(claims.sub)) {
    clearSessionCookie(res);
    res.status(401).json({
      error: { code: 'account_removed', message: 'This account no longer exists' },
    });
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
    if (!claims || !credentials.exists(claims.sub)) return null;
    return { username: claims.sub };
  }
  return null;
}

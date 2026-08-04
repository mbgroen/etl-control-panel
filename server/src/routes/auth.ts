import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../env.js';
import {
  clearSessionCookie,
  issueToken,
  requireAuth,
  setSessionCookie,
  verifyCredentials,
} from '../http/auth.js';
import { ApiError, asyncHandler } from '../http/errors.js';
import { logger } from '../logger.js';

export const authRouter = Router();

/**
 * Brute-force protection on the only unauthenticated write endpoint. The window
 * is per-IP; on a LAN that is per-machine, which is the right granularity for a
 * single-operator dashboard.
 */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' } },
});

const credentialsSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = credentialsSchema.parse(req.body);

    if (!(await verifyCredentials(username, password))) {
      logger.warn({ username, ip: req.ip }, 'failed sign-in attempt');
      throw new ApiError(401, 'invalid_credentials', 'Incorrect username or password');
    }

    setSessionCookie(res, issueToken(username));
    logger.info({ username, ip: req.ip }, 'operator signed in');
    res.json({ user: { username }, expiresInHours: env.SESSION_TTL_HOURS });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

/** Cheap endpoint the SPA calls on boot to decide between app and login screen. */
authRouter.get('/session', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

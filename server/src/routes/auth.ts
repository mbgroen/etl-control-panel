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
import * as credentials from '../services/credentials.js';

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

/**
 * Tells the SPA whether to render the setup wizard or the login form.
 *
 * Unauthenticated by necessity — it is what the browser asks before it has any
 * credentials — and deliberately leaks nothing beyond "does an account exist".
 */
authRouter.get('/status', (_req, res) => {
  res.json({
    needsSetup: !credentials.isConfigured(),
    managedByEnvironment: credentials.managedByEnvironment(),
    minPasswordLength: credentials.MIN_PASSWORD_LENGTH,
  });
});

const setupSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dots, dashes or underscores'),
  password: z.string().min(1).max(512),
});

/**
 * First-run account creation.
 *
 * Rate-limited like login, and refuses once an account exists — so it cannot be
 * used to take over a configured dashboard. There is intentionally no
 * unauthenticated password reset; recovery means deleting the credential store
 * on the host, which requires access to the host.
 */
authRouter.post(
  '/setup',
  loginLimiter,
  asyncHandler(async (req, res) => {
    if (credentials.isConfigured()) {
      throw new ApiError(
        409,
        'already_configured',
        'A dashboard account already exists. Sign in instead.',
      );
    }

    const { username, password } = setupSchema.parse(req.body);
    const account = await credentials.createAccount(username, password);

    // Sign the operator straight in: making them re-type what they just chose
    // adds a failure point and no security.
    setSessionCookie(res, issueToken(account.username));
    logger.info({ username: account.username, ip: req.ip }, 'first-run setup completed');

    res.status(201).json({ user: { username: account.username } });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = credentialsSchema.parse(req.body);

    if (!credentials.isConfigured()) {
      throw new ApiError(
        409,
        'needs_setup',
        'No dashboard account exists yet. Reload the page to create one.',
      );
    }

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
  res.json({ user: req.user, managedByEnvironment: credentials.managedByEnvironment() });
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(1).max(512),
});

authRouter.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);
    await credentials.changePassword(currentPassword, newPassword);

    // Re-issue the session: the secret is unchanged, but this refreshes expiry
    // so a password change does not leave a stale cookie about to lapse.
    setSessionCookie(res, issueToken(credentials.username()));
    res.json({ ok: true });
  }),
);

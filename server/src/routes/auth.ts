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

    // Carry the stored spelling, so a session shows the account as created
    // rather than however it was typed at the login screen.
    const canonical = credentials.canonicalUsername(username);
    setSessionCookie(res, issueToken(canonical));
    logger.info({ username: canonical, ip: req.ip }, 'operator signed in');
    res.json({ user: { username: canonical }, expiresInHours: env.SESSION_TTL_HOURS });
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

/**
 * Administrator accounts.
 *
 * Every account has the same rights — there are no roles, because a dashboard
 * that can restart the game server and holds the Docker socket has only one
 * meaningful level of access. What this adds is being able to give a second
 * person their own credentials instead of sharing one password.
 */
authRouter.get('/accounts', requireAuth, (_req, res) => {
  res.json({
    accounts: credentials.list(),
    managedByEnvironment: credentials.managedByEnvironment(),
    minPasswordLength: credentials.MIN_PASSWORD_LENGTH,
  });
});

const newAccountSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dots, dashes or underscores'),
  password: z.string().min(1).max(512),
});

authRouter.post(
  '/accounts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { username, password } = newAccountSchema.parse(req.body);
    const account = await credentials.addAccount(username, password);
    logger.info({ username, by: req.user?.username }, 'administrator added');
    res.status(201).json({ account });
  }),
);

authRouter.delete(
  '/accounts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = z.string().min(1).max(64).parse(req.params.id);
    await credentials.removeAccount(id, req.user?.username ?? '');
    res.status(204).end();
  }),
);

authRouter.post(
  '/accounts/:id/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = z.string().min(1).max(64).parse(req.params.id);
    const { password } = z.object({ password: z.string().min(1).max(512) }).parse(req.body);
    const account = await credentials.resetPassword(id, password);
    logger.info({ username: account.username, by: req.user?.username }, 'password reset');
    res.json({ account });
  }),
);

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(1).max(512),
});

authRouter.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);
    const username = req.user?.username ?? '';
    await credentials.changePassword(username, currentPassword, newPassword);

    // Re-issue the session: the secret is unchanged, but this refreshes expiry
    // so a password change does not leave a stale cookie about to lapse.
    setSessionCookie(res, issueToken(username));
    res.json({ ok: true });
  }),
);

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Operator credentials.
 *
 * Two ways to configure them, in priority order:
 *
 *  1. Environment (`ADMIN_PASSWORD_HASH` + `SESSION_SECRET`) — declarative, and
 *     the right choice when the deployment is managed as code.
 *  2. First-run setup in the browser, persisted to the state directory — the
 *     right choice for a WebUI-only install where running a CLI to generate a
 *     bcrypt hash is a real barrier.
 *
 * The session secret is generated and persisted when absent, so sessions
 * survive container restarts without the operator having to invent a random
 * string. It is stored 0600 alongside the password hash.
 */

const STORE_FILE = path.join(env.STATE_PATH, 'credentials.json');

interface StoredCredentials {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  createdAt: string;
}

const BCRYPT_COST = 12;
/**
 * Long enough that guessing is hopeless, short enough that people will use it.
 *
 * Eight is the floor here rather than a compromise: the hash is bcrypt at cost
 * 12 and sign-in is rate limited, so an online guessing attack is the only
 * realistic one and it is far too slow to matter. A longer minimum mostly buys
 * password reuse and sticky notes.
 */
export const MIN_PASSWORD_LENGTH = 8;

let cache: StoredCredentials | null = null;
let loaded = false;

async function readStore(): Promise<StoredCredentials | null> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as StoredCredentials;
    if (
      typeof parsed.username === 'string' &&
      typeof parsed.passwordHash === 'string' &&
      typeof parsed.sessionSecret === 'string'
    ) {
      return parsed;
    }
    logger.warn({ file: STORE_FILE }, 'credential store is malformed — ignoring it');
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err }, 'could not read the credential store');
    }
    return null;
  }
}

async function writeStore(credentials: StoredCredentials): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  const temp = `${STORE_FILE}.tmp`;
  // 0600 before the rename, so the file is never briefly world-readable.
  await fs.writeFile(temp, JSON.stringify(credentials, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, STORE_FILE);
  cache = credentials;
}

/**
 * Resolves credentials at boot.
 *
 * Environment values win when present: an operator who has declared them in
 * compose expects those to be authoritative, not silently shadowed by whatever
 * a previous first-run setup wrote to disk.
 */
export async function initialize(): Promise<void> {
  const stored = await readStore();

  if (env.ADMIN_PASSWORD_HASH) {
    cache = {
      username: env.ADMIN_USERNAME,
      passwordHash: env.ADMIN_PASSWORD_HASH,
      // Fall back to a persisted secret so sessions survive restarts even when
      // only the password was supplied by the environment.
      sessionSecret: env.SESSION_SECRET || stored?.sessionSecret || (await persistedSecret(stored)),
      createdAt: stored?.createdAt ?? new Date().toISOString(),
    };
    loaded = true;
    logger.info('using dashboard credentials from the environment');
    return;
  }

  cache = stored;
  loaded = true;

  if (!cache) {
    logger.warn(
      'No dashboard account exists yet. Open the dashboard in a browser to create one. ' +
        'Until you do, anyone who can reach this port can claim it — complete setup now, ' +
        'or set ADMIN_PASSWORD_HASH in the environment instead.',
    );
  }
}

/** Generates a session secret and persists it so it is stable across restarts. */
async function persistedSecret(stored: StoredCredentials | null): Promise<string> {
  if (stored?.sessionSecret) return stored.sessionSecret;

  const secret = randomBytes(32).toString('hex');
  try {
    await writeStore({
      username: env.ADMIN_USERNAME,
      passwordHash: env.ADMIN_PASSWORD_HASH,
      sessionSecret: secret,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Not fatal: the dashboard still works, but everyone is signed out on restart.
    logger.warn({ err }, 'could not persist a session secret — sessions will not survive a restart');
  }
  return secret;
}

export function isConfigured(): boolean {
  return cache !== null;
}

export function assertLoaded(): void {
  if (!loaded) throw new Error('Credentials accessed before initialize() was called');
}

export function sessionSecret(): string {
  assertLoaded();
  // Before setup there are no sessions to sign; a random per-process value keeps
  // token verification total without leaking a predictable key.
  return cache?.sessionSecret ?? EPHEMERAL_SECRET;
}

const EPHEMERAL_SECRET = randomBytes(32).toString('hex');

export function username(): string {
  return cache?.username ?? env.ADMIN_USERNAME;
}

export async function verify(candidateUser: string, candidatePassword: string): Promise<boolean> {
  if (!cache) return false;

  const passwordOk = await bcrypt.compare(candidatePassword, cache.passwordHash).catch((err) => {
    logger.error({ err }, 'bcrypt comparison failed — is the stored password hash valid?');
    return false;
  });

  return passwordOk && timingSafeEqual(candidateUser, cache.username);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class SetupError extends Error {
  constructor(
    message: string,
    readonly kind: 'already-configured' | 'weak-password',
  ) {
    super(message);
    this.name = 'SetupError';
  }
}

/**
 * Creates the operator account during first-run setup.
 *
 * Refuses once an account exists, so this cannot be used to reset a forgotten
 * password — that path is deliberately manual (delete the store file), because
 * an unauthenticated password-reset endpoint is a backdoor.
 */
export async function createAccount(
  newUsername: string,
  newPassword: string,
): Promise<{ username: string }> {
  if (isConfigured()) {
    throw new SetupError('A dashboard account already exists', 'already-configured');
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new SetupError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'weak-password',
    );
  }

  const credentials: StoredCredentials = {
    username: newUsername,
    passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST),
    sessionSecret: randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };

  await writeStore(credentials);
  logger.info({ username: newUsername }, 'dashboard account created via first-run setup');

  return { username: newUsername };
}

/** Changes the password of the existing account. Requires the current one. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!cache) throw new SetupError('No account is configured', 'already-configured');
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new SetupError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'weak-password',
    );
  }
  if (!(await verify(cache.username, currentPassword))) {
    throw new SetupError('Current password is incorrect', 'weak-password');
  }
  if (env.ADMIN_PASSWORD_HASH) {
    throw new SetupError(
      'The password is set through ADMIN_PASSWORD_HASH in the environment. Change it there.',
      'already-configured',
    );
  }

  await writeStore({
    ...cache,
    passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST),
  });
  logger.info('dashboard password changed');
}

/** True when the environment owns the credentials, so the UI can say so. */
export function managedByEnvironment(): boolean {
  return env.ADMIN_PASSWORD_HASH !== '';
}

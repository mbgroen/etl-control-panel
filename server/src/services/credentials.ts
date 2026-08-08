import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Operator accounts.
 *
 * Two ways to configure them, in priority order:
 *
 *  1. Environment (`ADMIN_PASSWORD_HASH` + `SESSION_SECRET`) — declarative, and
 *     the right choice when the deployment is managed as code. It describes one
 *     account, so account management is unavailable in that mode: the file is
 *     the source of truth and the control panel must not fight it.
 *  2. First-run setup in the browser, persisted to the state directory — the
 *     right choice for a WebUI-only install where running a CLI to generate a
 *     bcrypt hash is a real barrier.
 *
 * The store holds several accounts. It began as one, and a v1 file is migrated
 * on read rather than requiring anything of an existing installation.
 *
 * The session secret is shared by all accounts, generated and persisted when
 * absent so sessions survive container restarts. It is stored 0600 alongside
 * the password hashes.
 */

const STORE_FILE = path.join(env.STATE_PATH, 'credentials.json');

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

export interface Account {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

/** An account as the API reports it — never with the hash. */
export interface PublicAccount {
  id: string;
  username: string;
  createdAt: string;
}

interface Store {
  version: 2;
  sessionSecret: string;
  accounts: Account[];
}

/** The shape written before multiple accounts existed. */
interface LegacyStore {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  createdAt?: string;
}

let cache: Store | null = null;
let loaded = false;

const EPHEMERAL_SECRET = randomBytes(32).toString('hex');

/**
 * A valid bcrypt hash of a value nobody knows.
 *
 * Compared against when the username does not exist, so a sign-in attempt for
 * an unknown account takes the same time as one for a known account. Without
 * it, response time reveals which usernames are real.
 */
const DECOY_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_COST);

const publicView = (account: Account): PublicAccount => ({
  id: account.id,
  username: account.username,
  createdAt: account.createdAt,
});

function migrate(parsed: unknown): Store | null {
  const candidate = parsed as Partial<Store> & Partial<LegacyStore>;
  if (!candidate || typeof candidate.sessionSecret !== 'string') return null;

  if (Array.isArray(candidate.accounts)) {
    const accounts = candidate.accounts.filter(
      (account): account is Account =>
        typeof account?.id === 'string' &&
        typeof account.username === 'string' &&
        typeof account.passwordHash === 'string',
    );
    return { version: 2, sessionSecret: candidate.sessionSecret, accounts };
  }

  // v1: a single account stored inline.
  if (typeof candidate.username === 'string' && typeof candidate.passwordHash === 'string') {
    logger.info('migrating the credential store to the multi-account format');
    return {
      version: 2,
      sessionSecret: candidate.sessionSecret,
      accounts: [
        {
          id: randomUUID(),
          username: candidate.username,
          passwordHash: candidate.passwordHash,
          createdAt: candidate.createdAt ?? new Date().toISOString(),
        },
      ],
    };
  }

  return null;
}

async function readStore(): Promise<Store | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
    const store = migrate(parsed);
    if (!store) {
      logger.warn({ file: STORE_FILE }, 'credential store is malformed — ignoring it');
      return null;
    }
    return store;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err }, 'could not read the credential store');
    }
    return null;
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  const temp = `${STORE_FILE}.tmp`;
  // 0600 before the rename, so the file is never briefly world-readable.
  await fs.writeFile(temp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, STORE_FILE);
  cache = store;
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
      version: 2,
      sessionSecret:
        env.SESSION_SECRET || stored?.sessionSecret || (await persistedSecret(stored)),
      accounts: [
        {
          id: 'environment',
          username: env.ADMIN_USERNAME,
          passwordHash: env.ADMIN_PASSWORD_HASH,
          createdAt: stored?.accounts[0]?.createdAt ?? new Date().toISOString(),
        },
      ],
    };
    loaded = true;
    logger.info('using control panel credentials from the environment');
    return;
  }

  cache = stored;
  loaded = true;

  // A store that exists but holds no accounts is the same situation as no store
  // at all: setup has to run, or nobody can get in.
  if (!cache || cache.accounts.length === 0) {
    cache = null;
    logger.warn(
      'No control panel account exists yet. Open the control panel in a browser to create one. ' +
        'Until you do, anyone who can reach this port can claim it — complete setup now, ' +
        'or set ADMIN_PASSWORD_HASH in the environment instead.',
    );
    return;
  }

  // Rewrite a migrated v1 file so the next boot does not migrate again.
  if (stored) await writeStore(cache).catch(() => undefined);
}

/** Generates a session secret and persists it so it is stable across restarts. */
async function persistedSecret(stored: Store | null): Promise<string> {
  if (stored?.sessionSecret) return stored.sessionSecret;

  const secret = randomBytes(32).toString('hex');
  try {
    await writeStore({ version: 2, sessionSecret: secret, accounts: stored?.accounts ?? [] });
  } catch (err) {
    // Not fatal: the control panel still works, but everyone is signed out on restart.
    logger.warn({ err }, 'could not persist a session secret — sessions will not survive a restart');
  }
  return secret;
}

export function isConfigured(): boolean {
  return (cache?.accounts.length ?? 0) > 0;
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

export function list(): PublicAccount[] {
  return (cache?.accounts ?? [])
    .map(publicView)
    .sort((a, b) => a.username.localeCompare(b.username));
}

const findByName = (username: string): Account | undefined =>
  cache?.accounts.find((account) => account.username.toLowerCase() === username.toLowerCase());

/**
 * Checks a username and password pair.
 *
 * Always runs a bcrypt comparison, even for an unknown username, so the time
 * taken does not disclose which accounts exist.
 */
export async function verify(candidateUser: string, candidatePassword: string): Promise<boolean> {
  const account = findByName(candidateUser);
  const hash = account?.passwordHash ?? DECOY_HASH;

  const passwordOk = await bcrypt.compare(candidatePassword, hash).catch((err) => {
    logger.error({ err }, 'bcrypt comparison failed — is the stored password hash valid?');
    return false;
  });

  return Boolean(account) && passwordOk;
}

/**
 * Whether an account with this name still exists.
 *
 * Session tokens are self-contained, so without this check a removed
 * administrator would keep full access until their cookie expired — hours after
 * someone deliberately revoked it. Removal is the offboarding mechanism here;
 * it has to take effect at the next request.
 */
export function exists(username: string): boolean {
  return findByName(username) !== undefined;
}

/** The stored spelling of a username, so sessions carry it consistently. */
export function canonicalUsername(candidate: string): string {
  return findByName(candidate)?.username ?? candidate;
}

export class SetupError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'already-configured'
      | 'weak-password'
      | 'duplicate'
      | 'not-found'
      | 'last-account'
      | 'self',
  ) {
    super(message);
    this.name = 'SetupError';
  }
}

function assertUsable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new SetupError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'weak-password',
    );
  }
}

function assertNotEnvironmentManaged(): void {
  if (env.ADMIN_PASSWORD_HASH) {
    throw new SetupError(
      'Accounts are set through ADMIN_PASSWORD_HASH in the environment. Manage them there.',
      'already-configured',
    );
  }
}

/**
 * Creates the first account during first-run setup.
 *
 * Refuses once one exists, so this cannot be used to reset a forgotten
 * password — that path is deliberately manual (delete the store file), because
 * an unauthenticated password-reset endpoint is a backdoor.
 */
export async function createAccount(
  newUsername: string,
  newPassword: string,
): Promise<PublicAccount> {
  if (isConfigured()) {
    throw new SetupError('A control panel account already exists', 'already-configured');
  }
  assertUsable(newPassword);

  const account: Account = {
    id: randomUUID(),
    username: newUsername,
    passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST),
    createdAt: new Date().toISOString(),
  };

  await writeStore({
    version: 2,
    sessionSecret: cache?.sessionSecret ?? randomBytes(32).toString('hex'),
    accounts: [account],
  });
  logger.info({ username: newUsername }, 'control panel account created via first-run setup');

  return publicView(account);
}

/** Adds another administrator. Every account has the same rights. */
export async function addAccount(
  newUsername: string,
  newPassword: string,
): Promise<PublicAccount> {
  assertNotEnvironmentManaged();
  assertUsable(newPassword);
  if (!cache) throw new SetupError('No account is configured', 'not-found');

  if (findByName(newUsername)) {
    throw new SetupError(`An account named "${newUsername}" already exists`, 'duplicate');
  }

  const account: Account = {
    id: randomUUID(),
    username: newUsername,
    passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST),
    createdAt: new Date().toISOString(),
  };

  await writeStore({ ...cache, accounts: [...cache.accounts, account] });
  logger.info({ username: newUsername }, 'administrator account added');
  return publicView(account);
}

/**
 * Removes an administrator.
 *
 * Two things are refused. The last account, because there would be no way back
 * in — the store file would have to be deleted from a shell, which is exactly
 * the situation this control panel exists to avoid. And your own account, because
 * the effect is signing yourself out mid-action: another administrator can
 * remove you, which keeps the operation deliberate.
 */
export async function removeAccount(id: string, actingUsername: string): Promise<void> {
  assertNotEnvironmentManaged();
  if (!cache) throw new SetupError('No account is configured', 'not-found');

  const account = cache.accounts.find((candidate) => candidate.id === id);
  if (!account) throw new SetupError('No such account', 'not-found');

  if (account.username.toLowerCase() === actingUsername.toLowerCase()) {
    throw new SetupError(
      'You cannot remove the account you are signed in with. Ask another administrator to do it.',
      'self',
    );
  }
  if (cache.accounts.length <= 1) {
    throw new SetupError(
      'This is the only account. Removing it would lock everyone out — add another first.',
      'last-account',
    );
  }

  await writeStore({
    ...cache,
    accounts: cache.accounts.filter((candidate) => candidate.id !== id),
  });
  logger.info({ username: account.username }, 'administrator account removed');
}

/** Changes the password of the signed-in account. Requires the current one. */
export async function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!cache) throw new SetupError('No account is configured', 'not-found');
  assertUsable(newPassword);

  if (!(await verify(username, currentPassword))) {
    throw new SetupError('Current password is incorrect', 'weak-password');
  }
  assertNotEnvironmentManaged();

  await replaceHash(username, newPassword);
  logger.info({ username }, 'control panel password changed');
}

/**
 * Sets another account's password without knowing the old one.
 *
 * The answer to a colleague who has forgotten theirs. It is not a privilege
 * escalation: every account here is already a full administrator, so anyone who
 * can call this could equally add an account of their own.
 */
export async function resetPassword(id: string, newPassword: string): Promise<PublicAccount> {
  assertNotEnvironmentManaged();
  assertUsable(newPassword);
  if (!cache) throw new SetupError('No account is configured', 'not-found');

  const account = cache.accounts.find((candidate) => candidate.id === id);
  if (!account) throw new SetupError('No such account', 'not-found');

  await replaceHash(account.username, newPassword);
  logger.info({ username: account.username }, 'administrator password reset by another account');
  return publicView(account);
}

async function replaceHash(username: string, newPassword: string): Promise<void> {
  if (!cache) return;
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await writeStore({
    ...cache,
    accounts: cache.accounts.map((account) =>
      account.username.toLowerCase() === username.toLowerCase()
        ? { ...account, passwordHash }
        : account,
    ),
  });
}

/** True when the environment owns the credentials, so the UI can say so. */
export function managedByEnvironment(): boolean {
  return env.ADMIN_PASSWORD_HASH !== '';
}

/** Test seam. */
export function resetCredentialCache(): void {
  cache = null;
  loaded = false;
}

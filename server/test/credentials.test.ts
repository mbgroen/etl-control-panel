import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * The multi-account store, exercised through its own file.
 *
 * These are the rules that decide who can get into a control panel holding the
 * Docker socket, so each one is pinned rather than assumed: the last account
 * cannot be removed, an account cannot remove itself, usernames do not collide,
 * a removed account is gone immediately, and a v1 store keeps working.
 *
 * The store writes to STATE_PATH, so this file points that at a temp directory
 * *before* anything imports the environment.
 */
const stateDir = path.join(os.tmpdir(), `etl-credentials-test-${process.pid}`);
process.env.STATE_PATH = stateDir;

const storeFile = path.join(stateDir, 'credentials.json');

const load = async () => {
  const module = await import('../src/services/credentials.js');
  module.resetCredentialCache();
  return module;
};

before(async () => {
  await fs.mkdir(stateDir, { recursive: true });
});

beforeEach(async () => {
  await fs.rm(storeFile, { force: true });
});

after(async () => {
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe('credential store', () => {
  it('rejects a password under the minimum', async () => {
    const credentials = await load();
    await assert.rejects(
      () => credentials.createAccount('admin', 'short'),
      /at least 8 characters/,
    );
  });

  it('reports no account before setup', async () => {
    const credentials = await load();
    assert.equal(credentials.isConfigured(), false);
    assert.deepEqual(credentials.list(), []);
  });

  // An unknown username must cost the same as a known one, or response time
  // becomes a way to enumerate accounts.
  it('takes a comparable amount of work for an unknown username', async () => {
    const credentials = await load();
    const start = process.hrtime.bigint();
    const result = await credentials.verify('nobody', 'whatever-password');
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.equal(result, false);
    // bcrypt at cost 12 takes well over 10ms; an early return would be ~0.
    assert.ok(elapsedMs > 10, `expected a real hash comparison, took ${elapsedMs.toFixed(1)}ms`);
  });

  it('signs in a second account and keeps both usable', async () => {
    const credentials = await load();
    await credentials.createAccount('first', 'first-password');
    await credentials.addAccount('second', 'second-password');

    assert.equal(await credentials.verify('first', 'first-password'), true);
    assert.equal(await credentials.verify('second', 'second-password'), true);
    assert.equal(await credentials.verify('second', 'first-password'), false);
    assert.deepEqual(
      credentials.list().map((account) => account.username),
      ['first', 'second'],
    );
  });

  it('refuses a username that differs only in case', async () => {
    const credentials = await load();
    await credentials.createAccount('first', 'first-password');
    await assert.rejects(() => credentials.addAccount('FIRST', 'other-password'), /already exists/);
  });

  it('refuses to remove the only account', async () => {
    const credentials = await load();
    await credentials.createAccount('only', 'only-password');
    const [account] = credentials.list();

    await assert.rejects(
      () => credentials.removeAccount(account!.id, 'someone-else'),
      /only account/,
    );
    assert.equal(credentials.list().length, 1);
  });

  it('refuses to remove the account doing the removing', async () => {
    const credentials = await load();
    await credentials.createAccount('first', 'first-password');
    await credentials.addAccount('second', 'second-password');
    const first = credentials.list().find((account) => account.username === 'first');

    await assert.rejects(() => credentials.removeAccount(first!.id, 'first'), /signed in with/);
    assert.equal(credentials.list().length, 2);
  });

  // Session tokens outlive the account they name, so removal has to be visible
  // to the request path immediately — otherwise revoking access means waiting
  // out the cookie.
  it('stops recognising a removed account at once', async () => {
    const credentials = await load();
    await credentials.createAccount('first', 'first-password');
    await credentials.addAccount('second', 'second-password');
    const second = credentials.list().find((account) => account.username === 'second');

    assert.equal(credentials.exists('second'), true);
    await credentials.removeAccount(second!.id, 'first');

    assert.equal(credentials.exists('second'), false);
    assert.equal(await credentials.verify('second', 'second-password'), false);
  });

  it('sets a password for another account without the old one', async () => {
    const credentials = await load();
    await credentials.createAccount('first', 'first-password');
    await credentials.addAccount('second', 'second-password');
    const second = credentials.list().find((account) => account.username === 'second');

    await credentials.resetPassword(second!.id, 'replacement-password');
    assert.equal(await credentials.verify('second', 'replacement-password'), true);
    assert.equal(await credentials.verify('second', 'second-password'), false);
  });

  // Anyone upgrading from a single-account release has this file on disk. It
  // has to keep working, and the session secret has to survive — otherwise the
  // upgrade signs everyone out.
  it('migrates a single-account store and keeps the session secret', async () => {
    const first = await load();
    await first.initialize();
    await first.createAccount('legacy', 'legacy-password');
    const secret = first.sessionSecret();
    const parsed = JSON.parse(await fs.readFile(storeFile, 'utf8')) as {
      accounts: { username: string; passwordHash: string }[];
    };

    // Rewrite it in the pre-2.5 shape.
    await fs.writeFile(
      storeFile,
      JSON.stringify({
        username: parsed.accounts[0]!.username,
        passwordHash: parsed.accounts[0]!.passwordHash,
        sessionSecret: secret,
      }),
    );

    const credentials = await load();
    await credentials.initialize();

    assert.equal(credentials.sessionSecret(), secret);
    assert.deepEqual(
      credentials.list().map((account) => account.username),
      ['legacy'],
    );
    assert.equal(await credentials.verify('legacy', 'legacy-password'), true);
  });
});

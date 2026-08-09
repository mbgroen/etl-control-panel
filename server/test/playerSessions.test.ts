import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import type { PlayerStatus } from '../src/services/q3protocol.js';

// Finished visits are read back from STATE_PATH, so point that at a temp
// directory before the module is evaluated — hence the dynamic import.
const stateDir = path.join(os.tmpdir(), `etl-sessions-test-${process.pid}`);
process.env.STATE_PATH = stateDir;

const { current, forgetBots, observe, recent, resetPlayerSessions } = await import(
  '../src/services/playerSessions.js'
);

after(async () => {
  await fs.rm(stateDir, { recursive: true, force: true });
});

const player = (nameClean: string, address: string | null = null): PlayerStatus => ({
  slot: null,
  name: nameClean,
  nameClean,
  score: 0,
  ping: 30,
  address,
  rate: null,
});

const at = (secondsFromStart: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, secondsFromStart));

describe('player sessions', () => {
  beforeEach(() => resetPlayerSessions());

  it('opens a session when a player first appears', async () => {
    await observe([player('Rambo')], at(0));
    const open = current();
    assert.equal(open.length, 1);
    assert.equal(open[0]?.nameClean, 'Rambo');
  });

  // The Overview reads the live server, so a player who has gone must not still
  // be counted here — two pages disagreeing is worse than a short gap.
  it('stops reporting a player as playing the moment they are gone', async () => {
    await observe([player('Rambo')], at(0));
    await observe([], at(10));
    assert.equal(current().length, 0);
  });

  it('survives a single missed poll without splitting the visit', async () => {
    await observe([player('Rambo')], at(0));
    await observe([], at(10));
    await observe([player('Rambo')], at(20));

    const open = current();
    assert.equal(open.length, 1, 'the same session should still be open');
    assert.equal(open[0]?.joinedAt, at(0).toISOString(), 'joined time should not have been reset');
  });

  it('adopts an address that only arrives once rcon has been queried', async () => {
    await observe([player('Rambo')], at(0));
    assert.equal(current()[0]?.address, null);

    await observe([player('Rambo', '81.20.30.40:27960')], at(10));
    const open = current();
    assert.equal(open.length, 1, 'a late address must not open a second session');
    assert.equal(open[0]?.address, '81.20.30.40');
    assert.equal(open[0]?.addressKind, 'public');
  });

  it('classifies a private address without looking anything up', async () => {
    await observe([player('Michiel', '192.168.0.12:27960')], at(0));
    assert.equal(current()[0]?.addressKind, 'private');
    assert.equal(current()[0]?.countryCode, null);
  });
});

describe('forgetting bot visits', () => {
  beforeEach(() => resetPlayerSessions());

  // The engine reports a bot's address as the literal string "bot" — NA_BOT in
  // NetadrToString — so this keys off the address the server gave, not the
  // name, which a player can set to anything they like.
  it('removes bot visits and leaves the humans alone', async () => {
    await observe([player('Human', '203.0.113.5:27960'), player('Bot One', 'bot'), player('Bot Two', 'bot')], at(0));
    await observe([], at(10));
    await observe([], at(120));   // past ABSENCE_GRACE_MS, so the visits close

    assert.equal((await recent()).length, 3);
    assert.equal(await forgetBots(), 2);

    const left = await recent();
    assert.deepEqual(left.map((session) => session.nameClean), ['Human']);
  });

  it('reports nothing removed when there are no bots', async () => {
    await observe([player('Human', '203.0.113.5:27960')], at(0));
    await observe([], at(120));
    assert.equal(await forgetBots(), 0);
    assert.equal((await recent()).length, 1);
  });
});

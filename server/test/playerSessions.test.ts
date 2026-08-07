import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { current, observe, resetPlayerSessions } from '../src/services/playerSessions.js';
import type { PlayerStatus } from '../src/services/q3protocol.js';

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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  gametypeName,
  parseInfoString,
  parseRconStatus,
  stripColors,
} from '../src/services/q3protocol.js';

describe('parseInfoString', () => {
  it('parses a leading-backslash info string', () => {
    const info = parseInfoString('\\sv_hostname\\Time to Waste\\mapname\\oasis\\sv_maxclients\\20');
    assert.equal(info.sv_hostname, 'Time to Waste');
    assert.equal(info.mapname, 'oasis');
    assert.equal(info.sv_maxclients, '20');
  });

  it('keeps a trailing key with no value instead of dropping it', () => {
    const info = parseInfoString('\\g_password\\\\mapname\\radar');
    assert.equal(info.g_password, '');
    assert.equal(info.mapname, 'radar');
  });

  it('returns an empty object for empty input', () => {
    assert.deepEqual(parseInfoString(''), {});
  });
});

describe('stripColors', () => {
  it('removes Quake 3 colour escapes', () => {
    assert.equal(stripColors('^7[^2TTW^7] ^1Time to ^3Waste^7!'), '[TTW] Time to Waste!');
  });

  it('leaves a doubled caret alone, matching engine behaviour', () => {
    assert.equal(stripColors('caret^^1here'), 'caret^^1here'.replace(/\^[^^]/g, ''));
  });

  it('is a no-op on plain text', () => {
    assert.equal(stripColors('plain name'), 'plain name');
  });
});

describe('parseRconStatus', () => {
  // Real ET:Legacy output. The engine prints nine columns —
  // `%3i %5i %4i %-*s %7i %-21s %5i %5i %i` — the last being lastConnectTime,
  // which stock ET does not emit. Parsing a fixed field count matched nothing
  // here and produced an empty player list on a populated server.
  const output = [
    'map: oasis',
    'num score ping name                                lastmsg address               qport rate  lastConnectTime',
    '--- ----- ---- ----------------------------------- ------- --------------------- ----- ----- ---------------',
    '  0    12   45 ^1Rambo^7                                50 192.168.1.5:27960      12345 25000 1699999999',
    '  3     0    0 Bot_Alpha                                  0 bot                       0     0 0',
  ].join('\n');

  it('extracts the current map', () => {
    assert.equal(parseRconStatus(output).map, 'oasis');
  });

  it('extracts slot, score, ping and address', () => {
    const { players } = parseRconStatus(output);
    assert.equal(players.length, 2);

    const first = players[0]!;
    assert.equal(first.slot, 0);
    assert.equal(first.score, 12);
    assert.equal(first.ping, 45);
    assert.equal(first.address, '192.168.1.5:27960');
    assert.equal(first.nameClean, 'Rambo');
    assert.equal(first.rate, 25000);
  });

  it('handles bot entries, which have no real address', () => {
    const bot = parseRconStatus(output).players[1]!;
    assert.equal(bot.slot, 3);
    assert.equal(bot.address, 'bot');
  });

  it('parses stock ET rows, which omit lastConnectTime', () => {
    const stock = '  1     7   62 Sniper                    30 10.0.0.9:27960         12345 25000';
    const player = parseRconStatus(stock).players[0]!;
    assert.equal(player.slot, 1);
    assert.equal(player.ping, 62);
    assert.equal(player.address, '10.0.0.9:27960');
    assert.equal(player.nameClean, 'Sniper');
  });

  it('keeps names containing spaces intact', () => {
    const row = '  2    30   80 Major Tom                 15 192.168.1.9:27960      12345 25000 1699999999';
    const player = parseRconStatus(row).players[0]!;
    assert.equal(player.nameClean, 'Major Tom');
    assert.equal(player.address, '192.168.1.9:27960');
    assert.equal(player.ping, 80);
  });

  it('keeps connecting clients, whose ping column reads CNCT rather than a number', () => {
    const row = '  4     0 CNCT Joining                     0 192.168.1.20:27960     12345 25000 1699999999';
    const player = parseRconStatus(row).players[0]!;
    assert.equal(player.slot, 4);
    assert.equal(player.ping, 0);
    assert.equal(player.nameClean, 'Joining');
  });

  it('parses IPv6 client addresses', () => {
    const row = '  5     3   28 Ghost                     10 [2001:db8::1]:27960    12345 25000 1699999999';
    const player = parseRconStatus(row).players[0]!;
    assert.equal(player.address, '[2001:db8::1]:27960');
    assert.equal(player.nameClean, 'Ghost');
  });

  it('ignores the header and separator rows', () => {
    assert.equal(parseRconStatus('map: radar\nnothing here').players.length, 0);
    assert.equal(parseRconStatus(output).players.every((p) => p.slot !== null), true);
  });
});

describe('gametypeName', () => {
  it('names the standard ET gametypes', () => {
    assert.equal(gametypeName('2'), 'Objective');
    assert.equal(gametypeName('4'), 'Campaign');
  });

  it('degrades gracefully for unknown or missing values', () => {
    assert.equal(gametypeName('42'), 'Type 42');
    assert.equal(gametypeName(undefined), 'Unknown');
  });
});

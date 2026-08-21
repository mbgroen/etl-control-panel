import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseServerList } from '../src/services/publicListing.js';

/** Builds a record the way a master does: \ + 4 address bytes + 2 port bytes. */
const record = (ip: string, port: number): string =>
  '\\' +
  ip
    .split('.')
    .map((part) => String.fromCharCode(Number(part)))
    .join('') +
  String.fromCharCode((port >> 8) & 0xff, port & 0xff);

describe('parseServerList', () => {
  it('reads the addresses and ports out of a getserversResponse', () => {
    const payload =
      'getserversResponse' + record('87.212.146.148', 27960) + record('203.0.113.9', 27961) + '\\EOT';

    assert.deepEqual(parseServerList(payload), [
      { ip: '87.212.146.148', port: 27960 },
      { ip: '203.0.113.9', port: 27961 },
    ]);
  });

  // The port that started all of this: a heartbeat masqueraded to a random
  // high port gets listed verbatim, and the number is what gives it away.
  it('keeps a high port exactly as the master gave it', () => {
    const payload = 'getserversResponse' + record('87.212.146.148', 49594) + '\\EOT';
    assert.deepEqual(parseServerList(payload), [{ ip: '87.212.146.148', port: 49594 }]);
  });

  it('handles an address byte that would be a backslash', () => {
    // 92 is '\\' — walking the payload naively would treat it as a separator.
    const payload = 'getserversResponse' + record('92.92.92.92', 27960) + '\\EOT';
    assert.deepEqual(parseServerList(payload), [{ ip: '92.92.92.92', port: 27960 }]);
  });

  it('stops at EOT and ignores a truncated tail', () => {
    const payload = 'getserversResponse' + record('198.51.100.7', 27960) + '\\EOT' + '\\\x01\x02';
    assert.deepEqual(parseServerList(payload), [{ ip: '198.51.100.7', port: 27960 }]);
  });

  it('returns nothing for a response that is not a server list', () => {
    assert.deepEqual(parseServerList('print\nno such protocol\n'), []);
    assert.deepEqual(parseServerList(''), []);
  });
});

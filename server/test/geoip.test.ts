import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, normaliseAddress } from '../src/services/geoip.js';

describe('normaliseAddress', () => {
  it('strips the port the engine appends', () => {
    assert.equal(normaliseAddress('192.168.1.20:27960'), '192.168.1.20');
    assert.equal(normaliseAddress('81.20.30.40:27960'), '81.20.30.40');
  });

  it('unwraps a bracketed IPv6 address', () => {
    assert.equal(normaliseAddress('[2001:db8::1]:27960'), '2001:db8::1');
    assert.equal(normaliseAddress('[2001:db8::1]'), '2001:db8::1');
  });

  it('leaves a bare IPv6 address alone rather than splitting on its colons', () => {
    assert.equal(normaliseAddress('2001:db8::1'), '2001:db8::1');
  });
});

describe('classify', () => {
  // Nothing classified as private is ever sent to the lookup service, so these
  // decide whether an operator's own network is disclosed to a third party.
  it('treats every private range as private', () => {
    for (const address of [
      '10.0.0.5',
      '192.168.1.20:27960',
      '172.16.4.9',
      '172.31.255.255',
      '169.254.1.1',
      '100.64.0.1', // carrier-grade NAT
      'fd00::1',
      'fe80::1',
    ]) {
      assert.equal(classify(address), 'private', address);
    }
  });

  it('recognises loopback and bots, which have no location at all', () => {
    assert.equal(classify('127.0.0.1'), 'loopback');
    assert.equal(classify('loopback'), 'loopback');
    assert.equal(classify('::1'), 'loopback');
    assert.equal(classify('bot'), 'bot');
  });

  it('treats routable addresses as public', () => {
    assert.equal(classify('81.20.30.40:27960'), 'public');
    assert.equal(classify('8.8.8.8'), 'public');
    assert.equal(classify('2001:db8::1'), 'public');
  });

  it('does not guess at addresses it cannot place', () => {
    assert.equal(classify(''), 'unknown');
    assert.equal(classify('224.0.0.1'), 'unknown');
    assert.equal(classify('nonsense'), 'unknown');
  });

  // 172.15 and 172.32 sit just outside the private block and are routable.
  it('gets the edges of the 172.16/12 block right', () => {
    assert.equal(classify('172.15.0.1'), 'public');
    assert.equal(classify('172.32.0.1'), 'public');
  });
});

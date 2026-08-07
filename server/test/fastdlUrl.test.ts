import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { baseUrlSchema } from '../src/services/fastdlUrl.js';

const parse = (value: string): string => baseUrlSchema.parse(value);
const errorFor = (value: string): string => {
  try {
    baseUrlSchema.parse(value);
    return '';
  } catch (err) {
    return (err as { issues: { message: string }[] }).issues[0]?.message ?? '';
  }
};

describe('fastdl baseUrlSchema', () => {
  it('keeps a full URL as given', () => {
    assert.equal(parse('http://192.168.1.10:8081'), 'http://192.168.1.10:8081');
    assert.equal(parse('https://dl.example.com'), 'https://dl.example.com');
  });

  // The dashboard's own hint renders "host:port/etmain/<map>.pk3", so typing it
  // without a scheme is the natural thing to do — and used to fail validation.
  it('adds http:// when the scheme was left off', () => {
    assert.equal(parse('192.168.1.50:8081'), 'http://192.168.1.50:8081');
    assert.equal(parse('nas.local:8081'), 'http://nas.local:8081');
  });

  it('strips trailing slashes, which would make the engine request //etmain', () => {
    assert.equal(parse('http://192.168.1.10:8081/'), 'http://192.168.1.10:8081');
    assert.equal(parse('192.168.1.10:8081///'), 'http://192.168.1.10:8081');
  });

  it('trims surrounding whitespace from a pasted value', () => {
    assert.equal(parse('  http://192.168.1.10:8081  '), 'http://192.168.1.10:8081');
  });

  it('still rejects input that is not a URL, with a message that says how to fix it', () => {
    assert.match(errorFor(''), /full http:\/\/ or https:\/\/ URL/);
    assert.match(errorFor('ftp://192.168.1.10'), /full http:\/\/ or https:\/\/ URL/);
  });
});

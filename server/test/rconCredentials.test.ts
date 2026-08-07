import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSendAsRconArgument, selectRconPassword } from '../src/services/rconCredentials.js';

describe('selectRconPassword', () => {
  it('prefers the server config, because that is what the game server reads', () => {
    const credential = selectRconPassword('fromConfig', 'fromEnvironment');
    assert.equal(credential.password, 'fromConfig');
    assert.equal(credential.source, 'config');
  });

  it('reports when an environment override is being ignored', () => {
    assert.equal(selectRconPassword('a', 'b').environmentIgnored, true);
    // Same value in both places is not a conflict worth mentioning.
    assert.equal(selectRconPassword('a', 'a').environmentIgnored, false);
    assert.equal(selectRconPassword('a', '').environmentIgnored, false);
  });

  it('falls back to the environment when the config has no password', () => {
    const credential = selectRconPassword('', 'fromEnvironment');
    assert.equal(credential.password, 'fromEnvironment');
    assert.equal(credential.source, 'environment');
  });

  it('falls back to the environment when there is no config at all', () => {
    const credential = selectRconPassword(undefined, 'fromEnvironment');
    assert.equal(credential.password, 'fromEnvironment');
    assert.equal(credential.source, 'environment');
  });

  it('reports no credential when neither source has one', () => {
    const credential = selectRconPassword(undefined, '');
    assert.equal(credential.source, 'none');
    assert.equal(credential.password, '');
  });

  // A quoted-but-empty cvar is how an unset password appears in a real config,
  // and whitespace around a pasted value should not count as a password.
  it('treats whitespace-only values as unset', () => {
    assert.equal(selectRconPassword('   ', '  ').source, 'none');
    assert.equal(selectRconPassword('   ', 'real').source, 'environment');
  });

  it('trims a padded value rather than sending the padding', () => {
    assert.equal(selectRconPassword('  secret  ', '').password, 'secret');
  });
});

describe('canSendAsRconArgument', () => {
  it('accepts ordinary passwords, including ones with spaces', () => {
    assert.equal(canSendAsRconArgument('hunter2'), true);
    assert.equal(canSendAsRconArgument('two words'), true);
    assert.equal(canSendAsRconArgument("it's-fine_123!"), true);
  });

  // These would end the quoted argument early or start a second console
  // command, so the value applied would not be the value written.
  it('rejects characters that would break out of the quoted argument', () => {
    assert.equal(canSendAsRconArgument('has"quote'), false);
    assert.equal(canSendAsRconArgument('has;semicolon'), false);
    assert.equal(canSendAsRconArgument('has\nnewline'), false);
  });
});

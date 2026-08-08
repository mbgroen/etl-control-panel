import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The module reads env at import time; supply the minimum it validates.
process.env.ADMIN_PASSWORD_HASH ??= '$2a$12$0123456789012345678901234567890123456789012345678';
process.env.SESSION_SECRET ??= 'x'.repeat(48);

const {
  applyCvarUpdates,
  buildRotation,
  cvarMap,
  maskSecrets,
  MASK,
  parseCvars,
  parseRotation,
  validateConfig,
} = await import('../src/services/serverConfig.js');

const SAMPLE = [
  '// Server config',
  'set sv_hostname "^7[^2TTW^7] ^1Time to ^3Waste^7!"',
  'set sv_maxclients "20"',
  'set sv_privateClients "2"   // reserved for admins',
  'set rconpassword "hunter2000"',
  'set g_gametype "2"',
].join('\n');

describe('parseCvars', () => {
  it('reads quoted values including colour codes and spaces', () => {
    const cvars = parseCvars(SAMPLE);
    const hostname = cvars.find((c) => c.key === 'sv_hostname');
    assert.equal(hostname?.value, '^7[^2TTW^7] ^1Time to ^3Waste^7!');
  });

  it('skips comment lines', () => {
    assert.ok(!parseCvars(SAMPLE).some((c) => c.key === 'Server'));
  });

  it('flags secret cvars', () => {
    const rcon = parseCvars(SAMPLE).find((c) => c.key === 'rconpassword');
    assert.equal(rcon?.secret, true);
  });

  it('records 1-based line numbers', () => {
    assert.equal(parseCvars(SAMPLE).find((c) => c.key === 'sv_maxclients')?.line, 3);
  });
});

describe('maskSecrets', () => {
  it('replaces secret values but keeps the keys', () => {
    const masked = maskSecrets(parseCvars(SAMPLE));
    const rcon = masked.find((c) => c.key === 'rconpassword');
    assert.equal(rcon?.value, MASK);
    assert.equal(masked.find((c) => c.key === 'sv_maxclients')?.value, '20');
  });
});

describe('applyCvarUpdates', () => {
  it('rewrites an existing cvar in place', () => {
    const next = applyCvarUpdates(SAMPLE, { sv_maxclients: '32' });
    assert.match(next, /set sv_maxclients "32"/);
    assert.equal(cvarMap(next).sv_maxclients, '32');
  });

  it('preserves comments elsewhere in the file', () => {
    const next = applyCvarUpdates(SAMPLE, { sv_maxclients: '32' });
    assert.match(next, /^\/\/ Server config$/m);
  });

  it('preserves a trailing comment on the edited line', () => {
    const next = applyCvarUpdates(SAMPLE, { sv_privateClients: '4' });
    assert.match(next, /set sv_privateClients "4"\s+\/\/ reserved for admins/);
  });

  it('appends unknown cvars in a marked block', () => {
    const next = applyCvarUpdates(SAMPLE, { g_friendlyFire: '1' });
    assert.match(next, /Added by the control panel/);
    assert.equal(cvarMap(next).g_friendlyfire, '1');
  });

  // The engine does not care about case, but an appended line that shouts
  // g_medicchargetime in a file full of camelCase reads like something went
  // wrong. Whatever spelling comes in is the spelling written out.
  it('appends a new cvar with the spelling it was given', () => {
    const next = applyCvarUpdates(SAMPLE, { g_medicChargeTime: '30000' });
    assert.match(next, /set g_medicChargeTime "30000"/);
  });

  it('still finds an existing cvar whose case differs', () => {
    const next = applyCvarUpdates('set G_GRAVITY "800"', { g_gravity: '700' });
    assert.equal(next, 'set G_GRAVITY "700"');
    assert.ok(!next.includes('Added by the control panel'));
  });

  // A config written before the rename says dashboard:rotation. Rewriting the
  // rotation has to replace that block, not leave it in place and append a
  // second one — the trailing vstr would then decide which rotation runs.
  it('replaces a rotation block written under the old marker', () => {
    const legacy = [
      'set sv_hostname "x"',
      '// >>> dashboard:rotation — managed block, edit via the dashboard',
      'set mr1 "map oasis ; set nextmap vstr mr1"',
      'vstr mr1',
      '// <<< dashboard:rotation',
    ].join('\n');

    const next = buildRotation(legacy, ['radar', 'battery']);
    assert.equal((next.match(/:rotation —/g) ?? []).length, 1);
    assert.ok(!next.includes('dashboard:rotation'));
    assert.deepEqual(parseRotation(next).map((entry) => entry.map), ['radar', 'battery']);
  });

  it('patches only the last assignment, which is the one the engine applies', () => {
    const doubled = 'set timelimit "10"\nset timelimit "20"';
    const next = applyCvarUpdates(doubled, { timelimit: '30' });
    assert.equal(next, 'set timelimit "10"\nset timelimit "30"');
  });

  it('neutralises quotes in values so the file cannot be corrupted', () => {
    const next = applyCvarUpdates(SAMPLE, { sv_hostname: 'say "hi"' });
    assert.ok(!/set sv_hostname "say "hi""/.test(next));
    assert.equal(validateConfig(next).filter((p) => p.severity === 'error').length, 0);
  });
});

describe('validateConfig', () => {
  const errors = (cfg: string) => validateConfig(cfg).filter((p) => p.severity === 'error');

  it('accepts a sane config', () => {
    assert.equal(errors(SAMPLE).length, 0);
  });

  it('catches an unbalanced quote', () => {
    const problems = errors('set sv_hostname "broken');
    assert.equal(problems.length, 1);
    assert.match(problems[0]!.message, /Unbalanced/);
  });

  it('rejects private slots that consume every public slot', () => {
    const problems = errors('set sv_maxclients "8"\nset sv_privateClients "8"');
    assert.ok(problems.some((p) => /must be lower than/.test(p.message)));
  });

  it('rejects out-of-range numeric cvars', () => {
    assert.ok(errors('set sv_maxclients "500"').some((p) => /between 1 and 64/.test(p.message)));
  });

  it('rejects FastDL enabled without a base URL', () => {
    const problems = errors('set sv_wwwDownload "1"');
    assert.ok(problems.some((p) => /sv_wwwBaseURL/.test(p.message)));
  });

  it('warns when no rcon password is set', () => {
    const warnings = validateConfig('set sv_maxclients "20"').filter((p) => p.severity === 'warning');
    assert.ok(warnings.some((p) => /rconpassword/.test(p.message)));
  });
});

describe('map rotation', () => {
  it('round-trips a rotation through build and parse', () => {
    const maps = ['oasis', 'radar', 'railgun', 'fueldump'];
    const cfg = buildRotation(SAMPLE, maps);
    assert.deepEqual(
      parseRotation(cfg).map((entry) => entry.map),
      maps,
    );
  });

  it('links the last map back to the first', () => {
    const cfg = buildRotation(SAMPLE, ['oasis', 'radar']);
    assert.match(cfg, /set mr2 "map radar ; set nextmap vstr mr1"/);
  });

  it('replaces the managed block instead of stacking duplicates', () => {
    const once = buildRotation(SAMPLE, ['oasis', 'radar']);
    const twice = buildRotation(once, ['battery']);
    assert.equal((twice.match(/control-panel:rotation —/g) ?? []).length, 1);
    assert.deepEqual(parseRotation(twice).map((e) => e.map), ['battery']);
  });

  it('reads a hand-written rotation using arbitrary variable names', () => {
    const handWritten = [
      'set m1 "map goldrush ; set nextmap vstr m2"',
      'set m2 "map battery ; set nextmap vstr m1"',
      'vstr m1',
    ].join('\n');
    assert.deepEqual(parseRotation(handWritten).map((e) => e.map), ['goldrush', 'battery']);
  });

  it('returns nothing when no rotation is started', () => {
    assert.deepEqual(parseRotation(SAMPLE), []);
  });

  it('clearing the rotation removes the managed block', () => {
    const cfg = buildRotation(buildRotation(SAMPLE, ['oasis']), []);
    assert.ok(!cfg.includes('control-panel:rotation'));
  });
});

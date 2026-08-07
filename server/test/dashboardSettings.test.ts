import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_UPLOAD_MB_CEILING,
  MIN_UPLOAD_MB,
  parseUploadMb,
} from '../src/services/dashboardSettings.js';

describe('parseUploadMb', () => {
  it('accepts values inside the allowed range', () => {
    assert.equal(parseUploadMb(256), 256);
    assert.equal(parseUploadMb(MIN_UPLOAD_MB), MIN_UPLOAD_MB);
    assert.equal(parseUploadMb(MAX_UPLOAD_MB_CEILING), MAX_UPLOAD_MB_CEILING);
  });

  it('rejects values outside it rather than silently clamping', () => {
    // Silently clamping would save a different number than the one shown as
    // accepted, so the field would disagree with what actually applies.
    assert.equal(parseUploadMb(0), null);
    assert.equal(parseUploadMb(-1), null);
    assert.equal(parseUploadMb(MAX_UPLOAD_MB_CEILING + 1), null);
  });

  it('rounds a fractional value to whole megabytes', () => {
    assert.equal(parseUploadMb(256.4), 256);
    assert.equal(parseUploadMb(256.6), 257);
  });

  it('rejects anything that is not a usable number', () => {
    assert.equal(parseUploadMb('512'), null);
    assert.equal(parseUploadMb(null), null);
    assert.equal(parseUploadMb(undefined), null);
    assert.equal(parseUploadMb(Number.NaN), null);
    assert.equal(parseUploadMb(Number.POSITIVE_INFINITY), null);
  });
});

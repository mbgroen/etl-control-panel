import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripTerminalCodes } from '../src/services/docker.js';

const ESC = '\x1B';

describe('stripTerminalCodes', () => {
  // A real line from an ET: Legacy server. The engine colours its console, so
  // every player name arrives wrapped in escapes; the browser rendered each one
  // as a replacement box followed by the literal "[0m".
  it('unwraps a coloured line from the game server', () => {
    const line = `27861650 broadcast: print "${ESC}[1;37mHarde Henk${ESC}[1;37m entered the game${ESC}[0m\\n"${ESC}[0m`;
    assert.equal(
      stripTerminalCodes(line),
      '27861650 broadcast: print "Harde Henk entered the game\\n"',
    );
  });

  it('leaves the backslashes of a userinfo string alone', () => {
    const line = `${ESC}[0m\\name\\Harde Henk${ESC}[0m\\ip\\192.168.0.1:27960${ESC}[0m`;
    assert.equal(stripTerminalCodes(line), '\\name\\Harde Henk\\ip\\192.168.0.1:27960');
  });

  it('keeps the line endings the caller splits on, and tabs', () => {
    assert.equal(stripTerminalCodes('one\r\ntwo\tthree\n'), 'one\r\ntwo\tthree\n');
  });

  it('removes cursor moves and erases, not only colours', () => {
    assert.equal(stripTerminalCodes(`${ESC}[2J${ESC}[1;1Hready`), 'ready');
  });

  it('removes an OSC title sequence whichever way it terminates', () => {
    assert.equal(stripTerminalCodes(`${ESC}]0;a title\x07done`), 'done');
    assert.equal(stripTerminalCodes(`${ESC}]0;a title${ESC}\\done`), 'done');
  });

  // Nginx and the game server both emit plain text most of the time; the
  // stripping must not be able to eat any of it.
  it('passes ordinary output through untouched', () => {
    const line = '203.0.113.24 "GET /etmain/radar.pk3 HTTP/1.1" 200 24117248 bytes in 3.412s';
    assert.equal(stripTerminalCodes(line), line);
  });
});

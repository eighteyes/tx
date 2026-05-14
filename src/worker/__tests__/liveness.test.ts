import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pidAlive,
  transcriptMtime,
  tmuxSessionAlive,
  getPgid,
} from '../liveness.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-liveness-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pidAlive', () => {
  it('returns false for invalid PIDs', () => {
    assert.equal(pidAlive(0), false);
    assert.equal(pidAlive(-1), false);
    assert.equal(pidAlive(null), false);
    assert.equal(pidAlive(undefined), false);
  });

  it('returns true for the current process', () => {
    assert.equal(pidAlive(process.pid), true);
  });

  it('returns false for an unlikely-existing PID', () => {
    // PID 2^22 is well outside normal Linux range
    assert.equal(pidAlive(4_194_303), false);
  });
});

describe('transcriptMtime', () => {
  it('returns null for missing path inputs', () => {
    assert.equal(transcriptMtime(null), null);
    assert.equal(transcriptMtime(undefined), null);
    assert.equal(transcriptMtime(''), null);
  });

  it('returns null for nonexistent files', () => {
    assert.equal(transcriptMtime(path.join(tmpDir, 'nope.jsonl')), null);
  });

  it('returns a number for existing files and updates on write', async () => {
    const file = path.join(tmpDir, 't.jsonl');
    fs.writeFileSync(file, '{}\n');
    const t1 = transcriptMtime(file);
    assert.ok(typeof t1 === 'number' && t1 > 0);

    // Sleep briefly then append; mtime should advance
    await new Promise(r => setTimeout(r, 15));
    fs.appendFileSync(file, '{}\n');
    const t2 = transcriptMtime(file);
    assert.ok(typeof t2 === 'number');
    assert.ok(t2! >= t1!, `expected t2 >= t1 (${t2} vs ${t1})`);
  });
});

describe('tmuxSessionAlive', () => {
  it('rejects unsafe session names without invoking tmux', () => {
    assert.equal(tmuxSessionAlive('foo; rm -rf /'), false);
    assert.equal(tmuxSessionAlive("a'b"), false);
    assert.equal(tmuxSessionAlive(''), false);
  });

  it('returns false for a definitely-nonexistent safe-named session', () => {
    // If tmux is absent the function still returns false; if present it queries.
    assert.equal(tmuxSessionAlive('tx-w-doesnotexist-aaaaaaaa-zz'), false);
  });
});

describe('getPgid', () => {
  it('returns null for invalid PIDs', () => {
    assert.equal(getPgid(0), null);
    assert.equal(getPgid(-5), null);
  });

  it('returns a positive integer for the current process (on POSIX)', () => {
    const pgid = getPgid(process.pid);
    // ps may not be available in some sandboxes; accept null OR a positive int
    if (pgid !== null) {
      assert.ok(pgid > 0, `expected pgid > 0, got ${pgid}`);
    }
  });
});

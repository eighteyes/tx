import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateRunId, isRunId, workerSessionName, isTmuxWorkerSession } from '../run-id.ts';

describe('run-id', () => {
  it('generates a runId with the r- prefix and is recognized', () => {
    const id = generateRunId();
    assert.ok(id.startsWith('r-'), `expected r- prefix, got ${id}`);
    assert.ok(isRunId(id));
    assert.ok(id.length > 5);
  });

  it('generates monotonically-sortable IDs when timestamps differ', () => {
    const a = generateRunId(1_000_000_000);
    const b = generateRunId(2_000_000_000);
    assert.ok(a < b, `expected ${a} < ${b}`);
  });

  it('generates unique IDs for the same timestamp', () => {
    const ts = Date.now();
    const ids = new Set(Array.from({ length: 20 }, () => generateRunId(ts)));
    assert.equal(ids.size, 20);
  });

  it('rejects non-runId strings', () => {
    assert.equal(isRunId(''), false);
    assert.equal(isRunId('r-'), false);
    assert.equal(isRunId('tx-w-abc'), false);
    assert.equal(isRunId('foo'), false);
  });

  it('workerSessionName embeds the runId body and is tmux-safe', () => {
    const runId = 'r-abc123-xyz789';
    const name = workerSessionName(runId, 'mesh/agent');
    assert.ok(name.startsWith('tx-w-abc123-xyz789-'));
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(name), `not tmux-safe: ${name}`);
    assert.ok(isTmuxWorkerSession(name));
  });

  it('workerSessionName produces unique names for the same agent + runId', () => {
    const runId = generateRunId();
    const a = workerSessionName(runId, 'mesh/agent');
    const b = workerSessionName(runId, 'mesh/agent');
    assert.notEqual(a, b);
  });

  it('isTmuxWorkerSession only matches tx-w- prefix', () => {
    assert.equal(isTmuxWorkerSession('tx-w-foo'), true);
    assert.equal(isTmuxWorkerSession('tx-core'), false);
    assert.equal(isTmuxWorkerSession(''), false);
  });
});

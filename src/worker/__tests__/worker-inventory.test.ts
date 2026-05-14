import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkerInventory, isTerminal, type InventoryRecord } from '../worker-inventory.ts';

let tmpDir: string;
let invPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-inv-'));
  invPath = path.join(tmpDir, 'sub', 'worker-inventory.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rec(overrides: Partial<InventoryRecord>): Omit<InventoryRecord, 'ts'> {
  return {
    runId: 'r-test',
    workerId: 'w1',
    agentId: 'mesh/agent',
    runnerKind: 'tmux',
    workDir: '/tmp/work',
    state: 'spawning',
    ...overrides,
  };
}

describe('WorkerInventory', () => {
  it('creates the parent directory if missing', () => {
    new WorkerInventory(invPath);
    assert.ok(fs.existsSync(path.dirname(invPath)));
  });

  it('returns [] when the file does not exist', () => {
    const inv = new WorkerInventory(invPath);
    assert.deepEqual(inv.readAll(), []);
    assert.equal(inv.currentStates().size, 0);
  });

  it('appends a record and reads it back', () => {
    const inv = new WorkerInventory(invPath);
    inv.record(rec({}));
    const all = inv.readAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].workerId, 'w1');
    assert.equal(all[0].state, 'spawning');
    assert.ok(all[0].ts > 0);
  });

  it('folds to latest state per workerId', () => {
    const inv = new WorkerInventory(invPath);
    inv.record(rec({ workerId: 'w1', state: 'spawning' }));
    inv.record(rec({ workerId: 'w1', state: 'running' }));
    inv.record(rec({ workerId: 'w2', state: 'spawning' }));
    inv.record(rec({ workerId: 'w1', state: 'exited' }));

    const states = inv.currentStates();
    assert.equal(states.size, 2);
    assert.equal(states.get('w1')!.state, 'exited');
    assert.equal(states.get('w2')!.state, 'spawning');
  });

  it('nonTerminal excludes exited and orphaned entries', () => {
    const inv = new WorkerInventory(invPath);
    inv.record(rec({ workerId: 'w1', state: 'running' }));
    inv.record(rec({ workerId: 'w2', state: 'exited' }));
    inv.record(rec({ workerId: 'w3', state: 'orphaned' }));
    inv.record(rec({ workerId: 'w4', state: 'stalled' }));

    const nt = inv.nonTerminal().map(r => r.workerId).sort();
    assert.deepEqual(nt, ['w1', 'w4']);
  });

  it('killed and crashed are non-terminal (kill ladder must verify dead)', () => {
    const inv = new WorkerInventory(invPath);
    inv.record(rec({ workerId: 'w1', state: 'killed' }));
    inv.record(rec({ workerId: 'w2', state: 'crashed' }));
    const nt = inv.nonTerminal().map(r => r.workerId).sort();
    assert.deepEqual(nt, ['w1', 'w2']);
  });

  it('forOtherRuns returns only non-terminal entries from foreign runs', () => {
    const inv = new WorkerInventory(invPath);
    inv.record(rec({ workerId: 'w1', runId: 'r-old', state: 'running' }));
    inv.record(rec({ workerId: 'w2', runId: 'r-old', state: 'exited' }));
    inv.record(rec({ workerId: 'w3', runId: 'r-new', state: 'running' }));

    const others = inv.forOtherRuns('r-new').map(r => r.workerId);
    assert.deepEqual(others, ['w1']);
  });

  it('skips malformed lines without throwing', () => {
    const inv = new WorkerInventory(invPath);
    fs.writeFileSync(invPath, '{"not":"valid"\n{"ts":1,"runId":"r","workerId":"w","agentId":"a","runnerKind":"sdk","workDir":"/x","state":"running"}\nbogus\n');
    const all = inv.readAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].workerId, 'w');
  });

  it('compact rewrites to keep only non-terminal current states', () => {
    const inv = new WorkerInventory(invPath);
    inv.record(rec({ workerId: 'w1', state: 'spawning' }));
    inv.record(rec({ workerId: 'w1', state: 'running' }));
    inv.record(rec({ workerId: 'w1', state: 'exited' }));
    inv.record(rec({ workerId: 'w2', state: 'running' }));

    inv.compact();
    const lines = fs.readFileSync(invPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.workerId, 'w2');
  });

  it('isTerminal classifies states correctly', () => {
    assert.equal(isTerminal('exited'), true);
    assert.equal(isTerminal('orphaned'), true);
    assert.equal(isTerminal('running'), false);
    assert.equal(isTerminal('killed'), false);
    assert.equal(isTerminal('crashed'), false);
    assert.equal(isTerminal('stalled'), false);
    assert.equal(isTerminal('spawning'), false);
    assert.equal(isTerminal('exiting'), false);
  });
});

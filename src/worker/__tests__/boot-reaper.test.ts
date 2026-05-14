import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBootReaper, type BootReaperIO } from '../boot-reaper.ts';
import { WorkerInventory, type InventoryRecord } from '../worker-inventory.ts';

const CURRENT_RUN = 'r-current';

let tmpDir: string;
let inv: WorkerInventory;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-bootreaper-'));
  inv = new WorkerInventory(path.join(tmpDir, 'inv.jsonl'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class FakeIO implements BootReaperIO {
  liveSessions = new Set<string>();
  killCalls: string[] = [];
  killSucceeds = true;

  tmuxSessionAlive(name: string): boolean { return this.liveSessions.has(name); }
  tmuxKillSession(name: string): boolean {
    this.killCalls.push(name);
    if (this.killSucceeds) this.liveSessions.delete(name);
    return this.killSucceeds;
  }
  listTmuxWorkerSessions(): string[] { return Array.from(this.liveSessions); }
}

function seed(rec: Omit<InventoryRecord, 'ts'>): void {
  inv.record(rec);
}

describe('runBootReaper — inventory entries', () => {
  it('no-op when no prior-run entries exist', async () => {
    const io = new FakeIO();
    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io });
    assert.equal(result.inventoryReaped, 0);
    assert.equal(result.unknownSessionsKilled, 0);
    assert.equal(result.failures, 0);
  });

  it('marks prior tmux entry orphaned when session is already gone', async () => {
    const io = new FakeIO();  // no live sessions
    seed({
      runId: 'r-old', workerId: 'w1', agentId: 'mesh/a', runnerKind: 'tmux',
      workDir: '/x', state: 'running', sessionName: 'tx-w-old-w1',
    });

    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io, compact: false });
    assert.equal(result.inventoryReaped, 1);
    assert.equal(io.killCalls.length, 0, 'should not call kill on a session already gone');
    const final = inv.currentStates().get('w1')!;
    assert.equal(final.state, 'orphaned');
    assert.match(final.reason!, /already gone/);
  });

  it('kills prior tmux session and marks orphaned when live', async () => {
    const io = new FakeIO();
    io.liveSessions.add('tx-w-old-w1');
    seed({
      runId: 'r-old', workerId: 'w1', agentId: 'mesh/a', runnerKind: 'tmux',
      workDir: '/x', state: 'running', sessionName: 'tx-w-old-w1',
    });

    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io, compact: false });
    assert.deepEqual(io.killCalls, ['tx-w-old-w1']);
    assert.equal(result.inventoryReaped, 1);
    const final = inv.currentStates().get('w1')!;
    assert.equal(final.state, 'orphaned');
    assert.match(final.reason!, /session killed/);
  });

  it('marks in-proc workers orphaned without any io call', async () => {
    const io = new FakeIO();
    seed({
      runId: 'r-old', workerId: 'w1', agentId: 'mesh/a', runnerKind: 'sdk',
      workDir: '/x', state: 'running',
    });
    seed({
      runId: 'r-old', workerId: 'w2', agentId: 'mesh/b', runnerKind: 'agent-loop',
      workDir: '/x', state: 'running',
    });

    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io, compact: false });
    assert.equal(io.killCalls.length, 0);
    assert.equal(result.inventoryReaped, 2);
    assert.equal(inv.currentStates().get('w1')!.state, 'orphaned');
    assert.equal(inv.currentStates().get('w2')!.state, 'orphaned');
  });

  it('leaves current-run entries untouched', async () => {
    const io = new FakeIO();
    io.liveSessions.add('tx-w-cur-w1');
    seed({
      runId: CURRENT_RUN, workerId: 'w1', agentId: 'mesh/a', runnerKind: 'tmux',
      workDir: '/x', state: 'running', sessionName: 'tx-w-cur-w1',
    });

    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io });
    assert.equal(io.killCalls.length, 0);
    assert.equal(result.inventoryReaped, 0);
    assert.equal(inv.currentStates().get('w1')!.state, 'running');
  });

  it('ignores prior entries already terminal', async () => {
    const io = new FakeIO();
    seed({
      runId: 'r-old', workerId: 'w1', agentId: 'mesh/a', runnerKind: 'tmux',
      workDir: '/x', state: 'exited', sessionName: 'tx-w-old-w1',
    });
    seed({
      runId: 'r-old', workerId: 'w2', agentId: 'mesh/a', runnerKind: 'tmux',
      workDir: '/x', state: 'orphaned', sessionName: 'tx-w-old-w2',
    });

    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io });
    assert.equal(result.inventoryReaped, 0);
  });

  it('records failure when kill fails', async () => {
    const io = new FakeIO();
    io.liveSessions.add('tx-w-old-w1');
    io.killSucceeds = false;
    seed({
      runId: 'r-old', workerId: 'w1', agentId: 'mesh/a', runnerKind: 'tmux',
      workDir: '/x', state: 'running', sessionName: 'tx-w-old-w1',
    });

    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io });
    assert.equal(result.failures, 1);
    assert.equal(result.inventoryReaped, 0);
    // No orphaned write since kill failed
    assert.equal(inv.currentStates().get('w1')!.state, 'running');
  });
});

describe('runBootReaper — unknown session sweep', () => {
  it('kills tx-w-* sessions with no inventory entry', async () => {
    const io = new FakeIO();
    io.liveSessions.add('tx-w-unknown-ghost');

    const result = await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io });
    assert.deepEqual(io.killCalls, ['tx-w-unknown-ghost']);
    assert.equal(result.unknownSessionsKilled, 1);
  });

  it('does not double-kill a session already covered by inventory reap', async () => {
    const io = new FakeIO();
    io.liveSessions.add('tx-w-old-w1');
    seed({
      runId: 'r-old', workerId: 'w1', agentId: 'mesh/a', runnerKind: 'tmux',
      workDir: '/x', state: 'running', sessionName: 'tx-w-old-w1',
    });

    await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io });
    assert.deepEqual(io.killCalls, ['tx-w-old-w1'], 'session reaped once via inventory pass');
  });
});

describe('runBootReaper — inventory compaction', () => {
  it('compacts inventory after reap so terminal entries drop', async () => {
    const io = new FakeIO();
    seed({
      runId: 'r-old', workerId: 'w1', agentId: 'mesh/a', runnerKind: 'sdk',
      workDir: '/x', state: 'running',
    });
    seed({
      runId: CURRENT_RUN, workerId: 'w2', agentId: 'mesh/a', runnerKind: 'sdk',
      workDir: '/x', state: 'running',
    });

    await runBootReaper({ inventory: inv, currentRunId: CURRENT_RUN, io });

    // After compaction: w1 is orphaned (terminal, dropped); w2 still running (kept)
    const remaining = inv.readAll();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].workerId, 'w2');
  });
});

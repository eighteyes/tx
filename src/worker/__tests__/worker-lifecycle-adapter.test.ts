import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WorkerLifecycleAdapter, type WorkerIdentity } from '../worker-lifecycle-adapter.ts';
import { WorkerInventory, type WorkerState } from '../worker-inventory.ts';
import type { Runner } from '../runner.ts';
import type { WorkerResult } from '../../shared/types.ts';

let tmpDir: string;
let inv: WorkerInventory;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-lc-adapter-'));
  inv = new WorkerInventory(path.join(tmpDir, 'inv.jsonl'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

class FakeRunner extends EventEmitter implements Runner {
  run(): Promise<WorkerResult> { return Promise.resolve({ success: true, messagesProcessed: 0 }); }
  kill(_reason?: string): void { /* no-op */ }
  getKillReason(): string | null { return null; }
  wasGuardrailKill(): boolean { return false; }
  getSessionId(): string | null { return null; }
  isRunning(): boolean { return true; }
  async interrupt(): Promise<void> { /* no-op */ }
  async resume(_s: string, _f: string): Promise<WorkerResult> { return { success: false, messagesProcessed: 0 }; }
  resolvePermission(_id: string, _allow: boolean, _msg?: string): boolean { return false; }
}

function buildIdentity(over: Partial<WorkerIdentity> = {}): WorkerIdentity {
  return {
    runId: 'r-test',
    workerId: 'w1',
    agentId: 'mesh/agent',
    runnerKind: 'sdk',
    workDir: '/tmp',
    ...over,
  };
}

function states(): WorkerState[] {
  return inv.readAll().map(r => r.state);
}

describe('WorkerLifecycleAdapter — construction', () => {
  it('writes spawning record on construct', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    assert.deepEqual(states(), ['spawning']);
  });

  it('carries identity fields through to inventory', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({
      inventory: inv,
      runner,
      identity: buildIdentity({
        runnerKind: 'tmux',
        sessionName: 'tx-w-foo',
        claudePid: 123,
        pgid: 100,
        transcriptPath: '/tmp/t.jsonl',
      }),
    });
    const r = inv.readAll()[0];
    assert.equal(r.sessionName, 'tx-w-foo');
    assert.equal(r.claudePid, 123);
    assert.equal(r.pgid, 100);
    assert.equal(r.transcriptPath, '/tmp/t.jsonl');
  });
});

describe('WorkerLifecycleAdapter — event mapping', () => {
  it('init → running', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    runner.emit('init', { id: 'w1' });
    assert.deepEqual(states(), ['spawning', 'running']);
  });

  it('complete (sdk) → exited', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity({ runnerKind: 'sdk' }) });
    runner.emit('complete', { id: 'w1' });
    assert.deepEqual(states(), ['spawning', 'exited']);
  });

  it('complete (agent-loop) → exited', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity({ runnerKind: 'agent-loop' }) });
    runner.emit('complete', { id: 'w1' });
    assert.deepEqual(states(), ['spawning', 'exited']);
  });

  it('complete (tmux) → exiting (not exited; reaper handles verification)', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity({ runnerKind: 'tmux' }) });
    runner.emit('complete', { id: 'w1' });
    assert.deepEqual(states(), ['spawning', 'exiting']);
  });

  it('error → crashed with error string captured', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    runner.emit('error', { id: 'w1', error: 'boom' });
    const last = inv.readAll().at(-1)!;
    assert.equal(last.state, 'crashed');
    assert.match(last.reason!, /boom/);
  });

  it('interrupted → exiting', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    runner.emit('interrupted', { id: 'w1', sessionId: 's' });
    assert.deepEqual(states(), ['spawning', 'exiting']);
  });

  it('full happy path: spawning → running → exited', () => {
    const runner = new FakeRunner();
    new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    runner.emit('init', { id: 'w1' });
    runner.emit('complete', { id: 'w1' });
    assert.deepEqual(states(), ['spawning', 'running', 'exited']);
  });
});

describe('WorkerLifecycleAdapter — explicit transitions', () => {
  it('recordKill writes killed with reason', () => {
    const runner = new FakeRunner();
    const adapter = new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    adapter.recordKill('guardrail:bash');
    assert.deepEqual(states(), ['spawning', 'killed']);
    assert.equal(inv.readAll().at(-1)!.reason, 'guardrail:bash');
  });

  it('recordExited writes exited', () => {
    const runner = new FakeRunner();
    const adapter = new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    adapter.recordExited('cleanup');
    assert.deepEqual(states(), ['spawning', 'exited']);
  });

  it('recordExited is idempotent once terminal', () => {
    const runner = new FakeRunner();
    const adapter = new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    adapter.recordExited('first');
    adapter.recordExited('second');
    assert.deepEqual(states(), ['spawning', 'exited']);
  });
});

describe('WorkerLifecycleAdapter — dispose', () => {
  it('detaches listeners so post-dispose events are ignored', () => {
    const runner = new FakeRunner();
    const adapter = new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    adapter.dispose();
    runner.emit('init', { id: 'w1' });
    runner.emit('complete', { id: 'w1' });
    assert.deepEqual(states(), ['spawning'], 'no transitions after dispose');
  });

  it('dispose is idempotent', () => {
    const runner = new FakeRunner();
    const adapter = new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    adapter.dispose();
    adapter.dispose();  // should not throw
    assert.ok(true);
  });
});

describe('WorkerLifecycleAdapter — getCurrentState', () => {
  it('tracks current state through transitions', () => {
    const runner = new FakeRunner();
    const adapter = new WorkerLifecycleAdapter({ inventory: inv, runner, identity: buildIdentity() });
    assert.equal(adapter.getCurrentState(), 'spawning');
    runner.emit('init', { id: 'w1' });
    assert.equal(adapter.getCurrentState(), 'running');
    runner.emit('complete', { id: 'w1' });
    assert.equal(adapter.getCurrentState(), 'exited');
  });
});

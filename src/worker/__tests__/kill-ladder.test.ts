import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runKillLadder, type KillIO } from '../kill-ladder.ts';
import { WorkerInventory, type InventoryRecord } from '../worker-inventory.ts';
import type { Runner } from '../runner.ts';
import type { WorkerResult } from '../../shared/types.ts';
import type { FileChangeSummary } from '../../session/types.ts';

let tmpDir: string;
let inv: WorkerInventory;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-killladder-'));
  inv = new WorkerInventory(path.join(tmpDir, 'inv.jsonl'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tmuxRecord(overrides: Partial<InventoryRecord> = {}): InventoryRecord {
  return {
    ts: Date.now(),
    runId: 'r-test',
    workerId: 'w1',
    agentId: 'mesh/agent',
    runnerKind: 'tmux',
    workDir: '/tmp',
    state: 'running',
    sessionName: 'tx-w-test',
    claudePid: 12345,
    pgid: 12300,
    ...overrides,
  };
}

/** Scripted KillIO: configure isAlive to flip false after the Nth call. */
class FakeIO implements KillIO {
  calls: Array<{ op: string; arg: unknown }> = [];
  /** Set to a step name to flip isAlive→false after that step's probe. */
  dieAfter: string | null = null;
  /** Number of isAlive calls until flip. */
  isAliveCallsUntilDead = Infinity;
  private isAliveCallCount = 0;
  /** Sleeps are no-ops in tests. */
  sleep = async (_: number) => { /* zero */ };

  sendKeysCancel(s: string): boolean { this.calls.push({ op: 'sendKeysCancel', arg: s }); this.maybeFlip('send-keys-cancel'); return true; }
  sigintPid(p: number): boolean { this.calls.push({ op: 'sigintPid', arg: p }); this.maybeFlip('sigint-pid'); return true; }
  sigtermGroup(p: number): boolean { this.calls.push({ op: 'sigtermGroup', arg: p }); this.maybeFlip('sigterm-pgid'); return true; }
  sigkillGroup(p: number): boolean { this.calls.push({ op: 'sigkillGroup', arg: p }); this.maybeFlip('sigkill-pgid'); return true; }
  sigkillPid(p: number): boolean { this.calls.push({ op: 'sigkillPid', arg: p }); this.maybeFlip('sigkill-pid'); return true; }
  tmuxKillSession(s: string): boolean { this.calls.push({ op: 'tmuxKillSession', arg: s }); this.maybeFlip('tmux-kill-session'); return true; }

  isAlive(_: InventoryRecord): boolean {
    this.isAliveCallCount++;
    return this.isAliveCallCount < this.isAliveCallsUntilDead;
  }

  private maybeFlip(stepName: string): void {
    if (this.dieAfter === stepName) {
      // Next isAlive call should return false; we use the counter — set so the next call returns false
      this.isAliveCallsUntilDead = this.isAliveCallCount + 1;
    }
  }
}

class FakeRunner extends EventEmitter implements Runner {
  private running = true;
  killedReason: string | null = null;

  /** Auto-stop running after kill(); set to false to simulate stuck process. */
  stopOnKill = true;

  run(): Promise<WorkerResult> { return Promise.resolve({ success: true, messagesProcessed: 0 }); }
  kill(reason?: string): void {
    this.killedReason = reason ?? null;
    if (this.stopOnKill) this.running = false;
  }
  getKillReason(): string | null { return this.killedReason; }
  wasGuardrailKill(): boolean { return false; }
  getSessionId(): string | null { return null; }
  isRunning(): boolean { return this.running; }
  async interrupt(): Promise<void> { this.kill('interrupt'); }
  async resume(_s: string, _f: string): Promise<WorkerResult> { return { success: false, messagesProcessed: 0 }; }
  resolvePermission(_id: string, _allow: boolean, _msg?: string): boolean { return false; }
  getFilesChanged?(): FileChangeSummary { return { added: [], modified: [], deleted: [] } as unknown as FileChangeSummary; }
  hasActiveQuery?(): boolean { return this.running; }
}

describe('runKillLadder — tmux path', () => {
  it('records killed at start and exited on verified kill', async () => {
    const io = new FakeIO();
    io.dieAfter = 'send-keys-cancel';
    const rec = tmuxRecord();

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io });

    assert.equal(result.verified, true);
    assert.equal(result.finalState, 'exited');
    const states = inv.readAll().map(r => r.state);
    assert.deepEqual(states, ['killed', 'exited'], 'inventory should record killed then exited');
  });

  it('exits early on send-keys-cancel when it works', async () => {
    const io = new FakeIO();
    io.dieAfter = 'send-keys-cancel';
    const rec = tmuxRecord();

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io });
    const stepNames = result.steps.map(s => s.name);
    assert.deepEqual(stepNames, ['send-keys-cancel']);
    assert.equal(result.steps[0].verifiedDead, true);
  });

  it('escalates through the ladder when early steps fail', async () => {
    const io = new FakeIO();
    io.dieAfter = 'tmux-kill-session';
    const rec = tmuxRecord();

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io });
    const stepNames = result.steps.map(s => s.name);
    assert.deepEqual(stepNames, ['send-keys-cancel', 'sigint-pid', 'sigterm-pgid', 'tmux-kill-session']);
    assert.equal(result.verified, true);
    assert.equal(result.steps.at(-1)!.verifiedDead, true);
  });

  it('reaches SIGKILL when nothing else works until then', async () => {
    const io = new FakeIO();
    io.dieAfter = 'sigkill-pgid';
    const rec = tmuxRecord();

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io, tmuxKillTimeoutMs: 50 });
    assert.equal(result.verified, true);
    const stepNames = result.steps.map(s => s.name);
    assert.deepEqual(stepNames, ['send-keys-cancel', 'sigint-pid', 'sigterm-pgid', 'tmux-kill-session', 'sigkill-pgid']);
  });

  it('returns verified=false when worker stays alive through entire ladder', async () => {
    const io = new FakeIO();  // never flips
    const rec = tmuxRecord();

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io, tmuxKillTimeoutMs: 20 });
    assert.equal(result.verified, false);
    assert.equal(result.finalState, 'killed');
    // Inventory should NOT advance to exited
    const states = inv.readAll().map(r => r.state);
    assert.deepEqual(states, ['killed'], 'no exited transition without verification');
    // All possible steps attempted
    const stepNames = result.steps.map(s => s.name);
    assert.deepEqual(stepNames, [
      'send-keys-cancel', 'sigint-pid', 'sigterm-pgid', 'tmux-kill-session', 'sigkill-pgid', 'sigkill-pid',
    ]);
  });

  it('skips tmux steps when sessionName is absent', async () => {
    const io = new FakeIO();
    io.dieAfter = 'sigterm-pgid';
    const rec = tmuxRecord({ sessionName: undefined });

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io });
    const stepNames = result.steps.map(s => s.name);
    assert.deepEqual(stepNames, ['sigint-pid', 'sigterm-pgid']);
  });

  it('skips pgid steps when pgid is absent', async () => {
    const io = new FakeIO();
    io.dieAfter = 'sigkill-pid';
    const rec = tmuxRecord({ pgid: undefined });

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io, tmuxKillTimeoutMs: 20 });
    const stepNames = result.steps.map(s => s.name);
    // 3, 5 skipped (no pgid). 6 happens.
    assert.deepEqual(stepNames, ['send-keys-cancel', 'sigint-pid', 'tmux-kill-session', 'sigkill-pid']);
  });

  it('passes correct arguments to each kill op', async () => {
    const io = new FakeIO();
    io.dieAfter = 'sigterm-pgid';
    const rec = tmuxRecord();

    await runKillLadder(rec, { inventory: inv, reason: 'test', io });
    const ops = io.calls.map(c => `${c.op}:${c.arg}`);
    assert.ok(ops.includes('sendKeysCancel:tx-w-test'));
    assert.ok(ops.includes('sigintPid:12345'));
    assert.ok(ops.includes('sigtermGroup:12300'));
  });
});

describe('runKillLadder — in-proc path', () => {
  it('calls runner.kill and verifies when isRunning flips false', async () => {
    const runner = new FakeRunner();
    const rec = tmuxRecord({ runnerKind: 'sdk', sessionName: undefined, claudePid: undefined, pgid: undefined });
    const io = new FakeIO();

    const result = await runKillLadder(rec, { inventory: inv, runner, reason: 'test', io, inProcKillTimeoutMs: 200 });
    assert.equal(result.verified, true);
    assert.equal(runner.killedReason, 'test');
    assert.equal(result.steps[0].name, 'runner-kill');
    assert.equal(result.steps[0].verifiedDead, true);
  });

  it('returns verified=false when runner does not stop', async () => {
    const runner = new FakeRunner();
    runner.stopOnKill = false;
    const rec = tmuxRecord({ runnerKind: 'agent-loop', sessionName: undefined, claudePid: undefined, pgid: undefined });
    const io = new FakeIO();

    const result = await runKillLadder(rec, { inventory: inv, runner, reason: 'test', io, inProcKillTimeoutMs: 50 });
    assert.equal(result.verified, false);
    assert.equal(result.finalState, 'killed');
  });

  it('fails gracefully when in-proc kind has no runner attached', async () => {
    const rec = tmuxRecord({ runnerKind: 'sdk', sessionName: undefined, claudePid: undefined, pgid: undefined });
    const io = new FakeIO();

    const result = await runKillLadder(rec, { inventory: inv, reason: 'test', io });
    assert.equal(result.verified, false);
    assert.equal(result.steps[0].attempted, false);
    assert.equal(result.steps[0].details?.error, 'no runner attachment');
  });
});

describe('runKillLadder — inventory writes', () => {
  it('writes only `killed` when verification fails', async () => {
    const io = new FakeIO();
    const rec = tmuxRecord();
    await runKillLadder(rec, { inventory: inv, reason: 'test', io, tmuxKillTimeoutMs: 10 });

    const records = inv.readAll();
    assert.ok(records.length >= 1);
    assert.equal(records.every(r => r.state === 'killed'), true,
      'no record should be `exited` if not verified');
  });

  it('records carry the reason through', async () => {
    const io = new FakeIO();
    io.dieAfter = 'send-keys-cancel';
    const rec = tmuxRecord();
    await runKillLadder(rec, { inventory: inv, reason: 'guardrail:bash', io });

    const records = inv.readAll();
    assert.equal(records[0].reason, 'guardrail:bash');
    assert.match(records.at(-1)!.reason!, /verified dead/);
  });
});

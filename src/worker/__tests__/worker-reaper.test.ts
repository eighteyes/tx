import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  WorkerReaper,
  type Prober,
  type LivenessResult,
  type StateTransition,
} from '../worker-reaper.ts';
import {
  WorkerInventory,
  type InventoryRecord,
  type WorkerState,
} from '../worker-inventory.ts';

const RUN_ID = 'r-test';

let tmpDir: string;
let invPath: string;
let inv: WorkerInventory;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-reaper-'));
  invPath = path.join(tmpDir, 'inventory.jsonl');
  inv = new WorkerInventory(invPath);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Scripted prober: returns a sequence of results per workerId. */
class ScriptedProber implements Prober {
  private readonly script: Map<string, LivenessResult[]> = new Map();
  private readonly fallback: LivenessResult = { alive: true, lastActivityMs: null, details: {} };

  setSequence(workerId: string, results: LivenessResult[]): void {
    this.script.set(workerId, [...results]);
  }

  setSticky(workerId: string, result: LivenessResult): void {
    this.script.set(workerId, [result, result, result, result, result, result, result, result]);
  }

  probe(rec: InventoryRecord): LivenessResult {
    const seq = this.script.get(rec.workerId);
    if (!seq || seq.length === 0) return this.fallback;
    return seq.length === 1 ? seq[0] : seq.shift()!;
  }
}

function seed(state: WorkerState, workerId = 'w1', overrides: Partial<InventoryRecord> = {}): void {
  inv.record({
    runId: RUN_ID,
    workerId,
    agentId: 'mesh/agent',
    runnerKind: 'tmux',
    workDir: '/tmp/work',
    state,
    sessionName: `tx-w-${workerId}`,
    claudePid: 12345,
    transcriptPath: '/tmp/transcript.jsonl',
    ...overrides,
  });
}

function buildReaper(prober: Prober, now: number = 10_000): WorkerReaper {
  return new WorkerReaper({
    inventory: inv,
    runId: RUN_ID,
    prober,
    now: () => now,
    stallThresholdMs: 1000,
  });
}

describe('WorkerReaper.decide', () => {
  it('running stays running while probes are healthy', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: true, lastActivityMs: 9_500, details: {} });
    seed('running');
    const reaper = buildReaper(prober);

    const trs = await reaper.tick();
    assert.equal(trs.length, 0);
    assert.equal(inv.currentStates().get('w1')!.state, 'running');
  });

  it('running → crashed when probes fail', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: 8_000, details: { session: false, pid: false } });
    seed('running');
    const reaper = buildReaper(prober);

    const trs = await reaper.tick();
    assert.equal(trs.length, 1);
    assert.equal(trs[0].from, 'running');
    assert.equal(trs[0].to, 'crashed');
    assert.equal(inv.currentStates().get('w1')!.state, 'crashed');
  });

  it('running → stalled when no activity for threshold', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: true, lastActivityMs: 5_000, details: {} });
    seed('running');
    const reaper = buildReaper(prober, 10_000);  // 5000ms idle, threshold 1000ms

    const trs = await reaper.tick();
    assert.equal(trs.length, 1);
    assert.equal(trs[0].to, 'stalled');
  });

  it('stalled → running when activity resumes', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: true, lastActivityMs: 9_900, details: {} });  // 100ms idle
    seed('stalled');
    const reaper = buildReaper(prober, 10_000);

    const trs = await reaper.tick();
    assert.equal(trs.length, 1);
    assert.equal(trs[0].from, 'stalled');
    assert.equal(trs[0].to, 'running');
  });

  it('stalled → crashed when probes go dead', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: 5_000, details: {} });
    seed('stalled');
    const reaper = buildReaper(prober);

    const trs = await reaper.tick();
    assert.equal(trs[0].to, 'crashed');
  });

  it('killed → exited only after probes confirm dead', async () => {
    const prober = new ScriptedProber();
    seed('killed');
    const reaper = buildReaper(prober);

    // First tick: probe still says alive — stay killed
    prober.setSticky('w1', { alive: true, lastActivityMs: 9_500, details: {} });
    let trs = await reaper.tick();
    assert.equal(trs.length, 0);
    assert.equal(inv.currentStates().get('w1')!.state, 'killed');

    // Second tick: probes report dead — promote to exited
    prober.setSticky('w1', { alive: false, lastActivityMs: 9_500, details: {} });
    trs = await reaper.tick();
    assert.equal(trs.length, 1);
    assert.equal(trs[0].from, 'killed');
    assert.equal(trs[0].to, 'exited');
  });

  it('exiting → exited when probes confirm dead', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });
    seed('exiting');
    const reaper = buildReaper(prober);

    const trs = await reaper.tick();
    assert.equal(trs[0].to, 'exited');
  });

  it('crashed → exited (terminal cleanup) once probes confirm dead', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });
    seed('crashed');
    const reaper = buildReaper(prober);

    const trs = await reaper.tick();
    assert.equal(trs[0].to, 'exited');
  });

  it('terminal records are not touched', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });
    seed('exited');
    const reaper = buildReaper(prober);

    const trs = await reaper.tick();
    assert.equal(trs.length, 0);
  });

  it('foreign-run records are not touched', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });
    seed('running', 'w1', { runId: 'r-other' });
    const reaper = buildReaper(prober);

    const trs = await reaper.tick();
    assert.equal(trs.length, 0, 'reaper should not act on foreign runs');
  });
});

describe('WorkerReaper events', () => {
  it('emits verified-dead when killed → exited', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });
    seed('killed');
    const reaper = buildReaper(prober);

    const events: Array<{ workerId: string; from: WorkerState }> = [];
    reaper.on('verified-dead', e => events.push(e));

    await reaper.tick();
    assert.equal(events.length, 1);
    assert.equal(events[0].workerId, 'w1');
    assert.equal(events[0].from, 'killed');
  });

  it('emits stalled with elapsed time', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: true, lastActivityMs: 5_000, details: {} });
    seed('running');
    const reaper = buildReaper(prober, 10_000);

    const events: Array<{ workerId: string; stallMs: number }> = [];
    reaper.on('stalled', e => events.push(e));

    await reaper.tick();
    assert.equal(events.length, 1);
    assert.equal(events[0].stallMs, 5_000);
  });

  it('emits crashed when probes drop', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });
    seed('running');
    const reaper = buildReaper(prober);

    const events: Array<{ workerId: string; reason: string }> = [];
    reaper.on('crashed', e => events.push(e));

    await reaper.tick();
    assert.equal(events.length, 1);
  });

  it('emits state-change for every transition', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });
    seed('killed');
    const reaper = buildReaper(prober);

    const events: StateTransition[] = [];
    reaper.on('state-change', e => events.push(e));

    await reaper.tick();
    assert.equal(events.length, 1);
    assert.equal(events[0].to, 'exited');
  });
});

describe('WorkerReaper multi-worker', () => {
  it('processes each worker independently per tick', async () => {
    const prober = new ScriptedProber();
    prober.setSticky('w1', { alive: false, lastActivityMs: null, details: {} });  // running → crashed
    prober.setSticky('w2', { alive: true, lastActivityMs: 9_900, details: {} });  // running stays
    prober.setSticky('w3', { alive: false, lastActivityMs: null, details: {} });  // killed → exited

    seed('running', 'w1');
    seed('running', 'w2');
    seed('killed', 'w3');

    const reaper = buildReaper(prober, 10_000);
    const trs = await reaper.tick();

    const byId = new Map(trs.map(t => [t.workerId, t]));
    assert.equal(trs.length, 2);
    assert.equal(byId.get('w1')!.to, 'crashed');
    assert.equal(byId.get('w3')!.to, 'exited');
    assert.equal(inv.currentStates().get('w2')!.state, 'running');
  });
});

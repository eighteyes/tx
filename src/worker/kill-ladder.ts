/**
 * Kill ladder — verified-dead teardown for any runner kind.
 *
 * Steps (tmux):
 *   1. tmux send-keys C-c          (polite cancel of the TUI)
 *   2. SIGINT to claude PID
 *   3. SIGTERM to process group    (takes claude + MCP + subshells)
 *   4. tmux kill-session           (with up to 3s poll for disappearance)
 *   5. SIGKILL to process group
 *   6. SIGKILL to claude PID       (last resort if pgid was missing/wrong)
 *
 * Steps (sdk / agent-loop):
 *   1. runner.kill(reason)         (poll runner.isRunning() until false)
 *
 * Between every step we probe liveness. The ladder exits early the moment
 * probes confirm dead. If the ladder exhausts all steps with the worker still
 * alive, it returns verified=false and leaves the inventory in `killed` —
 * the reaper will keep checking and flip to `exited` when probes finally drop.
 *
 * All side effects go through `KillIO` so tests can script liveness.
 */

import { execSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { log } from '../shared/logger.ts';
import {
  WorkerInventory,
  type InventoryRecord,
} from './worker-inventory.ts';
import {
  tmuxSessionAlive,
  pidAlive,
} from './liveness.ts';
import type { Runner } from './runner.ts';

const SAFE_TMUX_NAME = /^[a-zA-Z0-9_.-]+$/;

export interface KillStep {
  name: string;
  attempted: boolean;
  succeeded: boolean;
  verifiedDead: boolean;
  details?: Record<string, unknown>;
}

export interface KillResult {
  verified: boolean;
  steps: KillStep[];
  finalState: 'exited' | 'killed';
  durationMs: number;
}

/** Side-effecting operations. Injectable so unit tests can script liveness. */
export interface KillIO {
  sendKeysCancel(session: string): boolean;
  sigintPid(pid: number): boolean;
  sigtermGroup(pgid: number): boolean;
  sigkillGroup(pgid: number): boolean;
  sigkillPid(pid: number): boolean;
  tmuxKillSession(session: string): boolean;
  /** Composite liveness: session OR pid alive. */
  isAlive(rec: InventoryRecord): boolean;
  sleep(ms: number): Promise<void>;
}

export interface KillLadderOptions {
  inventory: WorkerInventory;
  /** Required for sdk / agent-loop kinds; ignored for tmux. */
  runner?: Runner;
  reason: string;
  io?: KillIO;
  stepDelayMs?: number;
  tmuxKillTimeoutMs?: number;
  inProcKillTimeoutMs?: number;
}

export function defaultKillIO(): KillIO {
  return {
    sendKeysCancel(session: string): boolean {
      if (!SAFE_TMUX_NAME.test(session)) return false;
      try {
        execSync(`tmux send-keys -t '${session}' C-c`, { stdio: 'pipe' });
        return true;
      } catch { return false; }
    },
    sigintPid(pid: number): boolean {
      try { process.kill(pid, 'SIGINT'); return true; } catch { return false; }
    },
    sigtermGroup(pgid: number): boolean {
      try { process.kill(-pgid, 'SIGTERM'); return true; } catch { return false; }
    },
    sigkillGroup(pgid: number): boolean {
      try { process.kill(-pgid, 'SIGKILL'); return true; } catch { return false; }
    },
    sigkillPid(pid: number): boolean {
      try { process.kill(pid, 'SIGKILL'); return true; } catch { return false; }
    },
    tmuxKillSession(session: string): boolean {
      if (!SAFE_TMUX_NAME.test(session)) return false;
      try {
        execSync(`tmux kill-session -t '${session}'`, { stdio: 'pipe' });
        return true;
      } catch { return false; }
    },
    isAlive(rec: InventoryRecord): boolean {
      const s = rec.sessionName ? tmuxSessionAlive(rec.sessionName) : false;
      const p = pidAlive(rec.claudePid);
      return s || p;
    },
    sleep(ms: number): Promise<void> {
      return delay(ms);
    },
  };
}

export async function runKillLadder(
  record: InventoryRecord,
  opts: KillLadderOptions
): Promise<KillResult> {
  const startedAt = Date.now();
  const io = opts.io ?? defaultKillIO();
  const steps: KillStep[] = [];

  // Immediately record `killed` so the reaper / status can observe intent.
  writeRecord(opts.inventory, record, 'killed', opts.reason);

  log.warn('kill-ladder', `starting kill ${record.workerId}`, {
    runnerKind: record.runnerKind,
    reason: opts.reason,
    sessionName: record.sessionName,
    claudePid: record.claudePid,
    pgid: record.pgid,
  });

  let verified = false;
  try {
    verified = record.runnerKind === 'tmux'
      ? await runTmuxLadder(record, io, opts, steps)
      : await runInProcLadder(record, io, opts, steps);
  } catch (err) {
    log.error('kill-ladder', 'ladder threw', {
      workerId: record.workerId,
      error: String(err),
    });
  }

  if (verified) {
    writeRecord(opts.inventory, record, 'exited',
      `verified dead via kill ladder (${steps.filter(s => s.attempted).length} steps)`);
  } else {
    log.warn('kill-ladder', 'ladder exhausted without verified dead — reaper will retry', {
      workerId: record.workerId,
      steps: steps.map(s => ({ name: s.name, attempted: s.attempted, succeeded: s.succeeded, verifiedDead: s.verifiedDead })),
    });
  }

  return {
    verified,
    steps,
    finalState: verified ? 'exited' : 'killed',
    durationMs: Date.now() - startedAt,
  };
}

async function runTmuxLadder(
  record: InventoryRecord,
  io: KillIO,
  opts: KillLadderOptions,
  steps: KillStep[]
): Promise<boolean> {
  const stepDelay = opts.stepDelayMs ?? 500;
  const session = record.sessionName;
  const claudePid = record.claudePid;
  const pgid = record.pgid;

  // 1. send-keys C-c
  if (session) {
    const s = await runStep('send-keys-cancel', () => io.sendKeysCancel(session));
    await io.sleep(stepDelay);
    s.verifiedDead = !io.isAlive(record);
    steps.push(s);
    if (s.verifiedDead) return true;
  }

  // 2. SIGINT to claude PID
  if (claudePid) {
    const s = await runStep('sigint-pid', () => io.sigintPid(claudePid));
    await io.sleep(stepDelay);
    s.verifiedDead = !io.isAlive(record);
    steps.push(s);
    if (s.verifiedDead) return true;
  }

  // 3. SIGTERM to process group (claude + MCP + subshells)
  if (pgid) {
    const s = await runStep('sigterm-pgid', () => io.sigtermGroup(pgid));
    await io.sleep(stepDelay * 2);  // graceful window
    s.verifiedDead = !io.isAlive(record);
    steps.push(s);
    if (s.verifiedDead) return true;
  }

  // 4. tmux kill-session with poll
  if (session) {
    const s = await runStep('tmux-kill-session', () => io.tmuxKillSession(session));
    const deadline = Date.now() + (opts.tmuxKillTimeoutMs ?? 3000);
    while (Date.now() < deadline) {
      if (!io.isAlive(record)) { s.verifiedDead = true; break; }
      await io.sleep(100);
    }
    steps.push(s);
    if (s.verifiedDead) return true;
  }

  // 5. SIGKILL to process group
  if (pgid) {
    const s = await runStep('sigkill-pgid', () => io.sigkillGroup(pgid));
    await io.sleep(stepDelay);
    s.verifiedDead = !io.isAlive(record);
    steps.push(s);
    if (s.verifiedDead) return true;
  }

  // 6. SIGKILL to claude PID (last resort if pgid was missing/wrong)
  if (claudePid) {
    const s = await runStep('sigkill-pid', () => io.sigkillPid(claudePid));
    await io.sleep(stepDelay);
    s.verifiedDead = !io.isAlive(record);
    steps.push(s);
    if (s.verifiedDead) return true;
  }

  return false;
}

async function runInProcLadder(
  record: InventoryRecord,
  io: KillIO,
  opts: KillLadderOptions,
  steps: KillStep[]
): Promise<boolean> {
  const runner = opts.runner;
  if (!runner) {
    log.error('kill-ladder', 'in-proc kill missing runner attachment', { workerId: record.workerId });
    steps.push({ name: 'runner-kill', attempted: false, succeeded: false, verifiedDead: false,
      details: { error: 'no runner attachment' } });
    return false;
  }

  const step = await runStep('runner-kill', () => { runner.kill(opts.reason); return true; });
  steps.push(step);

  const deadline = Date.now() + (opts.inProcKillTimeoutMs ?? 5000);
  while (Date.now() < deadline) {
    if (!runner.isRunning()) {
      step.verifiedDead = true;
      return true;
    }
    await io.sleep(100);
  }
  return false;
}

async function runStep(name: string, action: () => boolean | Promise<boolean>): Promise<KillStep> {
  const step: KillStep = { name, attempted: true, succeeded: false, verifiedDead: false };
  try {
    step.succeeded = await action();
  } catch (err) {
    step.details = { error: String(err) };
    log.warn('kill-ladder', `step ${name} threw`, { error: String(err) });
  }
  return step;
}

function writeRecord(
  inventory: WorkerInventory,
  rec: InventoryRecord,
  state: InventoryRecord['state'],
  reason: string
): void {
  inventory.record({
    runId: rec.runId,
    workerId: rec.workerId,
    agentId: rec.agentId,
    runnerKind: rec.runnerKind,
    workDir: rec.workDir,
    state,
    sessionName: rec.sessionName,
    claudePid: rec.claudePid,
    pgid: rec.pgid,
    transcriptPath: rec.transcriptPath,
    reason,
  });
}

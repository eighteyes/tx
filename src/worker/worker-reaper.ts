/**
 * WorkerReaper — out-of-band heartbeat and zombie detector.
 *
 * Reads the inventory as source of truth, probes liveness per runner kind, and
 * emits state-change events. Does NOT make policy decisions (nudge/kill/cleanup);
 * the dispatcher subscribes and acts.
 *
 * State machine:
 *   spawning|running →─ probes fail ─→ crashed ─ probes confirm dead ─→ exited (terminal)
 *                  ↘─ no activity ─→ stalled ─ activity resumes ─→ running
 *                                          ↘─ probes fail ─→ crashed
 *   killed|exiting ─ probes confirm dead ─→ exited (terminal)
 *
 * Terminal states (`exited`, `orphaned`) are skipped on every tick.
 *
 * The reaper never transitions a worker INTO `killed` — that's the kill-ladder's
 * job. It only transitions OUT of `killed` via `verified-dead`.
 */

import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';
import {
  WorkerInventory,
  type InventoryRecord,
  type WorkerState,
  type RunnerKind,
  isTerminal,
} from './worker-inventory.ts';
import {
  tmuxSessionAlive,
  pidAlive,
  transcriptMtime,
} from './liveness.ts';
import type { Runner } from './runner.ts';

export interface ReaperOptions {
  inventory: WorkerInventory;
  runId: string;
  pollIntervalMs?: number;     // default 3000
  stallThresholdMs?: number;   // default 60000 — no activity for this long → stalled
  now?: () => number;          // injectable clock for tests
  prober?: Prober;             // injectable for tests; defaults to built-in dispatch
}

export interface StateTransition {
  workerId: string;
  from: WorkerState;
  to: WorkerState;
  reason: string;
  at: number;
}

export interface LivenessResult {
  alive: boolean;
  lastActivityMs: number | null;
  details: Record<string, unknown>;
}

export interface Prober {
  probe(rec: InventoryRecord): LivenessResult;
}

/** In-process runner attachment so the reaper can read live state (sdk / agent-loop). */
interface RunnerAttachment {
  runner: Runner;
  lastOutputAt: number;
}

export class WorkerReaper extends EventEmitter {
  private readonly inventory: WorkerInventory;
  private readonly runId: string;
  private readonly pollIntervalMs: number;
  private readonly stallThresholdMs: number;
  private readonly clock: () => number;

  private timer: NodeJS.Timeout | null = null;
  private readonly attached: Map<string, RunnerAttachment> = new Map();
  private readonly prober: Prober;

  constructor(opts: ReaperOptions) {
    super();
    this.setMaxListeners(50);
    this.inventory = opts.inventory;
    this.runId = opts.runId;
    this.pollIntervalMs = opts.pollIntervalMs ?? 3000;
    this.stallThresholdMs = opts.stallThresholdMs ?? 60_000;
    this.clock = opts.now ?? (() => Date.now());
    this.prober = opts.prober ?? new DefaultProber(this.attached);
  }

  start(): void {
    if (this.timer) return;
    log.info('reaper', 'WorkerReaper started', {
      runId: this.runId,
      pollIntervalMs: this.pollIntervalMs,
      stallThresholdMs: this.stallThresholdMs,
    });
    this.timer = setInterval(() => {
      this.tick().catch(err => {
        log.error('reaper', 'tick failed', { error: String(err) });
      });
    }, this.pollIntervalMs);
    // Don't keep the event loop alive on the reaper alone
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('reaper', 'WorkerReaper stopped');
    }
  }

  /**
   * Attach an in-process runner so probes can read its `isRunning()` and we
   * can track its last-output timestamp. Required for sdk / agent-loop kinds.
   */
  attachRunner(workerId: string, runner: Runner): void {
    const att: RunnerAttachment = { runner, lastOutputAt: this.clock() };
    this.attached.set(workerId, att);
    // Bump lastOutputAt on every output event so the stall probe stays honest.
    runner.on('output', () => {
      att.lastOutputAt = this.clock();
    });
    runner.on('init', () => {
      att.lastOutputAt = this.clock();
    });
  }

  detachRunner(workerId: string): void {
    this.attached.delete(workerId);
  }

  /** Single sweep. Returns the transitions emitted this tick (for tests). */
  async tick(): Promise<StateTransition[]> {
    const transitions: StateTransition[] = [];
    const now = this.clock();

    for (const record of this.inventory.currentStates().values()) {
      if (isTerminal(record.state)) continue;
      // Only act on records for the current run. Foreign-run records are the
      // boot reaper's responsibility (different module, different sweep).
      if (record.runId !== this.runId) continue;

      const probe = this.prober.probe(record);
      const next = this.decide(record, probe, now);
      if (next) {
        this.inventory.record({
          runId: record.runId,
          workerId: record.workerId,
          agentId: record.agentId,
          runnerKind: record.runnerKind,
          workDir: record.workDir,
          state: next.to,
          sessionName: record.sessionName,
          claudePid: record.claudePid,
          pgid: record.pgid,
          transcriptPath: record.transcriptPath,
          reason: next.reason,
        });
        transitions.push(next);
        log.info('reaper', `transition ${record.workerId}: ${next.from} → ${next.to}`, {
          reason: next.reason,
          probe: probe.details,
        });
        this.emit('state-change', next);
        if (next.to === 'exited' && (next.from === 'killed' || next.from === 'exiting' || next.from === 'crashed')) {
          this.emit('verified-dead', { workerId: record.workerId, from: next.from });
        }
        if (next.to === 'stalled') {
          this.emit('stalled', { workerId: record.workerId, stallMs: now - (probe.lastActivityMs ?? now) });
        }
        if (next.to === 'crashed') {
          this.emit('crashed', { workerId: record.workerId, reason: next.reason });
        }
      }
    }

    return transitions;
  }

  /** Apply the state machine table. Returns the new transition, or null if no change. */
  private decide(rec: InventoryRecord, probe: LivenessResult, now: number): StateTransition | null {
    const idle = probe.lastActivityMs == null ? Infinity : now - probe.lastActivityMs;

    switch (rec.state) {
      case 'spawning':
      case 'running': {
        if (!probe.alive) {
          return this.mk(rec, 'crashed', `liveness probes failed (${formatDetails(probe.details)})`, now);
        }
        if (idle > this.stallThresholdMs) {
          return this.mk(rec, 'stalled', `no activity for ${Math.round(idle)}ms`, now);
        }
        return null;
      }

      case 'stalled': {
        if (!probe.alive) {
          return this.mk(rec, 'crashed', 'died while stalled', now);
        }
        if (idle < this.stallThresholdMs) {
          return this.mk(rec, 'running', `activity resumed (${Math.round(idle)}ms since last)`, now);
        }
        return null;
      }

      case 'killed':
      case 'exiting': {
        if (!probe.alive) {
          return this.mk(rec, 'exited', `verified dead during ${rec.state}`, now);
        }
        return null;
      }

      case 'crashed': {
        if (!probe.alive) {
          return this.mk(rec, 'exited', 'crash confirmed terminal', now);
        }
        return null;
      }

      default:
        return null;
    }
  }

  private mk(rec: InventoryRecord, to: WorkerState, reason: string, at: number): StateTransition {
    return { workerId: rec.workerId, from: rec.state, to, reason, at };
  }
}

/**
 * Default prober: dispatches by runner kind.
 * - tmux: session + claude PID + transcript mtime
 * - sdk / agent-loop: in-proc runner attachment (Runner.isRunning + lastOutputAt)
 */
export class DefaultProber implements Prober {
  constructor(private readonly attached: Map<string, RunnerAttachment>) {}

  probe(rec: InventoryRecord): LivenessResult {
    switch (rec.runnerKind) {
      case 'tmux': return this.probeTmux(rec);
      case 'sdk':
      case 'agent-loop':
        return this.probeAttached(rec);
    }
  }

  private probeTmux(rec: InventoryRecord): LivenessResult {
    const session = rec.sessionName ? tmuxSessionAlive(rec.sessionName) : false;
    const pid = pidAlive(rec.claudePid);
    const mtime = transcriptMtime(rec.transcriptPath);
    // Session OR pid must be alive — claude can briefly transition the shell
    // (e.g. between resumes) and the inventory may lag. Both dead = truly dead.
    const alive = session || pid;
    return {
      alive,
      lastActivityMs: mtime,
      details: { session, pid, mtime, sessionName: rec.sessionName, claudePid: rec.claudePid },
    };
  }

  private probeAttached(rec: InventoryRecord): LivenessResult {
    const att = this.attached.get(rec.workerId);
    if (!att) {
      // No attachment — we can't probe an in-process runner without it.
      // Treat as unknown: assume alive but with no activity signal. The
      // dispatcher should always attach in-proc runners; missing attachment
      // is a bug, not a zombie indicator.
      return { alive: true, lastActivityMs: null, details: { attached: false } };
    }
    return {
      alive: att.runner.isRunning(),
      lastActivityMs: att.lastOutputAt,
      details: { attached: true, isRunning: att.runner.isRunning() },
    };
  }
}

function formatDetails(d: Record<string, unknown>): string {
  return Object.entries(d).map(([k, v]) => `${k}=${v}`).join(', ');
}

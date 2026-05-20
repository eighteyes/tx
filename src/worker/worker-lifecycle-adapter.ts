/**
 * WorkerLifecycleAdapter — per-worker bridge from Runner events to the inventory.
 *
 * Created when a worker is added to the lifecycle manager, disposed when removed.
 * Translates the existing Runner event surface (`start` / `init` / `complete` /
 * `error` / `interrupted`) into inventory state transitions without modifying
 * any runner implementation.
 *
 * Mapping:
 *   construct       → spawning
 *   'init'          → running
 *   'complete'      → exited     (in-proc runners are definitively dead here;
 *                                  for tmux runners the runner emits its own
 *                                  exiting/exited via the kill ladder instead)
 *   'error'         → crashed
 *   'interrupted'   → exiting    (kill ladder or reaper flips to exited)
 *
 * Kill intent is recorded explicitly via `recordKill(reason)` from the dispatcher
 * at the moment it calls `runner.kill()`. We can't infer that from events alone.
 */

import type { Runner } from './runner.ts';
import {
  WorkerInventory,
  type InventoryRecord,
  type WorkerState,
  type RunnerKind,
} from './worker-inventory.ts';

export interface WorkerIdentity {
  runId: string;
  workerId: string;
  agentId: string;
  runnerKind: RunnerKind;
  workDir: string;
  sessionName?: string;
  claudePid?: number;
  pgid?: number;
  transcriptPath?: string;
}

export interface WorkerLifecycleAdapterOptions {
  inventory: WorkerInventory;
  runner: Runner;
  identity: WorkerIdentity;
}

type Listener = (...args: unknown[]) => void;

export class WorkerLifecycleAdapter {
  private readonly inventory: WorkerInventory;
  private readonly identity: WorkerIdentity;
  private readonly runner: Runner;
  private readonly listeners: Array<{ event: string; fn: Listener }> = [];
  private currentState: WorkerState = 'spawning';
  private disposed = false;

  constructor(opts: WorkerLifecycleAdapterOptions) {
    this.inventory = opts.inventory;
    this.identity = opts.identity;
    this.runner = opts.runner;

    this.write('spawning', 'worker created');

    this.bind('init', () => this.write('running', 'init received'));
    this.bind('complete', () => {
      // For sdk/agent-loop: process is in-proc and is done. exited is correct.
      // For tmux: complete is emitted on result-line, but session/PID may
      // linger. The kill ladder or reaper handles the exiting→exited flip.
      if (this.identity.runnerKind === 'tmux') {
        this.write('exiting', 'complete event (tmux teardown in progress)');
      } else {
        this.write('exited', 'complete event');
      }
    });
    this.bind('error', (event: unknown) => {
      const reason = isErrorEvent(event) ? `error: ${event.error}` : 'error event';
      this.write('crashed', reason);
    });
    this.bind('interrupted', () => this.write('exiting', 'interrupted'));
  }

  /** Caller invokes this when issuing a kill so intent shows up in the inventory. */
  recordKill(reason: string): void {
    this.write('killed', reason);
  }

  /** Manual exited transition (e.g. caller knows runner is gone). Idempotent w.r.t. duplicates. */
  recordExited(reason: string): void {
    if (this.currentState === 'exited' || this.currentState === 'orphaned') return;
    this.write('exited', reason);
  }

  getCurrentState(): WorkerState {
    return this.currentState;
  }

  /** Detach listeners. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { event, fn } of this.listeners) {
      this.runner.off(event, fn);
    }
    this.listeners.length = 0;
  }

  private bind(event: string, fn: Listener): void {
    this.runner.on(event, fn);
    this.listeners.push({ event, fn });
  }

  private write(state: WorkerState, reason: string): void {
    this.currentState = state;
    this.inventory.record({
      runId: this.identity.runId,
      workerId: this.identity.workerId,
      agentId: this.identity.agentId,
      runnerKind: this.identity.runnerKind,
      workDir: this.identity.workDir,
      state,
      sessionName: this.identity.sessionName,
      claudePid: this.identity.claudePid,
      pgid: this.identity.pgid,
      transcriptPath: this.identity.transcriptPath,
      reason,
    });
  }
}

function isErrorEvent(e: unknown): e is { error: string } {
  return typeof e === 'object' && e !== null && 'error' in e && typeof (e as { error: unknown }).error === 'string';
}

/** Pull identity fields off an InventoryRecord (utility for record-driven lookups). */
export function identityFromRecord(r: InventoryRecord): WorkerIdentity {
  return {
    runId: r.runId,
    workerId: r.workerId,
    agentId: r.agentId,
    runnerKind: r.runnerKind,
    workDir: r.workDir,
    sessionName: r.sessionName,
    claudePid: r.claudePid,
    pgid: r.pgid,
    transcriptPath: r.transcriptPath,
  };
}

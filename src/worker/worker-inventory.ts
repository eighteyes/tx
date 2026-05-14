/**
 * Worker Inventory — durable record of worker state transitions.
 *
 * Append-only JSONL at `.ai/tx/data/worker-inventory.jsonl`. Survives TX crashes:
 * the boot reaper reads it on next startup to find sessions/processes needing cleanup.
 *
 * Fold semantics: latest record per `workerId` wins. Non-terminal entries from
 * prior runs are the reaper's kill list.
 *
 * Sync writes (appendFileSync): state transitions are O(few per worker), not
 * O(per tool call). Crash safety beats throughput here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';

export type WorkerState =
  | 'spawning'   // tmux session created / SDK query() about to start
  | 'running'    // first signs of life observed (init message / first transcript line)
  | 'stalled'    // no observable progress for stall threshold (still alive)
  | 'killed'     // explicit kill issued; awaiting verified-dead probes
  | 'crashed'    // process gone without a result message
  | 'exiting'    // result observed, teardown in progress
  | 'exited'     // verified dead by liveness probes; terminal
  | 'orphaned';  // discovered post-mortem (TX restart); terminal after reap

export type RunnerKind = 'sdk' | 'tmux' | 'agent-loop';

export interface InventoryRecord {
  ts: number;             // ms epoch
  runId: string;
  workerId: string;
  agentId: string;
  runnerKind: RunnerKind;
  workDir: string;
  state: WorkerState;
  sessionName?: string;    // tmux only
  claudePid?: number;      // tmux only — the claude process PID
  pgid?: number;           // tmux only — process group id (`kill -- -PGID` for subtree)
  transcriptPath?: string; // tmux only — JSONL path under ~/.claude/projects/...
  reason?: string;         // human-readable transition reason
}

export const TERMINAL_STATES: ReadonlySet<WorkerState> = new Set<WorkerState>(['exited', 'orphaned']);

export function isTerminal(state: WorkerState): boolean {
  return TERMINAL_STATES.has(state);
}

export class WorkerInventory {
  private readonly file: string;

  constructor(filePath: string) {
    this.file = filePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  get path(): string {
    return this.file;
  }

  /** Append a single state transition. */
  record(entry: Omit<InventoryRecord, 'ts'>): void {
    const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
    try {
      fs.appendFileSync(this.file, line);
    } catch (err) {
      log.error('worker-inventory', 'Failed to append inventory record', {
        workerId: entry.workerId,
        state: entry.state,
        error: String(err),
      });
    }
  }

  /** Read every record in append order. Skips malformed lines with a warning. */
  readAll(): InventoryRecord[] {
    if (!fs.existsSync(this.file)) return [];
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf-8');
    } catch (err) {
      log.error('worker-inventory', 'Failed to read inventory', { error: String(err) });
      return [];
    }
    const records: InventoryRecord[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as InventoryRecord);
      } catch (err) {
        log.warn('worker-inventory', 'Skipping malformed inventory line', {
          line: trimmed.slice(0, 120),
          error: String(err),
        });
      }
    }
    return records;
  }

  /** Fold all records: latest entry per workerId. */
  currentStates(): Map<string, InventoryRecord> {
    const map = new Map<string, InventoryRecord>();
    for (const r of this.readAll()) {
      map.set(r.workerId, r);
    }
    return map;
  }

  /** Entries whose latest state is non-terminal — the boot reaper's kill list. */
  nonTerminal(): InventoryRecord[] {
    return Array.from(this.currentStates().values()).filter(r => !isTerminal(r.state));
  }

  /** Non-terminal entries from runs other than the supplied one. */
  forOtherRuns(currentRunId: string): InventoryRecord[] {
    return this.nonTerminal().filter(r => r.runId !== currentRunId);
  }

  /**
   * Rewrite the file keeping only non-terminal entries. Call on clean shutdown
   * after the in-flight workers have been killed and recorded terminal, to keep
   * the file from growing unboundedly across many runs.
   */
  compact(): void {
    const keep = this.nonTerminal();
    const body = keep.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(this.file, body ? body + '\n' : '');
  }

  /** Delete the file. Tests / hard-reset only. */
  clear(): void {
    if (fs.existsSync(this.file)) {
      fs.unlinkSync(this.file);
    }
  }
}

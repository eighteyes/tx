/**
 * Boot reaper — one-shot reconciliation at TX startup.
 *
 * Runs BEFORE the dispatcher accepts work. Reads the inventory, sweeps any
 * non-terminal entries from prior runs, kills surviving tmux sessions, then
 * compacts the file.
 *
 * Safety: we deliberately do NOT trust claudePid liveness probes here. PIDs
 * are reused across reboots; a stale record could falsely "kill" an unrelated
 * process. The only authoritative signal for prior-run tmux workers is the
 * tmux session itself. In-proc runners (sdk / agent-loop) are gone by
 * definition once TX has restarted.
 *
 * Always paired with `WorkerInventory.compact()` so the file stays bounded.
 */

import { execSync } from 'node:child_process';
import { WorkerInventory, type InventoryRecord } from './worker-inventory.ts';
import { listTmuxWorkerSessions, tmuxSessionAlive } from './liveness.ts';
import { log } from '../shared/logger.ts';

export interface BootReaperResult {
  /** Prior-run inventory entries marked orphaned. */
  inventoryReaped: number;
  /** Tmux sessions matching tx-w-* without any inventory entry that we killed. */
  unknownSessionsKilled: number;
  /** Tmux kill attempts that failed. */
  failures: number;
}

/**
 * IO surface — kept minimal because the boot reaper does not run the kill
 * ladder. tmux session kill is sufficient at this granularity.
 */
export interface BootReaperIO {
  tmuxSessionAlive(name: string): boolean;
  tmuxKillSession(name: string): boolean;
  listTmuxWorkerSessions(): string[];
}

export interface BootReaperOptions {
  inventory: WorkerInventory;
  currentRunId: string;
  io?: BootReaperIO;
  /** Compact the inventory after reap. Default true. Tests may disable to inspect orphaned records. */
  compact?: boolean;
}

export function defaultBootReaperIO(): BootReaperIO {
  return {
    tmuxSessionAlive,
    tmuxKillSession(name: string): boolean {
      // Defensive shell escape; same rule as elsewhere
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return false;
      try {
        execSync(`tmux kill-session -t '${name}'`, { stdio: 'pipe' });
        return true;
      } catch { return false; }
    },
    listTmuxWorkerSessions,
  };
}

export async function runBootReaper(opts: BootReaperOptions): Promise<BootReaperResult> {
  const io = opts.io ?? defaultBootReaperIO();
  const result: BootReaperResult = {
    inventoryReaped: 0,
    unknownSessionsKilled: 0,
    failures: 0,
  };

  const foreign = opts.inventory.forOtherRuns(opts.currentRunId);
  log.info('boot-reaper', 'starting reconciliation', {
    currentRunId: opts.currentRunId,
    foreignEntries: foreign.length,
  });

  // 1. Reap inventory entries from prior runs
  for (const rec of foreign) {
    if (rec.runnerKind === 'tmux' && rec.sessionName) {
      // Session is the authoritative liveness signal across reboots
      if (!io.tmuxSessionAlive(rec.sessionName)) {
        writeOrphaned(opts.inventory, rec, 'reaped at boot (session already gone)');
        result.inventoryReaped++;
        continue;
      }
      log.warn('boot-reaper', 'killing zombie tmux session from prior run', {
        workerId: rec.workerId,
        runId: rec.runId,
        sessionName: rec.sessionName,
      });
      if (io.tmuxKillSession(rec.sessionName)) {
        writeOrphaned(opts.inventory, rec, 'reaped at boot (session killed)');
        result.inventoryReaped++;
      } else {
        log.error('boot-reaper', 'failed to kill tmux session', {
          workerId: rec.workerId,
          sessionName: rec.sessionName,
        });
        result.failures++;
      }
    } else {
      // sdk / agent-loop — definitely gone since the host TX restarted
      writeOrphaned(opts.inventory, rec, 'reaped at boot (in-proc runner; TX restarted)');
      result.inventoryReaped++;
    }
  }

  // 2. Defensive sweep: live tx-w-* sessions with no inventory entry
  // (covers the case where inventory write was lost before crash)
  const knownSessions = new Set<string>();
  for (const r of opts.inventory.readAll()) {
    if (r.sessionName) knownSessions.add(r.sessionName);
  }
  for (const sess of io.listTmuxWorkerSessions()) {
    if (knownSessions.has(sess)) continue;
    log.warn('boot-reaper', 'killing unknown tx-worker session (no inventory entry)', {
      session: sess,
    });
    if (io.tmuxKillSession(sess)) {
      result.unknownSessionsKilled++;
    } else {
      result.failures++;
    }
  }

  // 3. Compact: drop terminal entries; what remains is just the current run's
  // (which started empty), so the file shrinks to near-zero.
  if (opts.compact !== false) {
    opts.inventory.compact();
  }

  log.info('boot-reaper', 'complete', { ...result });
  return result;
}

function writeOrphaned(
  inventory: WorkerInventory,
  rec: InventoryRecord,
  reason: string
): void {
  inventory.record({
    runId: rec.runId,
    workerId: rec.workerId,
    agentId: rec.agentId,
    runnerKind: rec.runnerKind,
    workDir: rec.workDir,
    state: 'orphaned',
    sessionName: rec.sessionName,
    claudePid: rec.claudePid,
    pgid: rec.pgid,
    transcriptPath: rec.transcriptPath,
    reason,
  });
}

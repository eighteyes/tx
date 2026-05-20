/**
 * Run ID — identifies a single `tx start` lifecycle.
 *
 * Used to:
 * - Tag every inventory record so cross-run reconciliation is unambiguous
 * - Name tmux sessions so the boot reaper can identify own orphans vs.
 *   other TX instances vs. unrelated `tx-w-*` sessions
 * - Disambiguate concurrent TX instances sharing a workdir
 *
 * Format: `r-<base36-ts>-<base64url-rand>` — sortable, ~15 chars.
 *
 * NOT auto-generated on import. Caller (start.ts) creates one explicitly so
 * tests can inject deterministic IDs.
 */

import crypto from 'node:crypto';

const RUN_ID_PREFIX = 'r-';

export function generateRunId(now: number = Date.now()): string {
  const ts = now.toString(36);
  const rand = crypto.randomBytes(4).toString('base64url').slice(0, 6);
  return `${RUN_ID_PREFIX}${ts}-${rand}`;
}

export function isRunId(s: string): boolean {
  return s.startsWith(RUN_ID_PREFIX) && s.length > RUN_ID_PREFIX.length;
}

/**
 * Build a tmux session name for a worker.
 * Embeds the run ID so the boot reaper can match own sessions, plus a per-worker
 * instance tag so parallel workers for one agent don't collide.
 */
export function workerSessionName(runId: string, agentId: string): string {
  const runBody = runId.startsWith(RUN_ID_PREFIX) ? runId.slice(RUN_ID_PREFIX.length) : runId;
  const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 14);
  const inst = crypto.randomBytes(2).toString('hex');
  return `tx-w-${runBody}-${safeAgent}-${inst}`;
}

/** Broad filter for any TX worker session. Reaper uses inventory to disambiguate by run. */
export function isTmuxWorkerSession(name: string): boolean {
  return name.startsWith('tx-w-');
}

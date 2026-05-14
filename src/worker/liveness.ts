/**
 * Liveness probes — small, independent checks the reaper composes to decide
 * "is this worker actually alive?"
 *
 * Each probe answers ONE question and never combines signals. The reaper AND's
 * them with stall thresholds; the kill ladder uses them to verify dead.
 *
 * - `tmuxSessionAlive`     — `tmux has-session`
 * - `pidAlive`             — `kill(pid, 0)`
 * - `transcriptMtime`      — `stat` mtime on the JSONL transcript
 * - `listTmuxWorkerSessions` — `tmux ls` filtered to `tx-w-*`
 * - `tmuxPanePid`          — `tmux list-panes` to get the pane's shell PID
 * - `findDescendantPid`    — walk `ps` tree to find claude under a shell
 * - `getPgid`              — `ps -o pgid=` for `kill -- -PGID` group sweeps
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { log } from '../shared/logger.ts';

const SAFE_TMUX_NAME = /^[a-zA-Z0-9_.-]+$/;

function isSafeTmuxName(name: string): boolean {
  return SAFE_TMUX_NAME.test(name);
}

export function tmuxSessionAlive(sessionName: string): boolean {
  if (!isSafeTmuxName(sessionName)) {
    log.warn('liveness', 'refusing tmuxSessionAlive on unsafe name', { sessionName });
    return false;
  }
  try {
    execSync(`tmux has-session -t '${sessionName}'`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function pidAlive(pid: number | undefined | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Modification time of the transcript JSONL in ms, or null if absent/unreadable. */
export function transcriptMtime(transcriptPath: string | undefined | null): number | null {
  if (!transcriptPath) return null;
  try {
    return fs.statSync(transcriptPath).mtimeMs;
  } catch {
    return null;
  }
}

/** All tmux sessions whose name starts with `tx-w-`. Empty if tmux unavailable. */
export function listTmuxWorkerSessions(): string[] {
  try {
    const out = execSync(`tmux list-sessions -F '#{session_name}'`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 2000,
    });
    return out
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.startsWith('tx-w-'));
  } catch {
    return [];
  }
}

/** PID of the shell running inside the (first) pane of a tmux session. */
export function tmuxPanePid(sessionName: string): number | null {
  if (!isSafeTmuxName(sessionName)) return null;
  try {
    const out = execSync(`tmux list-panes -t '${sessionName}' -F '#{pane_pid}'`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 2000,
    });
    const first = out.split('\n').map(s => s.trim()).find(Boolean);
    if (!first) return null;
    const n = parseInt(first, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Walk the `ps` tree under `rootPid` (BFS) and return the first descendant
 * whose command contains `commandSubstr`. Used to locate `claude` under the
 * shell PID a tmux pane reports.
 *
 * Heavy: shells out and parses the full process table. Reaper should cache the
 * discovered PID and re-resolve only when `pidAlive` flips to false.
 */
export function findDescendantPid(rootPid: number, commandSubstr: string): number | null {
  try {
    const out = execSync('ps -eo pid,ppid,command', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 3000,
    });
    type Row = { pid: number; ppid: number; command: string };
    const byParent = new Map<number, Row[]>();
    for (const line of out.split('\n').slice(1)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!m) continue;
      const r: Row = { pid: +m[1], ppid: +m[2], command: m[3] };
      const arr = byParent.get(r.ppid) ?? [];
      arr.push(r);
      byParent.set(r.ppid, arr);
    }
    const queue: number[] = [rootPid];
    const seen = new Set<number>();
    while (queue.length) {
      const p = queue.shift()!;
      if (seen.has(p)) continue;
      seen.add(p);
      for (const child of byParent.get(p) ?? []) {
        if (child.command.includes(commandSubstr)) return child.pid;
        queue.push(child.pid);
      }
    }
    return null;
  } catch (err) {
    log.warn('liveness', 'findDescendantPid failed', {
      rootPid, commandSubstr, error: String(err),
    });
    return null;
  }
}

/** Process group ID for a PID, or null if the process is gone / call fails. */
export function getPgid(pid: number): number | null {
  if (!pid || pid <= 0) return null;
  try {
    const out = execSync(`ps -o pgid= -p ${pid}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      timeout: 1000,
    });
    const n = parseInt(out.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

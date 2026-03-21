/**
 * Process Discovery - OS-level worker process detection
 *
 * Shared utility for finding, checking, and killing claude worker processes.
 * Used by mesh kill, status, and startup cleanup as a fallback when
 * in-memory tracking (WorkerLifecycleManager) has lost state.
 *
 * Responsibilities:
 * - Parse `ps` output to find claude worker processes
 * - Check process liveness via kill(pid, 0)
 * - Kill orphaned processes by PID
 */

import { execSync } from 'node:child_process';
import { log } from '../shared/logger.ts';

export interface DiscoveredProcess {
  pid: number;
  ppid: number;
  command: string;
  meshName?: string;
}

/**
 * Find claude worker processes via `ps`.
 * Filters for processes with 'claude' in the command line.
 *
 * @param parentPid - When provided, filter to children of this PID or orphans (ppid=1)
 * @returns Array of discovered processes
 */
export function findClaudeWorkerProcesses(parentPid?: number): DiscoveredProcess[] {
  try {
    const output = execSync('ps -eo pid,ppid,command', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = output.trim().split('\n').slice(1); // Skip header
    const processes: DiscoveredProcess[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse: PID PPID COMMAND...
      const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = parseInt(match[1], 10);
      const ppid = parseInt(match[2], 10);
      const command = match[3];

      // Filter for claude processes (skip our own ps command)
      if (!command.includes('claude') || command.includes('ps -eo')) continue;

      // Skip non-worker processes (e.g., the user's own claude session)
      // Workers are spawned by the SDK and have specific patterns
      if (command.includes('claude-code-guide') || command.includes('claude-md')) continue;

      // When parentPid provided, filter by ppid match or reparented orphan (ppid=1)
      if (parentPid !== undefined) {
        if (ppid !== parentPid && ppid !== 1) continue;
      }

      // Try to extract mesh name from command args
      let meshName: string | undefined;
      const cwdMatch = command.match(/--cwd[= ]([^\s]+)/);
      if (cwdMatch) {
        const cwdPath = cwdMatch[1];
        // Mesh workers typically run in the project dir
        const meshMatch = cwdPath.match(/meshes\/([^/]+)/);
        if (meshMatch) meshName = meshMatch[1];
      }

      processes.push({ pid, ppid, command, meshName });
    }

    return processes;
  } catch (err) {
    log.warn('process-discovery', 'Failed to discover processes', { error: String(err) });
    return [];
  }
}

/**
 * Check if a process is alive via kill(pid, 0).
 * Only works for same-user processes.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill processes by PID with SIGTERM.
 * Returns count of successfully killed and failed.
 */
export function killProcesses(
  pids: number[],
  signal: NodeJS.Signals = 'SIGTERM'
): { killed: number; failed: number } {
  let killed = 0;
  let failed = 0;

  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      killed++;
      log.info('process-discovery', 'Killed process', { pid, signal });
    } catch (err) {
      failed++;
      log.warn('process-discovery', 'Failed to kill process', { pid, signal, error: String(err) });
    }
  }

  return { killed, failed };
}

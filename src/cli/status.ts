/**
 * tx status - Show system status
 */

import path from 'node:path';
import fs from 'node:fs';
import { MessageQueue } from '../queue/index.ts';
import { TmuxSession, getSessionName } from '../core/tmux.ts';
import { readRuntimeState, DisplayMode } from './start.ts';

export interface StatusResult {
  core: {
    running: boolean;
    session: string;
    displayMode?: DisplayMode;
  };
  queue: {
    pending: number;
    delivered: number;
    total: number;
    byAgent: Record<string, number>;
  };
  workers: Array<{
    id: string;
    status?: string;
    startedAt: number;
    messagesProcessed?: number;
    duration?: number;
    awaitingResponses?: string[];
    awaitDuration?: number;
  }>;
}

export async function status(workDir?: string): Promise<StatusResult> {
  const cwd = workDir || process.env.TX_CWD || process.cwd();
  const dbPath = path.join(cwd, '.ai', 'tx', 'data', 'queue.db');
  const workersPath = path.join(cwd, '.ai', 'tx', 'data', 'workers.json');

  // Check core session (unique per directory)
  const sessionName = getSessionName(cwd);
  const tmux = new TmuxSession(sessionName);
  const coreRunning = await tmux.exists();

  // Read runtime state for display mode
  const runtimeState = readRuntimeState(cwd);
  const displayMode = coreRunning ? runtimeState?.displayMode : undefined;

  // Check queue if exists
  let stats = { pending: 0, delivered: 0, total: 0, byAgent: {} as Record<string, number> };

  if (fs.existsSync(dbPath)) {
    const queue = new MessageQueue(dbPath);
    stats = queue.getStats();
    queue.close();
  }

  // Check active workers
  let workers: Array<{ id: string; startedAt: number }> = [];
  if (fs.existsSync(workersPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(workersPath, 'utf-8'));
      workers = data.workers || [];
    } catch {
      // Ignore parse errors
    }
  }

  return {
    core: {
      running: coreRunning,
      session: sessionName,
      displayMode,
    },
    queue: stats,
    workers,
  };
}

export function printStatus(result: StatusResult, json = false): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log('\n=== TX V4 Status ===\n');

  // Core status
  const coreIcon = result.core.running ? '✓' : '✗';
  const modeDisplay = result.core.displayMode ? ` [${result.core.displayMode}]` : '';
  console.log(`Core: ${coreIcon} ${result.core.running ? 'running' : 'stopped'} (${result.core.session})${modeDisplay}`);

  // Active workers
  if (result.workers.length > 0) {
    console.log(`\nWorkers: ${result.workers.length} active`);
    for (const worker of result.workers) {
      const elapsed = Math.round((Date.now() - worker.startedAt) / 1000);
      const status = worker.status || 'running';

      if (status === 'awaiting' && worker.awaitingResponses) {
        // Show awaiting workers with wait targets
        const awaitElapsed = worker.awaitDuration ? Math.round(worker.awaitDuration / 1000) : 0;
        const targets = worker.awaitingResponses.join(', ');
        console.log(`  ⏳ ${worker.id} (awaiting ${targets}) [${awaitElapsed}s/${elapsed}s]`);
      } else {
        // Show running/idle workers
        const icon = status === 'idle' ? '💤' : '⚡';
        console.log(`  ${icon} ${worker.id} (${status}) [${elapsed}s]`);
      }
    }
  } else {
    console.log('\nWorkers: none active');
  }

  // Queue stats
  console.log(`\nQueue: ${result.queue.total} messages (${result.queue.pending} pending, ${result.queue.delivered} delivered)`);

  // Pending by agent
  const pendingAgents = Object.entries(result.queue.byAgent);
  if (pendingAgents.length > 0) {
    console.log('\nPending by agent:');
    for (const [agent, count] of pendingAgents) {
      console.log(`  ${agent}: ${count}`);
    }
  }

  console.log('');
}

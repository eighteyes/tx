/**
 * tx status - Show system status
 */

import path from 'node:path';
import fs from 'node:fs';
import { MessageQueue } from '../queue/index.ts';
import { TmuxSession } from '../core/tmux.ts';

export interface StatusResult {
  core: {
    running: boolean;
    session: string;
  };
  queue: {
    pending: number;
    delivered: number;
    total: number;
    byAgent: Record<string, number>;
  };
  workers: Array<{
    id: string;
    startedAt: number;
  }>;
}

export async function status(workDir?: string): Promise<StatusResult> {
  const cwd = workDir || process.env.TX_CWD || process.cwd();
  const dbPath = path.join(cwd, '.ai', 'tx', 'data', 'queue.db');
  const workersPath = path.join(cwd, '.ai', 'tx', 'data', 'workers.json');

  // Check core session
  const tmux = new TmuxSession('tx-v4-core');
  const coreRunning = await tmux.exists();

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
      session: 'tx-v4-core',
    },
    queue: stats,
    workers,
  };
}

export function printStatus(result: StatusResult): void {
  console.log('\n=== TX V4 Status ===\n');

  // Core status
  const coreIcon = result.core.running ? '✓' : '✗';
  console.log(`Core: ${coreIcon} ${result.core.running ? 'running' : 'stopped'} (${result.core.session})`);

  // Active workers
  if (result.workers.length > 0) {
    console.log(`\nWorkers: ${result.workers.length} active`);
    for (const worker of result.workers) {
      const elapsed = Math.round((Date.now() - worker.startedAt) / 1000);
      console.log(`  ⚡ ${worker.id} (${elapsed}s)`);
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

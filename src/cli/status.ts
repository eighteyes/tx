/**
 * tx status - Show system status
 */

import path from 'node:path';
import fs from 'node:fs';
import { MessageQueue } from '../queue/index.ts';
import { TmuxSession, getSessionName } from '../core/tmux.ts';

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
    status?: string;
    startedAt: number;
    messagesProcessed?: number;
    duration?: number;
    awaitingResponses?: string[];
    awaitDuration?: number;
  }>;
  instances: Array<{
    base_mesh: string;
    mesh_id: string;
    status: 'running' | 'completed';
    spawned_at: number;
    completed_at?: number;
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

  // Check queue if exists
  let stats = { pending: 0, delivered: 0, total: 0, byAgent: {} as Record<string, number> };
  let instances: Array<{ base_mesh: string; mesh_id: string; status: 'running' | 'completed'; spawned_at: number; completed_at?: number }> = [];

  if (fs.existsSync(dbPath)) {
    const queue = new MessageQueue(dbPath);
    stats = queue.getStats();
    instances = queue.listInstances();
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
    },
    queue: stats,
    workers,
    instances,
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
  console.log(`Core: ${coreIcon} ${result.core.running ? 'running' : 'stopped'} (${result.core.session})`);

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

  // Parallel instances
  if (result.instances.length > 0) {
    const running = result.instances.filter(i => i.status === 'running');
    const completed = result.instances.filter(i => i.status === 'completed');

    console.log(`\nParallel Instances: ${result.instances.length} total (${running.length} running, ${completed.length} completed)`);

    if (running.length > 0) {
      console.log('\nRunning instances:');
      for (const instance of running) {
        const elapsed = Math.round((Date.now() - instance.spawned_at) / 1000);
        console.log(`  ⚡ ${instance.base_mesh}/${instance.mesh_id} [${elapsed}s]`);
      }
    }

    if (completed.length > 0 && completed.length <= 5) {
      // Show up to 5 recent completed instances
      console.log('\nRecent completed instances:');
      for (const instance of completed.slice(0, 5)) {
        const duration = instance.completed_at
          ? Math.round((instance.completed_at - instance.spawned_at) / 1000)
          : '?';
        console.log(`  ✓ ${instance.base_mesh}/${instance.mesh_id} [${duration}s]`);
      }
    }
  }

  console.log('');
}

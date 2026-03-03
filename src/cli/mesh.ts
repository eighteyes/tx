/**
 * tx mesh - Mesh state management CLI command
 *
 * Commands:
 *   tx mesh list              List meshes with activity
 *   tx mesh status <mesh>     Show mesh state snapshot (+ FSM pipeline for FSM meshes)
 *   tx mesh status <mesh> --next   Machine-readable dispatch instructions
 *   tx mesh status <mesh> --json   Full JSON with per-state gate status
 *   tx mesh kill <mesh>       Kill all workers for a mesh (via SIGUSR2 to tx start)
 *   tx mesh reload [mesh]     Hot-reload mesh config(s) at runtime (via SIGUSR2)
 *   tx mesh clear <mesh>      Clear SQLite state (suspended sessions, pending asks, FSM)
 *   tx mesh unstick <mesh>    Clear halt state only (preserves FSM state)
 *   tx mesh validate <mesh>   Validate mesh configuration
 *   tx mesh fsm-chain <mesh>  Show FSM state transition chain with validation
 *   tx mesh fsm-reset <mesh>  Reset FSM to initial state (preserves sessions)
 *   tx mesh fsm-goto <mesh> <state>  Force FSM to a specific state
 *   tx mesh run <mesh> "<prompt>"   Run full FSM pipeline end-to-end
 *   tx mesh cost [mesh]           Per-agent cost/token/cache summary from prior runs
 *   tx mesh flow <mesh>           Agent execution timeline with concurrency grouping
 *   tx mesh ideal <mesh>          Ideal execution stages from routing + manifest
 *   tx mesh drain <mesh>          Drain all pending messages (mark delivered, unblock queue)
 *   tx mesh dump [mesh]           Chronological dump of all events (logs, messages, sessions, prompts)
 */

import { MessageQueue, FSMPersistence } from '../queue/index.ts';
import { MeshFSM } from '../mesh/index.ts';
import { HeadlessRunner } from '../worker/headless-runner.ts';
import { SessionStore } from '../session/index.ts';
import { validateMesh } from './validate-mesh.ts';
import { MeshValidator } from '../worker/mesh-validator.ts';
import { log } from '../shared/logger.ts';
import { chalk } from '../shared/colors.ts';
import { formatTimeAgo } from '../shared/time.ts';
import { exec } from 'node:child_process';  // Used by killMeshWorkers
import { promisify } from 'node:util';
import YAML from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import type { FSMConfig } from '../shared/types.ts';

const execAsync = promisify(exec);

interface MeshFlags {
  json?: boolean;
  force?: boolean;
  strict?: boolean;
  next?: boolean;
  all?: boolean;
  verbose?: boolean;
}

/**
 * Parse command line flags from remaining args
 */
function parseFlags(args: string[]): MeshFlags {
  const flags: MeshFlags = {};

  for (const arg of args) {
    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--force') {
      flags.force = true;
    } else if (arg === '--strict') {
      flags.strict = true;
    } else if (arg === '--next') {
      flags.next = true;
    } else if (arg === '--all') {
      flags.all = true;
    } else if (arg === '--verbose') {
      flags.verbose = true;
    }
  }

  return flags;
}

/**
 * Get non-flag arguments
 */
function getNonFlagArgs(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith('-'));
}

/**
 * Data structures for mesh activity
 */
interface MeshActivity {
  meshName: string;
  suspendedCount: number;
  pendingAsksCount: number;
  pendingQueueCount: number;
  sessionCount: number;
  hasFsmState: boolean;
  hasWorkers: boolean;
  lastActivity?: number;
}

interface WorkerInfo {
  id: string;
  agentId: string;
  status: string;
  startedAt: number;
  messagesProcessed: number;
  duration: number;
  model?: string;
}

interface WorkersJson {
  workers: WorkerInfo[];
}

/**
 * List meshes with activity summary
 */
async function listMeshes(flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');
  const sessionsPath = path.join(cwd, '.ai/tx/data/sessions.db');
  const workersPath = path.join(cwd, '.ai/tx/data/workers.json');

  // Check if queue database exists
  if (!fs.existsSync(queuePath)) {
    if (flags.json) {
      console.log(JSON.stringify({ meshes: [], message: 'No queue database found' }));
    } else {
      console.log(chalk.yellow('No mesh activity found (no queue database).'));
    }
    return;
  }

  const queue = new MessageQueue(queuePath);
  const fsmPersistence = new FSMPersistence(queue.getDb());
  fsmPersistence.initialize();

  // Optional session store
  let sessionStore: SessionStore | null = null;
  if (fs.existsSync(sessionsPath)) {
    sessionStore = new SessionStore(sessionsPath);
  }

  // Optional workers.json
  let workers: WorkerInfo[] = [];
  if (fs.existsSync(workersPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(workersPath, 'utf-8')) as WorkersJson;
      workers = data.workers || [];
    } catch {
      // Ignore parse errors
    }
  }

  try {
    // Get suspended sessions grouped by mesh
    const suspendedSessions = queue.listSuspendedSessions();
    const suspendedByMesh = new Map<string, number>();
    for (const session of suspendedSessions) {
      const current = suspendedByMesh.get(session.meshName) || 0;
      suspendedByMesh.set(session.meshName, current + 1);
    }

    // Get pending asks grouped by mesh
    const pendingAsks = queue.getAllPendingAsks();
    const pendingByMesh = new Map<string, number>();
    for (const ask of pendingAsks) {
      const meshName = ask.from_agent.split('/')[0];
      const current = pendingByMesh.get(meshName) || 0;
      pendingByMesh.set(meshName, current + 1);
    }

    // Get session counts by mesh
    const sessionsByMesh = sessionStore ? sessionStore.countSessionsByMesh() : new Map<string, number>();

    // Get FSM states (to know which meshes have active state)
    const fsmMeshes = new Set<string>();
    // Query mesh_state table directly
    const fsmRows = queue.getDb().prepare('SELECT mesh_name FROM mesh_state').all() as Array<{ mesh_name: string }>;
    for (const row of fsmRows) {
      fsmMeshes.add(row.mesh_name);
    }

    // Get workers grouped by mesh
    const workersByMesh = new Map<string, number>();
    for (const worker of workers) {
      const meshName = worker.agentId.split('/')[0];
      const current = workersByMesh.get(meshName) || 0;
      workersByMesh.set(meshName, current + 1);
    }

    // Get pending queue messages grouped by mesh
    const queueStats = queue.getStats();
    const pendingQueueByMesh = new Map<string, number>();
    for (const [agent, count] of Object.entries(queueStats.byAgent)) {
      const meshName = agent.split('/')[0];
      const current = pendingQueueByMesh.get(meshName) || 0;
      pendingQueueByMesh.set(meshName, current + count);
    }

    // Get mesh run status from mesh_runs table
    const meshRunStatus = new Map<string, 'running' | 'completed'>();
    try {
      const runs = queue.getDb().prepare(
        `SELECT mesh_name, status FROM mesh_runs ORDER BY started_at DESC`
      ).all() as Array<{ mesh_name: string; status: string }>;
      for (const run of runs) {
        // Only record first (most recent) status per mesh
        if (!meshRunStatus.has(run.mesh_name)) {
          meshRunStatus.set(run.mesh_name, run.status as 'running' | 'completed');
        }
      }
    } catch {
      // Table may not exist in older databases
    }

    // Combine all meshes
    const allMeshes = new Set<string>([
      ...suspendedByMesh.keys(),
      ...pendingByMesh.keys(),
      ...pendingQueueByMesh.keys(),
      ...sessionsByMesh.keys(),
      ...fsmMeshes,
      ...workersByMesh.keys(),
      ...meshRunStatus.keys(),
    ]);

    const meshActivities: MeshActivity[] = [];
    for (const meshName of allMeshes) {
      meshActivities.push({
        meshName,
        suspendedCount: suspendedByMesh.get(meshName) || 0,
        pendingAsksCount: pendingByMesh.get(meshName) || 0,
        pendingQueueCount: pendingQueueByMesh.get(meshName) || 0,
        sessionCount: sessionsByMesh.get(meshName) || 0,
        hasFsmState: fsmMeshes.has(meshName),
        hasWorkers: workersByMesh.has(meshName),
      });
    }

    // Sort by activity (suspended + pending first, then by session count)
    meshActivities.sort((a, b) => {
      const aActive = a.suspendedCount + a.pendingAsksCount + (a.hasWorkers ? 1 : 0);
      const bActive = b.suspendedCount + b.pendingAsksCount + (b.hasWorkers ? 1 : 0);
      if (aActive !== bActive) return bActive - aActive;
      return b.sessionCount - a.sessionCount;
    });

    if (flags.json) {
      console.log(JSON.stringify({ meshes: meshActivities }, null, 2));
      return;
    }

    if (meshActivities.length === 0) {
      console.log(chalk.dim('No mesh activity found.'));
      return;
    }

    console.log(`\n${chalk.bold(chalk.cyan('Meshes'))}\n`);
    console.log(
      chalk.dim('MESH'.padEnd(20)) +
      chalk.dim('SUSPENDED'.padEnd(12)) +
      chalk.dim('PENDING'.padEnd(10)) +
      chalk.dim('QUEUED'.padEnd(10)) +
      chalk.dim('SESSIONS'.padEnd(10)) +
      chalk.dim('STATUS')
    );
    console.log(chalk.dim('-'.repeat(72)));

    for (const mesh of meshActivities) {
      const statusParts: string[] = [];
      if (mesh.hasWorkers) statusParts.push(chalk.green('running'));
      if (mesh.hasFsmState) statusParts.push(chalk.blue('fsm'));
      const runStatus = meshRunStatus.get(mesh.meshName);
      if (runStatus === 'completed' && !mesh.hasWorkers) statusParts.push(chalk.green('✓ complete'));
      if (runStatus === 'running' && !mesh.hasWorkers) statusParts.push(chalk.yellow('started'));
      if (statusParts.length === 0) statusParts.push(chalk.dim('idle'));

      console.log(
        chalk.cyan(mesh.meshName.padEnd(20)) +
        (mesh.suspendedCount > 0 ? chalk.yellow(String(mesh.suspendedCount).padEnd(12)) : chalk.dim('0'.padEnd(12))) +
        (mesh.pendingAsksCount > 0 ? chalk.yellow(String(mesh.pendingAsksCount).padEnd(10)) : chalk.dim('0'.padEnd(10))) +
        (mesh.pendingQueueCount > 0 ? chalk.magenta(String(mesh.pendingQueueCount).padEnd(10)) : chalk.dim('0'.padEnd(10))) +
        String(mesh.sessionCount).padEnd(10) +
        statusParts.join(', ')
      );
    }

    console.log();
  } finally {
    queue.close();
    sessionStore?.close();
  }
}

/**
 * Show detailed status for a specific mesh
 */
async function showMeshStatus(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');
  const sessionsPath = path.join(cwd, '.ai/tx/data/sessions.db');
  const workersPath = path.join(cwd, '.ai/tx/data/workers.json');

  if (!fs.existsSync(queuePath)) {
    if (flags.json) {
      console.log(JSON.stringify({ error: 'No queue database found' }));
    } else {
      console.log(chalk.yellow('No mesh state found (no queue database).'));
    }
    return;
  }

  const queue = new MessageQueue(queuePath);
  const fsmPersistence = new FSMPersistence(queue.getDb());
  fsmPersistence.initialize();

  let sessionStore: SessionStore | null = null;
  if (fs.existsSync(sessionsPath)) {
    sessionStore = new SessionStore(sessionsPath);
  }

  let workers: WorkerInfo[] = [];
  if (fs.existsSync(workersPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(workersPath, 'utf-8')) as WorkersJson;
      workers = data.workers?.filter(w => w.agentId.startsWith(`${meshName}/`)) || [];
    } catch {
      // Ignore parse errors
    }
  }

  try {
    // Get suspended sessions for this mesh
    const allSuspended = queue.listSuspendedSessions();
    const suspendedSessions = allSuspended.filter(s => s.meshName === meshName);

    // Get pending asks for this mesh
    const allAsks = queue.getAllPendingAsks();
    const pendingAsks = allAsks.filter(a => a.from_agent.startsWith(`${meshName}/`) || a.to_agent.startsWith(`${meshName}/`));

    // Get FSM state
    const fsmState = fsmPersistence.getState(meshName);

    // Get recent sessions
    const recentSessions = sessionStore ? sessionStore.listSessionsByMesh(meshName, 10) : [];

    // Get pending messages for mesh agents
    const pendingMessages = queue.queryMessages({ status: 'pending', limit: 100 })
      .filter(m => m.to_agent.startsWith(`${meshName}/`));

    if (flags.json) {
      console.log(JSON.stringify({
        meshName,
        fsmState,
        suspendedSessions,
        pendingAsks,
        pendingMessages: pendingMessages.length,
        workers,
        recentSessions,
      }, null, 2));
      return;
    }

    // Display mesh status
    console.log(`\n${chalk.bold(chalk.cyan(`Mesh: ${meshName}`))}\n`);

    // FSM State
    if (fsmState) {
      console.log(`${chalk.bold('FSM State:')} ${chalk.green(fsmState.currentState)}`);
      console.log(`${chalk.dim('Last Transition:')} ${formatTimeAgo(fsmState.lastTransitionAt)}`);
      if (Object.keys(fsmState.context).length > 0) {
        console.log(`${chalk.dim('Context:')} ${JSON.stringify(fsmState.context)}`);
      }
    } else {
      console.log(`${chalk.bold('FSM State:')} ${chalk.dim('none')}`);
    }
    console.log();

    // Active Workers
    if (workers.length > 0) {
      console.log(`${chalk.bold('Active Workers:')}`);
      for (const worker of workers) {
        const agent = worker.agentId.split('/')[1];
        const shortId = worker.id.split('-').pop()?.substring(0, 8) || worker.id.substring(0, 8);
        console.log(`  ${chalk.cyan(agent)} - ${shortId} (${worker.status}, ${formatTimeAgo(worker.startedAt)})`);
      }
      console.log();
    }

    // Suspended Sessions
    if (suspendedSessions.length > 0) {
      console.log(`${chalk.bold('Suspended Sessions:')}`);
      for (const session of suspendedSessions) {
        const agent = session.agentId.split('/')[1];
        const pendingInfo = session.pendingCount > 0 ? ` (${session.pendingCount} pending)` : '';
        console.log(`  ${chalk.yellow(agent)} - ${session.reason} since ${formatTimeAgo(session.suspendedAt)}${pendingInfo}`);
      }
      console.log();
    }

    // Pending Messages
    if (pendingMessages.length > 0) {
      console.log(`${chalk.bold(`Pending Messages: ${pendingMessages.length}`)}`);
      for (const msg of pendingMessages.slice(0, 5)) {
        const toAgent = msg.to_agent.split('/')[1];
        console.log(`  ${chalk.dim('->')} ${chalk.cyan(toAgent)}: ${msg.type} (${formatTimeAgo(msg.created_at!)})`);
      }
      if (pendingMessages.length > 5) {
        console.log(chalk.dim(`  ... and ${pendingMessages.length - 5} more`));
      }
      console.log();
    }

    // Pending Asks
    if (pendingAsks.length > 0) {
      console.log(`${chalk.bold(`Pending Asks: ${pendingAsks.length}`)}`);
      for (const ask of pendingAsks.slice(0, 5)) {
        const fromAgent = ask.from_agent.split('/')[1];
        const toAgent = ask.to_agent.split('/')[1];
        console.log(`  ${chalk.cyan(fromAgent)} ${chalk.dim('->')} ${chalk.cyan(toAgent)} (${formatTimeAgo(ask.created_at!)})`);
      }
      console.log();
    }

    // Recent Sessions
    if (recentSessions.length > 0) {
      console.log(`${chalk.bold('Recent Sessions:')}`);
      for (const session of recentSessions) {
        const agent = session.agentId.split('/')[1];
        const headline = session.headline || chalk.dim('No headline');
        const filesCount = session.filesChanged ?
          (session.filesChanged.created?.length || 0) +
          (session.filesChanged.modified?.length || 0) : 0;
        const filesInfo = filesCount > 0 ? `| ${filesCount} files` : '';
        console.log(`  ${chalk.cyan(agent.padEnd(12))} | ${headline.substring(0, 30).padEnd(30)} ${filesInfo} | ${formatTimeAgo(session.startedAt)}`);
      }
      console.log();
    }

    // Summary if nothing found
    if (suspendedSessions.length === 0 && pendingMessages.length === 0 && pendingAsks.length === 0 && workers.length === 0 && !fsmState) {
      console.log(chalk.dim('No active state for this mesh.'));
      console.log();
    }
  } finally {
    queue.close();
    sessionStore?.close();
  }
}

/**
 * Clear mesh state
 */
async function clearMeshState(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');
  const workersPath = path.join(cwd, '.ai/tx/data/workers.json');

  if (!fs.existsSync(queuePath)) {
    if (flags.json) {
      console.log(JSON.stringify({ error: 'No queue database found' }));
    } else {
      console.log(chalk.yellow('No mesh state to clear (no queue database).'));
    }
    return;
  }

  // Check for running workers
  let hasRunningWorkers = false;
  if (fs.existsSync(workersPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(workersPath, 'utf-8')) as WorkersJson;
      const meshWorkers = data.workers?.filter(w => w.agentId.startsWith(`${meshName}/`)) || [];
      hasRunningWorkers = meshWorkers.length > 0;
    } catch {
      // Ignore parse errors
    }
  }

  if (hasRunningWorkers && !flags.force) {
    if (flags.json) {
      console.log(JSON.stringify({ error: 'Workers are running', hint: 'Use --force to clear anyway, or use tx mesh kill first' }));
    } else {
      console.log(chalk.red(`Workers are running for mesh '${meshName}'.`));
      console.log(chalk.dim('Use --force to clear anyway, or use "tx mesh kill" first.'));
    }
    return;
  }

  const queue = new MessageQueue(queuePath);
  const fsmPersistence = new FSMPersistence(queue.getDb());
  fsmPersistence.initialize();

  try {
    // Clear suspended sessions
    const suspendedCleared = queue.clearSuspendedSessionsForMesh(meshName);

    // Clear pending asks
    const asksCleared = queue.clearPendingAsksForMesh(meshName);

    // Clear stale pending messages
    const msgsCleared = queue.clearPendingMessagesForMesh(meshName);

    // Clear FSM state
    const fsmState = fsmPersistence.getState(meshName);
    if (fsmState) {
      fsmPersistence.deleteState(meshName);
    }

    if (flags.json) {
      console.log(JSON.stringify({
        meshName,
        cleared: {
          suspendedSessions: suspendedCleared,
          pendingAsks: asksCleared,
          pendingMessages: msgsCleared,
          fsmState: fsmState ? true : false,
        },
      }, null, 2));
      return;
    }

    console.log(`\n${chalk.green(`Cleared state for mesh: ${meshName}`)}\n`);
    if (suspendedCleared > 0) {
      console.log(`  ${chalk.dim('Suspended sessions:')} ${suspendedCleared}`);
    }
    if (asksCleared > 0) {
      console.log(`  ${chalk.dim('Pending asks:')} ${asksCleared}`);
    }
    if (msgsCleared > 0) {
      console.log(`  ${chalk.dim('Pending messages:')} ${msgsCleared}`);
    }
    if (fsmState) {
      console.log(`  ${chalk.dim('FSM state:')} cleared (was: ${fsmState.currentState})`);
    }

    if (suspendedCleared === 0 && asksCleared === 0 && msgsCleared === 0 && !fsmState) {
      console.log(chalk.dim('  No state to clear.'));
    }
    console.log();

    log.info('cli-mesh', 'Cleared mesh state', {
      meshName,
      suspendedCleared,
      asksCleared,
      msgsCleared,
      fsmCleared: !!fsmState,
    });

    // Signal running dispatcher to sync in-memory state
    const pidFile = path.join(cwd, '.ai/tx/data/.pid');
    const controlFile = path.join(cwd, '.ai/tx/data/control.json');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
        if (!isNaN(pid)) {
          fs.writeFileSync(controlFile, JSON.stringify({ action: 'clear-mesh', mesh: meshName }));
          process.kill(pid, 'SIGUSR2');
          if (!flags.json) {
            console.log(chalk.dim('  Signaled running dispatcher to sync in-memory state.'));
          }
        }
      } catch {
        // Process not running — DB clear is sufficient
      }
    }
  } finally {
    queue.close();
  }
}

/**
 * Unstick a halted mesh — clears suspended sessions and pending asks
 * without touching FSM state. Lighter than `clear`.
 */
async function unstickMesh(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');
  const haltedPath = path.join(cwd, '.ai/tx/data/halted.json');

  if (!fs.existsSync(queuePath)) {
    if (flags.json) {
      console.log(JSON.stringify({ error: 'No queue database found' }));
    } else {
      console.log(chalk.yellow('No mesh state found (no queue database).'));
    }
    return;
  }

  const queue = new MessageQueue(queuePath);

  try {
    // Get info before clearing
    const allSuspended = queue.listSuspendedSessions();
    const suspendedSessions = allSuspended.filter(s => s.meshName === meshName);

    const allAsks = queue.getAllPendingAsks();
    const pendingAsks = allAsks.filter(a =>
      a.from_agent.startsWith(`${meshName}/`) || a.to_agent.startsWith(`${meshName}/`)
    );

    const pendingMessages = queue.queryMessages({ status: 'pending', limit: 100 })
      .filter(m => m.to_agent.startsWith(`${meshName}/`));

    // Clear suspended sessions
    const suspendedCleared = queue.clearSuspendedSessionsForMesh(meshName);

    // Clear pending asks
    const asksCleared = queue.clearPendingAsksForMesh(meshName);

    // Clear halted.json entry
    if (fs.existsSync(haltedPath)) {
      try {
        const halted = JSON.parse(fs.readFileSync(haltedPath, 'utf-8'));
        if (halted[meshName]) {
          delete halted[meshName];
          fs.writeFileSync(haltedPath, JSON.stringify(halted, null, 2));
        }
      } catch {
        // Ignore parse errors
      }
    }

    if (flags.json) {
      console.log(JSON.stringify({
        meshName,
        cleared: {
          suspendedSessions: suspendedCleared,
          pendingAsks: asksCleared,
        },
        queuedMessages: pendingMessages.length,
      }, null, 2));
      return;
    }

    console.log(`\n${chalk.green(`Cleared mesh halt: ${meshName}`)}\n`);

    if (suspendedSessions.length > 0) {
      const details = suspendedSessions
        .map(s => `${s.agentId.split('/')[1]}, ${s.reason}`)
        .join('; ');
      console.log(`  ${chalk.dim('Suspended sessions:')} ${suspendedCleared} (${details})`);
    } else {
      console.log(`  ${chalk.dim('Suspended sessions:')} 0`);
    }

    console.log(`  ${chalk.dim('Pending asks:')} ${asksCleared}`);
    console.log(`  ${chalk.dim('Queued messages:')} ${pendingMessages.length} (now unblocked)`);

    if (suspendedCleared === 0 && asksCleared === 0) {
      console.log(chalk.dim('\n  No halt state to clear.'));
    } else {
      console.log(chalk.dim('\n  Mesh will resume processing on next message or restart.'));
    }
    console.log();

    log.info('cli-mesh', 'Unstick mesh', {
      meshName,
      suspendedCleared,
      asksCleared,
      queuedMessages: pendingMessages.length,
    });
  } finally {
    queue.close();
  }
}

/**
 * Drain all pending messages for a mesh — mark as delivered, clear suspended sessions and pending asks.
 * Unblocks a stuck queue by consuming everything without processing.
 */
async function drainMesh(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');

  if (!fs.existsSync(queuePath)) {
    if (flags.json) {
      console.log(JSON.stringify({ error: 'No queue database found' }));
    } else {
      console.log(chalk.yellow('No queue database found.'));
    }
    return;
  }

  const queue = new MessageQueue(queuePath);

  try {
    // Gather pending messages for this mesh
    const pendingMessages = queue.queryMessages({ status: 'pending', limit: 1000 })
      .filter(m => m.to_agent.startsWith(`${meshName}/`) || m.from_agent.startsWith(`${meshName}/`));

    if (pendingMessages.length === 0) {
      if (flags.json) {
        console.log(JSON.stringify({ meshName, drained: 0 }));
      } else {
        console.log(chalk.dim(`No pending messages for mesh '${meshName}'.`));
      }
      return;
    }

    // Group by recipient for display
    const byAgent: Record<string, number> = {};
    for (const msg of pendingMessages) {
      byAgent[msg.to_agent] = (byAgent[msg.to_agent] || 0) + 1;
    }

    // Drain: mark all pending as delivered
    const drained = queue.clearPendingMessagesForMesh(meshName);

    // Also clear suspended sessions and pending asks (they gate processing)
    const suspendedCleared = queue.clearSuspendedSessionsForMesh(meshName);
    const asksCleared = queue.clearPendingAsksForMesh(meshName);

    if (flags.json) {
      console.log(JSON.stringify({
        meshName,
        drained,
        suspendedCleared,
        asksCleared,
        byAgent,
      }, null, 2));
      return;
    }

    console.log(`\n${chalk.green(`Drained mesh: ${meshName}`)}\n`);
    console.log(`  ${chalk.dim('Messages drained:')} ${drained}`);

    for (const [agent, count] of Object.entries(byAgent)) {
      const agentName = agent.includes('/') ? agent.split('/')[1] : agent;
      console.log(`    ${chalk.dim(agentName)}: ${count}`);
    }

    if (suspendedCleared > 0) {
      console.log(`  ${chalk.dim('Suspended sessions cleared:')} ${suspendedCleared}`);
    }
    if (asksCleared > 0) {
      console.log(`  ${chalk.dim('Pending asks cleared:')} ${asksCleared}`);
    }

    console.log(chalk.dim('\n  Queue empty. Mesh ready for fresh dispatch.\n'));

    log.info('cli-mesh', 'Drain mesh', {
      meshName,
      drained,
      suspendedCleared,
      asksCleared,
      byAgent,
    });
  } finally {
    queue.close();
  }
}

/**
 * Kill all workers for a mesh via SIGUSR2 control signal to the running tx start process.
 * Writes a control file and signals the server PID. Falls back to tmux kill if no PID file.
 */
async function killMeshWorkers(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const dataDir = path.join(cwd, '.ai/tx/data');
  const pidFile = path.join(dataDir, '.pid');
  const controlFile = path.join(dataDir, 'control.json');

  // Check if tx start is running (PID file exists)
  if (!fs.existsSync(pidFile)) {
    // No running server — fall back to tmux kill for legacy sessions
    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}"');
      const sessions = stdout.trim().split('\n').filter(Boolean);
      const pattern = `tx-tx-${meshName}-`;
      const matching = sessions.filter(s => s.startsWith(pattern));

      if (matching.length === 0) {
        if (flags.json) {
          console.log(JSON.stringify({ killed: 0, message: 'tx start not running, no tmux sessions found' }));
        } else {
          console.log(chalk.yellow(`tx start not running and no tmux sessions found for: ${meshName}`));
        }
        return;
      }

      let killed = 0;
      for (const session of matching) {
        try {
          await execAsync(`tmux kill-session -t '${session}'`);
          killed++;
        } catch { /* ignore */ }
      }

      if (flags.json) {
        console.log(JSON.stringify({ killed, method: 'tmux-fallback' }));
      } else {
        console.log(chalk.green(`✓ Killed ${killed} tmux session(s) for ${meshName} (fallback)`));
      }
    } catch {
      if (flags.json) {
        console.log(JSON.stringify({ killed: 0, message: 'tx start not running, no tmux sessions' }));
      } else {
        console.log(chalk.yellow('tx start not running and no tmux sessions found'));
      }
    }
    return;
  }

  // Read server PID
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  if (isNaN(pid)) {
    console.error(chalk.red('Invalid PID in .pid file'));
    return;
  }

  // Write control file
  fs.writeFileSync(controlFile, JSON.stringify({ action: 'kill-mesh', mesh: meshName }));

  // Send SIGUSR2
  try {
    process.kill(pid, 'SIGUSR2');
  } catch (err) {
    // Process doesn't exist — stale PID file
    if (fs.existsSync(controlFile)) fs.unlinkSync(controlFile);
    if (flags.json) {
      console.log(JSON.stringify({ killed: 0, message: 'tx start process not found (stale PID)' }));
    } else {
      console.log(chalk.yellow(`tx start process (PID ${pid}) not found — stale PID file`));
    }
    return;
  }

  // Poll for ACK (control file deletion) with timeout
  const timeout = 5000;
  const interval = 100;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (!fs.existsSync(controlFile)) {
      // ACK received
      if (flags.json) {
        console.log(JSON.stringify({ killed: true, method: 'sigusr2', mesh: meshName }));
      } else {
        console.log(chalk.green(`✓ Killed workers for ${meshName}`));
      }
      return;
    }
    await new Promise(r => setTimeout(r, interval));
  }

  // Timeout — clean up control file
  if (fs.existsSync(controlFile)) fs.unlinkSync(controlFile);
  if (flags.json) {
    console.log(JSON.stringify({ killed: false, message: 'Timeout waiting for ACK from tx start' }));
  } else {
    console.log(chalk.yellow(`Timeout waiting for response from tx start (PID ${pid})`));
  }
}

/**
 * Reload mesh configs at runtime via SIGUSR2 control signal to the running tx start process.
 * Reloads a single mesh or all meshes.
 */
async function reloadMeshConfigs(meshName: string | undefined, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const dataDir = path.join(cwd, '.ai/tx/data');
  const pidFile = path.join(dataDir, '.pid');
  const controlFile = path.join(dataDir, 'control.json');

  if (!fs.existsSync(pidFile)) {
    if (flags.json) {
      console.log(JSON.stringify({ reloaded: false, message: 'tx start not running' }));
    } else {
      console.log(chalk.yellow('tx start is not running. Start it first with: tx start'));
    }
    return;
  }

  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  if (isNaN(pid)) {
    console.error(chalk.red('Invalid PID in .pid file'));
    return;
  }

  // Write control file
  const ctrl: Record<string, string> = { action: 'reload-meshes' };
  if (meshName) ctrl.mesh = meshName;
  fs.writeFileSync(controlFile, JSON.stringify(ctrl));

  // Send SIGUSR2
  try {
    process.kill(pid, 'SIGUSR2');
  } catch (err) {
    if (fs.existsSync(controlFile)) fs.unlinkSync(controlFile);
    if (flags.json) {
      console.log(JSON.stringify({ reloaded: false, message: 'tx start process not found (stale PID)' }));
    } else {
      console.log(chalk.yellow(`tx start process (PID ${pid}) not found — stale PID file`));
    }
    return;
  }

  // Poll for ACK (control file deletion) with timeout
  const timeout = 5000;
  const interval = 100;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (!fs.existsSync(controlFile)) {
      if (flags.json) {
        console.log(JSON.stringify({ reloaded: true, mesh: meshName || 'all' }));
      } else {
        console.log(chalk.green(`✓ Reloaded ${meshName || 'all'} mesh config(s)`));
      }
      return;
    }
    await new Promise(r => setTimeout(r, interval));
  }

  // Timeout
  if (fs.existsSync(controlFile)) fs.unlinkSync(controlFile);
  if (flags.json) {
    console.log(JSON.stringify({ reloaded: false, message: 'Timeout waiting for ACK from tx start' }));
  } else {
    console.log(chalk.yellow(`Timeout waiting for response from tx start (PID ${pid})`));
  }
}

/**
 * Show FSM state transition chain with validation
 */
async function fsmChain(meshName: string, flags: MeshFlags): Promise<void> {
  const workDir = process.env.TX_CWD || process.cwd();

  // Resolve config path
  let configPath = path.join(workDir, 'meshes', meshName, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    configPath = path.join(workDir, 'meshes', meshName, 'config.yml');
  }
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`Config not found: meshes/${meshName}/config.yaml`));
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(chalk.red('Failed to parse config:'), (err as Error).message);
    return;
  }

  const fsm = config.fsm as Record<string, unknown> | undefined;
  if (!fsm || typeof fsm.states !== 'object' || !fsm.states) {
    console.error(chalk.red(`Mesh '${meshName}' has no FSM configuration`));
    return;
  }

  const statesObj = fsm.states as Record<string, unknown>;

  // Helper: get agents for a state (normal + ensemble)
  const getStateAgents = (state: Record<string, unknown>): string[] => {
    const result: string[] = [];
    if (Array.isArray(state.agents)) {
      for (const a of state.agents) {
        if (typeof a === 'string') result.push(a);
      }
    }
    if (state.ensemble && typeof state.ensemble === 'object') {
      const ens = state.ensemble as Record<string, unknown>;
      if (Array.isArray(ens.agents)) {
        for (const a of ens.agents) {
          if (typeof a === 'string') result.push(a);
        }
      }
      if (typeof ens.agent === 'string') {
        const count = typeof ens.count === 'number' ? ens.count : '?';
        result.push(`${ens.agent}×${count}`);
      }
    }
    return result;
  };

  // Build chain output
  const initial = fsm.initial as string;

  if (flags.json) {
    const states: Record<string, unknown>[] = [];
    for (const [name, value] of Object.entries(statesObj)) {
      if (!value || typeof value !== 'object') continue;
      const state = value as Record<string, unknown>;
      const agents = getStateAgents(state);
      const targets: string[] = [];
      if (state.exit && typeof state.exit === 'object') {
        const exit = state.exit as Record<string, unknown>;
        if (typeof exit.default === 'string') targets.push(exit.default);
        if (Array.isArray(exit.when)) {
          for (const c of exit.when) {
            if (c && typeof c === 'object') {
              const t = (c as Record<string, unknown>).target;
              if (typeof t === 'string' && !targets.includes(t)) targets.push(t);
            }
          }
        }
      }
      const isTerminal = (state as Record<string, unknown>).terminal === true;
      const isEnsemble = state.ensemble !== undefined;
      states.push({ name, agents, targets, initial: name === initial, terminal: isTerminal, ensemble: isEnsemble });
    }

    const result = MeshValidator.validate(config, path.basename(configPath));
    console.log(JSON.stringify({ mesh: meshName, initial, states, errors: result.errors, warnings: result.warnings }, null, 2));
    return;
  }

  // Formatted output
  console.log(`\n${chalk.bold(chalk.cyan(`FSM Chain: ${meshName}`))}`);
  console.log(chalk.dim(`Initial: ${initial}\n`));

  for (const [name, value] of Object.entries(statesObj)) {
    if (!value || typeof value !== 'object') continue;
    const state = value as Record<string, unknown>;
    const isTerminal = (state as Record<string, unknown>).terminal === true;
    const isEnsemble = state.ensemble !== undefined;
    const agents = getStateAgents(state);

    // State label
    const tags: string[] = [];
    if (name === initial) tags.push(chalk.green('initial'));
    if (isTerminal) tags.push(chalk.red('terminal'));
    if (isEnsemble) tags.push(chalk.blue('ensemble'));
    const tagStr = tags.length > 0 ? ` ${chalk.dim('(')}${tags.join(chalk.dim(', '))}${chalk.dim(')')}` : '';

    // Agents
    const agentStr = agents.length > 0 ? chalk.cyan(agents.join(', ')) : chalk.dim('none');

    // Targets
    const targets: string[] = [];
    if (state.exit && typeof state.exit === 'object') {
      const exit = state.exit as Record<string, unknown>;
      if (Array.isArray(exit.when)) {
        for (const c of exit.when) {
          if (c && typeof c === 'object') {
            const clause = c as Record<string, unknown>;
            targets.push(`${clause.condition} → ${chalk.bold(clause.target as string)}`);
          }
        }
      }
      if (typeof exit.default === 'string') {
        targets.push(`${chalk.dim('default')} → ${chalk.bold(exit.default)}`);
      }
    }

    console.log(`  ${chalk.bold(name)}${tagStr}`);
    console.log(`    agents: [${agentStr}]`);
    if (targets.length > 0) {
      for (const t of targets) {
        console.log(`    ${chalk.dim('→')} ${t}`);
      }
    }
    console.log();
  }

  // Run validation
  const result = MeshValidator.validate(config, path.basename(configPath));
  if (result.errors.length > 0) {
    console.log(chalk.red(`✗ Errors (${result.errors.length})`));
    for (const e of result.errors) {
      console.log(`  ${chalk.red('•')} ${e}`);
    }
    console.log();
  }
  if (result.warnings.length > 0) {
    console.log(chalk.yellow(`⚠ Warnings (${result.warnings.length})`));
    for (const w of result.warnings) {
      console.log(`  ${chalk.yellow('•')} ${w}`);
    }
    console.log();
  }
  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log(chalk.green('✓ Valid — 0 errors, 0 warnings\n'));
  } else if (result.errors.length === 0) {
    console.log(chalk.green('✓ Valid') + chalk.dim(` (${result.warnings.length} warnings)\n`));
  } else {
    console.log(chalk.red(`✗ Invalid — ${result.errors.length} errors\n`));
  }
}

/**
 * Load and normalize FSM config from a mesh's config.yaml
 * Returns { fsmConfig, basePath } or null if not found
 */
function loadFSMConfig(meshName: string, workDir: string): { fsmConfig: FSMConfig; basePath: string } | null {
  let configPath = path.join(workDir, 'meshes', meshName, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    configPath = path.join(workDir, 'meshes', meshName, 'config.yml');
  }
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`Config not found: meshes/${meshName}/config.yaml`));
    return null;
  }

  const raw = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!raw?.fsm) {
    console.error(chalk.red(`Mesh '${meshName}' has no FSM configuration`));
    return null;
  }

  // Normalize object-style states to array-style
  const fsm = raw.fsm;
  if (!Array.isArray(fsm.states)) {
    const states: Record<string, unknown>[] = [];
    for (const [name, cfg] of Object.entries(fsm.states || {})) {
      const normalized: Record<string, unknown> = { name, ...(cfg as Record<string, unknown>) };
      if (Array.isArray(normalized.agents)) {
        const agentList = normalized.agents as string[];
        normalized.coordinator = agentList[0];
        if (agentList.length > 1) normalized.participants = agentList.slice(1);
        delete normalized.agents;
      }
      states.push(normalized);
    }
    fsm.states = states;
    fsm.initialState = fsm.initial || fsm.initialState;
  }

  return {
    fsmConfig: fsm as FSMConfig,
    basePath: path.join(workDir, 'meshes', meshName),
  };
}

/**
 * Resolve $variable references in a gate path using context variables.
 * Static utility — mirrors MeshFSM.resolveGatePath without needing an instance.
 */
function resolveGatePath(
  gateName: string,
  context: Record<string, unknown>,
  workDir: string
): string {
  let resolved = gateName;
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string' || typeof value === 'number') {
      resolved = resolved.replace(new RegExp(`\\$${key}\\b`, 'g'), String(value));
    }
  }
  if (resolved.includes('$workspace')) {
    resolved = resolved.replace(/\$workspace/g, workDir);
  }
  if (!path.isAbsolute(resolved)) {
    resolved = path.join(workDir, resolved);
  }
  return resolved;
}

/**
 * Build an ordered state chain from FSM config.
 * Follows exit.default from initial state, appends branch targets, terminal last.
 */
function buildStateChain(
  fsmConfig: FSMConfig
): string[] {
  const initial = fsmConfig.initialState || fsmConfig.initial || '';
  const stateMap = new Map<string, Record<string, unknown>>();

  // Build lookup from both array and object formats
  if (Array.isArray(fsmConfig.states)) {
    for (const s of fsmConfig.states) {
      stateMap.set(s.name, s as unknown as Record<string, unknown>);
    }
  } else if (fsmConfig.states && typeof fsmConfig.states === 'object') {
    for (const [name, cfg] of Object.entries(fsmConfig.states as Record<string, unknown>)) {
      stateMap.set(name, { name, ...(cfg as Record<string, unknown>) });
    }
  }

  const chain: string[] = [];
  const visited = new Set<string>();
  const branchTargets: string[] = [];

  // Walk the exit.default chain from initial
  let current: string | null = initial;
  while (current && !visited.has(current)) {
    visited.add(current);
    chain.push(current);

    const stateObj = stateMap.get(current);
    if (!stateObj) break;

    // Collect branch targets from exit.when
    const exit = stateObj.exit as Record<string, unknown> | undefined;
    if (exit?.when && Array.isArray(exit.when)) {
      for (const clause of exit.when) {
        const target = (clause as Record<string, unknown>).target as string;
        if (target && !visited.has(target) && !branchTargets.includes(target)) {
          branchTargets.push(target);
        }
      }
    }

    // Follow exit.default
    current = (exit?.default as string) || null;
  }

  // Append branch targets not already in chain
  for (const target of branchTargets) {
    if (!visited.has(target)) {
      visited.add(target);
      chain.push(target);
    }
  }

  // Append any remaining states not yet visited
  for (const name of stateMap.keys()) {
    if (!visited.has(name)) {
      chain.push(name);
    }
  }

  return chain;
}

/**
 * FSM pipeline status — infer actual state from gate file presence,
 * compare against FSM persistence, output dispatch instructions.
 *
 * Derives everything from config.yaml FSM block + persistence + workspace files.
 */
async function fsmStatus(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');

  // Load FSM config (required)
  const loaded = loadFSMConfig(meshName, cwd);
  if (!loaded) return;

  const { fsmConfig } = loaded;

  // Load raw config for workspace resolution
  let configPath = path.join(cwd, 'meshes', meshName, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    configPath = path.join(cwd, 'meshes', meshName, 'config.yml');
  }
  const rawConfig = YAML.parse(fs.readFileSync(configPath, 'utf-8'));

  // Load FSM persistence (optional — may not have queue DB yet)
  let fsmState: { currentState: string; context: Record<string, unknown>; lastTransitionAt: number } | null = null;
  let queue: MessageQueue | null = null;

  if (fs.existsSync(queuePath)) {
    queue = new MessageQueue(queuePath);
    const fsmPersistence = new FSMPersistence(queue.getDb());
    fsmPersistence.initialize();
    fsmState = fsmPersistence.getState(meshName);
  }

  // Resolve workspace path from context or config
  const context: Record<string, unknown> = fsmState?.context || fsmConfig.context || {};
  let workspaceDir = context.workspace as string | null;

  if (!workspaceDir) {
    workspaceDir = rawConfig.workspace?.locations?.workspace
      || rawConfig.workspace?.path
      || `.ai/${meshName}/workspace`;
  }

  if (workspaceDir && !path.isAbsolute(workspaceDir)) {
    workspaceDir = path.join(cwd, workspaceDir);
  }

  // Build ordered state chain
  const stateChain = buildStateChain(fsmConfig);

  // Build state lookup from normalized config
  const stateMap = new Map<string, Record<string, unknown>>();
  if (Array.isArray(fsmConfig.states)) {
    for (const s of fsmConfig.states) {
      stateMap.set(s.name, s as unknown as Record<string, unknown>);
    }
  } else if (fsmConfig.states && typeof fsmConfig.states === 'object') {
    for (const [name, cfg] of Object.entries(fsmConfig.states as Record<string, unknown>)) {
      stateMap.set(name, { name, ...(cfg as Record<string, unknown>) });
    }
  }

  // Per-state: resolve gates, check file existence, collect agents
  interface StateInfo {
    name: string;
    agents: string[];
    gates: Array<{ raw: string; resolved: string; exists: boolean; isScript: boolean }>;
    gatesPassed: boolean;
    isTerminal: boolean;
    isEnsemble: boolean;
    ensembleProgress?: string;
  }

  const stateInfos: StateInfo[] = [];

  for (const stateName of stateChain) {
    const stateObj = stateMap.get(stateName);
    if (!stateObj) continue;

    // Collect agents
    const agents: string[] = [];
    if (Array.isArray(stateObj.agents)) {
      agents.push(...(stateObj.agents as string[]));
    } else {
      if (stateObj.coordinator) agents.push(stateObj.coordinator as string);
      if (Array.isArray(stateObj.participants)) agents.push(...(stateObj.participants as string[]));
    }

    const isTerminal = stateObj.terminal === true;
    const ensemble = stateObj.ensemble as Record<string, unknown> | undefined;
    const isEnsemble = !!ensemble;

    // Collect ensemble agents
    if (isEnsemble && ensemble) {
      if (Array.isArray(ensemble.agents)) {
        // Ensemble with named agents — replace the agents list
        agents.length = 0;
        agents.push(...(ensemble.agents as string[]));
      } else if (typeof ensemble.agent === 'string') {
        const count = typeof ensemble.count === 'number' ? ensemble.count : '?';
        agents.length = 0;
        agents.push(`${ensemble.agent}x${count}`);
      }
    }

    // Resolve exit gates
    const gates: StateInfo['gates'] = [];
    const exit = stateObj.exit as Record<string, unknown> | undefined;
    if (exit?.gates && typeof exit.gates === 'object') {
      const gatesMap = exit.gates as Record<string, string[]>;
      for (const agentGates of Object.values(gatesMap)) {
        if (!Array.isArray(agentGates)) continue;
        for (const gateName of agentGates) {
          const isScript = !gateName.startsWith('$') && !gateName.includes('/');
          const resolved = isScript
            ? gateName
            : resolveGatePath(gateName, context, cwd);
          const exists = isScript
            ? true // Script gates are assumed to have passed if we're past them
            : fs.existsSync(resolved);
          gates.push({ raw: gateName, resolved, exists, isScript });
        }
      }
    }

    // Ensemble progress: count per-agent completion files
    let ensembleProgress: string | undefined;
    if (isEnsemble && ensemble && Array.isArray(ensemble.agents)) {
      const ensAgents = ensemble.agents as string[];
      let done = 0;
      for (const ea of ensAgents) {
        // Check for typical ensemble output files: {agent}.yaml in workspace
        if (workspaceDir && fs.existsSync(path.join(workspaceDir, `${ea}.yaml`))) {
          done++;
        }
      }
      ensembleProgress = `${done}/${ensAgents.length}`;
    }

    const gatesPassed = gates.length === 0
      ? !isTerminal // No gates = passed (terminal is a special case)
      : gates.every(g => g.exists);

    stateInfos.push({
      name: stateName,
      agents,
      gates,
      gatesPassed,
      isTerminal,
      isEnsemble,
      ensembleProgress,
    });
  }

  // Infer file state: walk states in reverse, first with all gates satisfied
  let inferredState = stateChain[0]; // fallback to initial
  for (let i = stateInfos.length - 1; i >= 0; i--) {
    const info = stateInfos[i];
    if (info.isTerminal && info.gatesPassed) {
      // If terminal state is "passed", check the state before it
      // Terminal states have no gates — so check if the prior state's gates all passed
      inferredState = info.name;
      break;
    }
    if (info.gatesPassed && info.gates.length > 0) {
      // This state's gates are all satisfied — the next state in chain is current
      const nextIdx = stateChain.indexOf(info.name) + 1;
      if (nextIdx < stateChain.length) {
        inferredState = stateChain[nextIdx];
      } else {
        inferredState = info.name; // Last state
      }
      break;
    }
  }

  // Drift detection
  const persistedState = fsmState?.currentState || null;
  const drift = persistedState !== null && persistedState !== inferredState;

  // Get dispatch info for inferred state
  const inferredInfo = stateInfos.find(s => s.name === inferredState);
  const dispatchAgents = inferredInfo?.agents || [];
  const dispatchParallel = inferredInfo?.isEnsemble || false;

  // --- OUTPUT ---

  if (flags.json) {
    const result = {
      meshName,
      fsmState: persistedState,
      inferredState,
      drift,
      workspace: workspaceDir,
      states: stateInfos.map(s => ({
        name: s.name,
        agents: s.agents,
        gates: s.gates.map(g => ({
          path: g.raw,
          resolved: g.resolved,
          exists: g.exists,
          isScript: g.isScript,
        })),
        gatesPassed: s.gatesPassed,
        terminal: s.isTerminal,
        ensemble: s.isEnsemble,
        ensembleProgress: s.ensembleProgress || undefined,
      })),
      dispatch: {
        agents: dispatchAgents,
        parallel: dispatchParallel,
      },
    };
    console.log(JSON.stringify(result, null, 2));
    queue?.close();
    return;
  }

  if (flags.next) {
    console.log(`state=${persistedState || inferredState}`);
    console.log(`inferred=${inferredState}`);
    console.log(`drift=${drift ? 'yes' : 'no'}`);
    console.log(`workspace=${workspaceDir || ''}`);
    console.log(`spawn=${dispatchAgents.join(',')}`);
    console.log(`parallel=${dispatchParallel}`);
    console.log(`ensemble_progress=${inferredInfo?.ensembleProgress || ''}`);
    queue?.close();
    return;
  }

  // Default: human-readable pipeline table
  console.log(`\n${chalk.bold(chalk.cyan(`Mesh: ${meshName}`))}`);
  console.log(`${chalk.bold('FSM State:')} ${persistedState ? chalk.green(persistedState) : chalk.dim('none')} ${chalk.dim('(persisted)')}`);

  const inferredMatch = !drift ? chalk.green('V') : chalk.red('DRIFT');
  console.log(`${chalk.bold('File State:')} ${chalk.green(inferredState)} ${chalk.dim('(inferred)')} ${inferredMatch}`);
  console.log();

  // Column widths
  const nameWidth = Math.max(18, ...stateInfos.map(s => s.name.length + 2));
  const gateWidth = 32;

  console.log(
    chalk.dim('  ' + 'STATE'.padEnd(nameWidth) + 'GATE FILE'.padEnd(gateWidth) + 'AGENTS')
  );
  console.log(
    chalk.dim('  ' + '\u2500'.repeat(nameWidth - 1).padEnd(nameWidth) +
    '\u2500'.repeat(gateWidth - 1).padEnd(gateWidth) +
    '\u2500'.repeat(20))
  );

  for (const info of stateInfos) {
    let marker: string;
    let nameStyle: (s: string) => string;

    if (info.name === inferredState) {
      marker = chalk.yellow('\u25BA'); // ► current
      nameStyle = (s: string) => chalk.yellow(s);
    } else if (info.gatesPassed && info.gates.length > 0) {
      marker = chalk.green('\u25A0'); // ■ completed
      nameStyle = (s: string) => chalk.dim(s);
    } else if (info.isTerminal) {
      marker = chalk.dim('\u25A1'); // □ pending
      nameStyle = (s: string) => chalk.dim(s);
    } else {
      marker = '\u25A1'; // □ pending
      nameStyle = (s: string) => s;
    }

    // Gate display
    let gateDisplay: string;
    if (info.isTerminal) {
      gateDisplay = chalk.dim('(terminal)');
    } else if (info.isEnsemble && info.ensembleProgress) {
      gateDisplay = chalk.dim(`(ensemble ${info.ensembleProgress})`);
    } else if (info.gates.length > 0) {
      // Show the first file gate's raw path
      const fileGates = info.gates.filter(g => !g.isScript);
      gateDisplay = fileGates.length > 0 ? fileGates[0].raw : chalk.dim('\u2014');
    } else {
      gateDisplay = chalk.dim('\u2014');
    }

    // Agent display
    const agentDisplay = info.agents.length > 0
      ? info.agents.join(', ')
      : chalk.dim('\u2014');

    console.log(
      `  ${marker} ${nameStyle(info.name.padEnd(nameWidth - 2))}${gateDisplay.padEnd(gateWidth)}${agentDisplay}`
    );
  }

  console.log();
  console.log(`${chalk.bold('Dispatch:')} ${dispatchAgents.length > 0 ? dispatchAgents.join(', ') : chalk.dim('none')}`);
  if (dispatchParallel) {
    console.log(`          ${chalk.cyan('(parallel)')}`);
  }
  console.log(`${chalk.bold('Message:')}  Execute task for state ${inferredState}`);

  if (drift) {
    console.log();
    console.log(chalk.red(`DRIFT: persisted state '${persistedState}' != file-inferred state '${inferredState}'`));
    console.log(chalk.red('  Files are truth. FSM persistence may be stale.'));
  }

  console.log();
  queue?.close();
}

/**
 * Reset FSM to initial state (preserves suspended sessions and pending asks)
 */
async function fsmReset(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');

  if (!fs.existsSync(queuePath)) {
    console.error(chalk.red('No queue database found.'));
    return;
  }

  const loaded = loadFSMConfig(meshName, cwd);
  if (!loaded) return;

  const queue = new MessageQueue(queuePath);
  try {
    const fsm = new MeshFSM(meshName, loaded.fsmConfig, queue.getDb(), loaded.basePath, cwd);
    await fsm.initialize();

    const previousState = fsm.getCurrentState();
    await fsm.reset('CLI reset via tx mesh fsm-reset');

    if (flags.json) {
      console.log(JSON.stringify({ meshName, previousState, newState: fsm.getCurrentState(), context: loaded.fsmConfig.context || {} }));
    } else {
      console.log(chalk.green(`FSM reset: ${meshName}`));
      console.log(`  ${chalk.dim('Previous:')} ${previousState}`);
      console.log(`  ${chalk.dim('Current:')}  ${fsm.getCurrentState()}`);
      console.log(`  ${chalk.dim('Context:')}  reset to initial values`);
    }

    log.info('cli-mesh', 'FSM reset', { meshName, previousState, newState: fsm.getCurrentState() });
  } finally {
    queue.close();
  }
}

/**
 * Force FSM to a specific state (preserves context, clears gate retries for target)
 */
async function fsmGoto(meshName: string, targetState: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const queuePath = path.join(cwd, '.ai/tx/queue.db');

  if (!fs.existsSync(queuePath)) {
    console.error(chalk.red('No queue database found.'));
    return;
  }

  const loaded = loadFSMConfig(meshName, cwd);
  if (!loaded) return;

  const queue = new MessageQueue(queuePath);
  try {
    const fsm = new MeshFSM(meshName, loaded.fsmConfig, queue.getDb(), loaded.basePath, cwd);
    await fsm.initialize();

    const previousState = fsm.getCurrentState();
    const success = await fsm.forceTransition(targetState, 'CLI force via tx mesh fsm-goto');

    if (!success) {
      console.error(chalk.red(`Invalid target state: '${targetState}'`));
      const validStates = Array.from((loaded.fsmConfig.states as Array<{ name: string }>).map(s => s.name));
      console.log(chalk.dim(`Valid states: ${validStates.join(', ')}`));
      return;
    }

    if (flags.json) {
      console.log(JSON.stringify({ meshName, previousState, newState: targetState }));
    } else {
      console.log(chalk.green(`FSM transition: ${meshName}`));
      console.log(`  ${chalk.dim('From:')} ${previousState}`);
      console.log(`  ${chalk.dim('To:')}   ${targetState}`);
    }

    log.info('cli-mesh', 'FSM forced transition', { meshName, previousState, newState: targetState });
  } finally {
    queue.close();
  }
}

/**
 * Run full FSM pipeline end-to-end (in-process)
 * Resets FSM, cleans workspace, runs agents via HeadlessRunner, processes transitions
 */
async function meshRun(meshName: string, prompt: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const msgsDir = path.join(cwd, '.ai/tx/mesh-run-msgs');
  const meshesDir = path.join(cwd, 'meshes');
  const MAX_STEPS = 50;

  // Load full mesh config
  let configPath = path.join(meshesDir, meshName, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    configPath = path.join(meshesDir, meshName, 'config.yml');
  }
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`Config not found: meshes/${meshName}/config.yaml`));
    return;
  }

  const rawConfig = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!rawConfig?.fsm) {
    console.error(chalk.red(`Mesh '${meshName}' has no FSM configuration`));
    return;
  }

  const loaded = loadFSMConfig(meshName, cwd);
  if (!loaded) return;

  // Resolve workspace path
  const wsPath = rawConfig.workspace?.locations?.workspace
    || rawConfig.workspace?.path
    || `.ai/${meshName}/workspace`;
  const workspaceDir = path.resolve(cwd, wsPath);

  // Clean workspace
  if (fs.existsSync(workspaceDir)) {
    for (const f of fs.readdirSync(workspaceDir)) {
      const fp = path.join(workspaceDir, f);
      if (fs.lstatSync(fp).isFile()) fs.unlinkSync(fp);
    }
    console.log(chalk.dim(`Cleaned workspace: ${wsPath}`));
  } else {
    fs.mkdirSync(workspaceDir, { recursive: true });
    console.log(chalk.dim(`Created workspace: ${wsPath}`));
  }

  // Use isolated msgs dir so tx start Consumer doesn't intercept agent messages
  if (fs.existsSync(msgsDir)) {
    for (const f of fs.readdirSync(msgsDir)) {
      fs.unlinkSync(path.join(msgsDir, f));
    }
  } else {
    fs.mkdirSync(msgsDir, { recursive: true });
  }

  // Use a fresh queue DB for mesh run to avoid schema conflicts with tx start
  const runQueuePath = path.join(cwd, '.ai/tx/mesh-run.db');
  if (fs.existsSync(runQueuePath)) {
    fs.unlinkSync(runQueuePath);
  }
  const queue = new MessageQueue(runQueuePath);

  // Cleanup: close queue + remove temp files
  const cleanup = () => {
    queue.close();
    try { fs.unlinkSync(runQueuePath); } catch {}
    try { fs.rmSync(msgsDir, { recursive: true, force: true }); } catch {}
  };

  const persistence = new FSMPersistence(queue.getDb());
  persistence.initialize();
  persistence.deleteState(meshName);

  const fsm = new MeshFSM(meshName, loaded.fsmConfig, queue.getDb(), loaded.basePath, cwd);
  await fsm.initialize();

  const entryAgent = rawConfig.entry_point || 'entry';

  console.log(`\n${chalk.bold(chalk.cyan(`FSM Run: ${meshName}`))}`);
  console.log(`  ${chalk.dim('Initial state:')} ${fsm.getCurrentState()}`);
  console.log(`  ${chalk.dim('Entry agent:')}   ${entryAgent}`);
  console.log(`  ${chalk.dim('Workspace:')}     ${wsPath}`);
  console.log(`  ${chalk.dim('Prompt:')}        ${prompt}\n`);

  // Helper: get agents for a state from normalized config
  const getStateAgents = (stateName: string): string[] => {
    const states = loaded.fsmConfig.states as Array<{ name: string; coordinator?: string; participants?: string[]; ensemble?: { agents?: string[] } }>;
    const state = states.find(s => s.name === stateName);
    if (!state) return [];
    if (state.coordinator) {
      const agents = [state.coordinator];
      if (state.participants) agents.push(...state.participants);
      return agents;
    }
    if (state.ensemble?.agents) return state.ensemble.agents;
    return [];
  };

  // Helper: check terminal
  const isTerminal = (stateName: string): boolean => {
    const states = loaded.fsmConfig.states as Array<{ name: string; terminal?: boolean }>;
    const state = states.find(s => s.name === stateName);
    return state?.terminal === true;
  };

  // Helper: run single agent in-process via HeadlessRunner
  const runAgent = async (agent: string, agentPrompt: string): Promise<string | null> => {
    const header = `  ${chalk.cyan(agent)}`;
    const agentStart = Date.now();

    try {
      // Snapshot messages before
      const msgsBefore = new Set(fs.existsSync(msgsDir) ? fs.readdirSync(msgsDir) : []);

      const runner = new HeadlessRunner({
        mesh: meshName,
        agent,
        workDir: cwd,
        msgsDir,
        meshesDir,
      }, queue);

      await runner.initialize();

      // Run agent and wait for completion
      await new Promise<void>((resolve, reject) => {
        runner.on('complete', () => resolve());
        runner.on('error', (data: { error: string }) => reject(new Error(data.error)));
        runner.start(agentPrompt).catch(reject);
      });

      await runner.stop();

      const elapsed = ((Date.now() - agentStart) / 1000).toFixed(1);

      // Find NEW messages from this agent
      const msgsAfter = fs.existsSync(msgsDir) ? fs.readdirSync(msgsDir) : [];
      const newMsgs = msgsAfter
        .filter(f => !msgsBefore.has(f) && f.includes(`${meshName}-${agent}--`))
        .sort()
        .reverse();

      if (newMsgs.length > 0) {
        const msgContent = fs.readFileSync(path.join(msgsDir, newMsgs[0]), 'utf-8');
        const fmMatch = msgContent.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = YAML.parse(fmMatch[1]);
          console.log(`${header} ${chalk.dim('→')} ${fm.to} ${chalk.dim(`(${fm.status || 'sent'}) ${elapsed}s`)}`);
          return fm.to;
        }
      }

      console.log(`${header} ${chalk.yellow(`(no message) ${elapsed}s`)}`);
      return null;
    } catch (err: any) {
      console.log(`${header} ${chalk.red('FAILED')} ${chalk.dim(err.message.split('\n')[0])}`);
      return null;
    }
  };

  let step = 0;
  let currentPrompt = prompt;
  const startTime = Date.now();

  while (step < MAX_STEPS) {
    step++;
    const currentState = fsm.getCurrentState();

    if (isTerminal(currentState)) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const files = fs.existsSync(workspaceDir) ? fs.readdirSync(workspaceDir) : [];
      console.log(`\n${chalk.green('Terminal:')} ${currentState}`);
      console.log(`  ${chalk.dim('Steps:')} ${step - 1}  ${chalk.dim('Elapsed:')} ${elapsed}s  ${chalk.dim('Files:')} ${files.length}`);
      if (files.length > 0) {
        console.log(`  ${chalk.dim('Workspace:')} ${files.join(', ')}`);
      }

      if (flags.json) {
        console.log(JSON.stringify({
          meshName,
          finalState: currentState,
          steps: step - 1,
          elapsedSeconds: parseFloat(elapsed),
          workspaceFiles: files,
        }));
      }

      cleanup();
      return;
    }

    const agents = getStateAgents(currentState);
    if (agents.length === 0) {
      console.error(chalk.red(`No agents for state: ${currentState}`));
      break;
    }

    console.log(chalk.dim(`[${currentState}]`) + ` agents: ${agents.join(', ')}`);

    for (const agent of agents) {
      const target = await runAgent(agent, currentPrompt);

      if (target) {
        try {
          const result = await fsm.handleMessage(
            `${meshName}/${agent}`,
            target,
            'task-complete',
            {}  // Empty frontmatter
          );
          if (!result) {
            console.log(`  ${chalk.yellow('FSM rejected transition — retrying state')}`);
          }
        } catch (err: any) {
          console.error(`  ${chalk.red('FSM error:')} ${err.message}`);
          const files = fs.existsSync(workspaceDir) ? fs.readdirSync(workspaceDir) : [];
          console.error(`  ${chalk.dim('Workspace:')} ${files.join(', ') || '(empty)'}`);
          cleanup();
          return;
        }
      }
    }

    // After first step, switch to generic continuation prompt
    currentPrompt = 'Execute your task. Write your gate file and send your completion message.';
  }

  console.error(chalk.red(`Hit safety limit (${MAX_STEPS} steps)`));
  console.log(`  ${chalk.dim('Final state:')} ${fsm.getCurrentState()}`);
  cleanup();
}

/**
 * Per-agent cost/token/cache summary from historical log runs.
 * Scans v4.1.jsonl through v4.4.jsonl (prior runs only, skips current v4.jsonl).
 */
interface AgentCostRecord {
  agent: string;
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  invocations: number;
}

interface RunCostRecord {
  file: string;
  runIndex: number;
  cost: number;
  agentCount: number;
  durationMs: number;
  timestamp: string;
}

async function meshCost(meshName: string | undefined, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const logsDir = path.join(cwd, '.ai/tx/logs');

  // Collect log files: v4.jsonl (current session) + v4.1-4.jsonl (prior runs)
  const logFiles: string[] = [];
  const currentLog = path.join(logsDir, 'v4.jsonl');
  if (fs.existsSync(currentLog)) logFiles.push(currentLog);
  for (let i = 1; i <= 4; i++) {
    const logPath = path.join(logsDir, `v4.${i}.jsonl`);
    if (fs.existsSync(logPath)) logFiles.push(logPath);
  }

  if (logFiles.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify({ error: 'No log files found', hint: 'Run a mesh first.' }));
    } else {
      console.log(chalk.yellow('No log files found.'));
      console.log(chalk.dim('Run a mesh first.'));
    }
    return;
  }

  // Aggregate data
  const agentMap = new Map<string, AgentCostRecord>();
  const runs: RunCostRecord[] = [];

  for (let idx = 0; idx < logFiles.length; idx++) {
    const logPath = logFiles[idx];
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    let runCost = 0;
    let runDuration = 0;
    const runAgents = new Set<string>();
    let runTimestamp = '';

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch { continue; }

      if (entry.message !== 'SDK metrics') continue;
      const data = entry.data as Record<string, unknown> | undefined;
      if (!data?.workerId) continue;

      const workerId = data.workerId as string;

      // Filter by mesh if specified
      if (meshName && !workerId.startsWith(`${meshName}/`)) continue;

      const agent = workerId;
      const cost = (data.totalCostUsd as number) || 0;
      const inputTokens = (data.inputTokens as number) || 0;
      const outputTokens = (data.outputTokens as number) || 0;
      const cacheRead = (data.cacheReadTokens as number) || 0;
      const cacheWrite = (data.cacheCreationTokens as number) || 0;
      const durationMs = (data.durationMs as number) || 0;
      const model = (data.model as string) || '';

      // Per-agent aggregation
      let rec = agentMap.get(agent);
      if (!rec) {
        rec = { agent, model, cost: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, invocations: 0 };
        agentMap.set(agent, rec);
      }
      rec.cost += cost;
      rec.inputTokens += inputTokens;
      rec.outputTokens += outputTokens;
      rec.cacheRead += cacheRead;
      rec.cacheWrite += cacheWrite;
      rec.invocations++;
      if (model && !rec.model) rec.model = model;

      // Per-run aggregation
      runCost += cost;
      runDuration += durationMs;
      runAgents.add(agent);
      if (!runTimestamp && entry.timestamp) runTimestamp = entry.timestamp as string;
    }

    if (runAgents.size > 0) {
      runs.push({
        file: path.basename(logPath),
        runIndex: idx + 1,
        cost: runCost,
        agentCount: runAgents.size,
        durationMs: runDuration,
        timestamp: runTimestamp,
      });
    }
  }

  const agents = Array.from(agentMap.values()).sort((a, b) => b.cost - a.cost);
  const totalCost = agents.reduce((s, a) => s + a.cost, 0);
  const totalIn = agents.reduce((s, a) => s + a.inputTokens, 0);
  const totalOut = agents.reduce((s, a) => s + a.outputTokens, 0);
  const totalCacheR = agents.reduce((s, a) => s + a.cacheRead, 0);
  const totalCacheW = agents.reduce((s, a) => s + a.cacheWrite, 0);

  // Cache efficiency: % of input-side tokens served from cache
  // Higher = more reuse = cheaper. Low on first invocation (expected).
  const cacheHitPct = (rec: { inputTokens: number; cacheRead: number; cacheWrite: number }): number => {
    const total = rec.inputTokens + rec.cacheRead + rec.cacheWrite;
    return total > 0 ? (rec.cacheRead / total) * 100 : 0;
  };

  const fmtPct = (pct: number, pad = 0): string => {
    const str = `${pct.toFixed(0)}%`;
    const padded = pad > 0 ? str.padEnd(pad) : str;
    if (pct >= 80) return chalk.green(padded);
    if (pct >= 40) return chalk.yellow(padded);
    return chalk.dim(padded);
  };

  // JSON output
  if (flags.json) {
    const agentsWithEff = agents.map(a => ({ ...a, cacheHitPct: Math.round(cacheHitPct(a) * 10) / 10 }));
    const totalEff = Math.round(cacheHitPct({ inputTokens: totalIn, cacheRead: totalCacheR, cacheWrite: totalCacheW }) * 10) / 10;
    console.log(JSON.stringify({
      mesh: meshName || 'all',
      priorRuns: runs.length,
      agents: agentsWithEff,
      runs,
      totals: { cost: totalCost, inputTokens: totalIn, outputTokens: totalOut, cacheRead: totalCacheR, cacheWrite: totalCacheW, cacheHitPct: totalEff },
    }, null, 2));
    return;
  }

  // No data found
  if (agents.length === 0) {
    const scope = meshName ? `mesh '${meshName}'` : 'any mesh';
    console.log(chalk.yellow(`No SDK metrics found for ${scope} in prior runs.`));
    return;
  }

  // Human output — no mesh name: summary across all meshes
  if (!meshName) {
    const meshTotals = new Map<string, { cost: number; agents: Set<string>; runs: Set<string> }>();
    for (const agent of agents) {
      const mesh = agent.agent.split('/')[0];
      let rec = meshTotals.get(mesh);
      if (!rec) {
        rec = { cost: 0, agents: new Set(), runs: new Set() };
        meshTotals.set(mesh, rec);
      }
      rec.cost += agent.cost;
      rec.agents.add(agent.agent);
    }
    // Attribute runs to meshes
    for (let idx = 0; idx < logFiles.length; idx++) {
      const content = fs.readFileSync(logFiles[idx], 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.message !== 'SDK metrics') continue;
          const wid = entry.data?.workerId as string;
          if (!wid) continue;
          const mesh = wid.split('/')[0];
          meshTotals.get(mesh)?.runs.add(path.basename(logFiles[idx]));
        } catch { continue; }
      }
    }

    console.log(`\n${chalk.bold(chalk.cyan('Cost Summary'))} ${chalk.dim(`(${runs.length} prior runs)`)}\n`);
    const fmt = (n: number) => `$${n.toFixed(3)}`;
    const meshes = Array.from(meshTotals.entries()).sort((a, b) => b[1].cost - a[1].cost);

    console.log(
      chalk.dim('  MESH'.padEnd(28) + 'COST'.padEnd(12) + 'AGENTS'.padEnd(10) + 'RUNS')
    );
    console.log(chalk.dim('  ' + '\u2500'.repeat(56)));

    for (const [mesh, data] of meshes) {
      console.log(
        `  ${chalk.cyan(mesh.padEnd(26))}${fmt(data.cost).padEnd(12)}${String(data.agents.size).padEnd(10)}${data.runs.size}`
      );
    }
    console.log(chalk.dim('  ' + '\u2500'.repeat(56)));
    console.log(`  ${chalk.bold('TOTAL'.padEnd(26))}${chalk.bold(fmt(totalCost))}`);
    console.log();
    return;
  }

  // Human output — specific mesh detail
  const fmt = (n: number) => `$${n.toFixed(3)}`;
  const fmtNum = (n: number) => n.toLocaleString();

  console.log(`\n${chalk.bold(chalk.cyan(`Cost: ${meshName}`))} ${chalk.dim(`(${runs.length} prior runs)`)}\n`);

  // Agent table
  const nameW = Math.max(16, ...agents.map(a => a.agent.split('/')[1]?.length || a.agent.length)) + 2;

  console.log(chalk.dim(
    '  ' + 'AGENT'.padEnd(nameW) + 'MODEL'.padEnd(10) + 'COST'.padEnd(12) +
    'IN_TOK'.padEnd(10) + 'OUT_TOK'.padEnd(10) + 'CACHE_R'.padEnd(12) +
    'CACHE_W'.padEnd(12) + 'CACHE%'.padEnd(8) + 'RUNS'
  ));
  console.log(chalk.dim('  ' + '\u2500'.repeat(nameW + 82)));

  for (const a of agents) {
    const shortName = a.agent.split('/')[1] || a.agent;
    const pct = cacheHitPct(a);
    console.log(
      `  ${chalk.cyan(shortName.padEnd(nameW))}` +
      `${(a.model || chalk.dim('-')).padEnd(10)}` +
      `${fmt(a.cost).padEnd(12)}` +
      `${fmtNum(a.inputTokens).padEnd(10)}` +
      `${fmtNum(a.outputTokens).padEnd(10)}` +
      `${fmtNum(a.cacheRead).padEnd(12)}` +
      `${fmtNum(a.cacheWrite).padEnd(12)}` +
      `${fmtPct(pct, 8)}` +
      `${a.invocations}`
    );
  }

  const totalPct = cacheHitPct({ inputTokens: totalIn, cacheRead: totalCacheR, cacheWrite: totalCacheW });
  console.log(chalk.dim('  ' + '\u2500'.repeat(nameW + 82)));
  console.log(
    `  ${chalk.bold('TOTAL'.padEnd(nameW))}` +
    `${''.padEnd(10)}` +
    `${chalk.bold(fmt(totalCost).padEnd(12))}` +
    `${fmtNum(totalIn).padEnd(10)}` +
    `${fmtNum(totalOut).padEnd(10)}` +
    `${fmtNum(totalCacheR).padEnd(12)}` +
    `${fmtNum(totalCacheW).padEnd(12)}` +
    `${fmtPct(totalPct)}`
  );

  // Per-run breakdown
  if (runs.length > 0) {
    console.log(`\n${chalk.dim('Per-Run:')}`);
    for (const run of runs) {
      const date = run.timestamp ? new Date(run.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
      const elapsed = (run.durationMs / 1000).toFixed(1);
      console.log(`  ${chalk.dim(`Run ${run.runIndex}`)} (${date})  ${fmt(run.cost)}  ${run.agentCount} agents  ${elapsed}s`);
    }
  }

  console.log();
}

/**
 * Agent execution timeline with concurrency grouping.
 * Derives sequential steps from SDK metrics timestamps and durations.
 * Concurrent agents (overlapping intervals) share a step.
 */
interface FlowStep {
  step: number;
  agents: string[];
  startTime: string;
  endTime: string;
  durationMs: number;
  cost: number;
}

interface FlowRun {
  runIndex: number;
  timestamp: string;
  steps: FlowStep[];
  invocations: FlowInvocation[];
  totalCost: number;
  totalDurationMs: number;
  stepCount: number;
  meshInstance?: string;
  isComplete?: boolean;
}

interface FlowInvocation {
  agent: string;
  startMs: number;
  endMs: number;
  cost: number;
}

/** Parse mesh-run boundaries from a log file, returning time windows per meshInstance */
function parseMeshRunBoundaries(lines: string[], meshName: string): { meshInstance: string; startMs: number; endMs: number | null }[] {
  const starts = new Map<string, number>();
  const boundaries: { meshInstance: string; startMs: number; endMs: number | null }[] = [];

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.message !== 'Mesh run started' && entry.message !== 'Mesh run completed') continue;

    const data = entry.data as Record<string, unknown> | undefined;
    if (!data?.meshInstance) continue;
    if ((data.meshName as string) !== meshName) continue;

    const ts = Date.parse(entry.timestamp as string);
    const inst = data.meshInstance as string;

    if (entry.message === 'Mesh run started') {
      starts.set(inst, ts);
    } else {
      const startMs = starts.get(inst) || ts;
      boundaries.push({ meshInstance: inst, startMs, endMs: ts });
      starts.delete(inst);
    }
  }

  // Incomplete runs (started but no end marker)
  for (const [inst, startMs] of starts) {
    boundaries.push({ meshInstance: inst, startMs, endMs: null });
  }

  return boundaries.sort((a, b) => a.startMs - b.startMs);
}

/** Collect SDK metrics invocations for a mesh from log lines */
function collectInvocations(lines: string[], meshName: string): FlowInvocation[] {
  const invocations: FlowInvocation[] = [];

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.message !== 'SDK metrics') continue;

    const data = entry.data as Record<string, unknown> | undefined;
    if (!data?.workerId) continue;

    const workerId = data.workerId as string;
    if (!workerId.startsWith(`${meshName}/`)) continue;

    const timestamp = entry.timestamp as string;
    const durationMs = (data.durationMs as number) || 0;
    const cost = (data.totalCostUsd as number) || 0;
    const endMs = Date.parse(timestamp);
    const startMs = endMs - durationMs;

    invocations.push({ agent: workerId, startMs, endMs, cost });
  }

  return invocations.sort((a, b) => a.startMs - b.startMs);
}

/** Build FlowStep[] from invocations using greedy interval merge */
function buildSteps(invocations: FlowInvocation[]): FlowStep[] {
  if (invocations.length === 0) return [];

  const steps: FlowStep[] = [];
  let groupStart = invocations[0].startMs;
  let groupEnd = invocations[0].endMs;
  let groupAgents = [invocations[0].agent];
  let groupCost = invocations[0].cost;

  for (let i = 1; i < invocations.length; i++) {
    const inv = invocations[i];
    if (inv.startMs < groupEnd) {
      groupAgents.push(inv.agent);
      groupCost += inv.cost;
      if (inv.endMs > groupEnd) groupEnd = inv.endMs;
    } else {
      steps.push({
        step: steps.length + 1,
        agents: groupAgents,
        startTime: new Date(groupStart).toISOString(),
        endTime: new Date(groupEnd).toISOString(),
        durationMs: groupEnd - groupStart,
        cost: groupCost,
      });
      groupStart = inv.startMs;
      groupEnd = inv.endMs;
      groupAgents = [inv.agent];
      groupCost = inv.cost;
    }
  }
  steps.push({
    step: steps.length + 1,
    agents: groupAgents,
    startTime: new Date(groupStart).toISOString(),
    endTime: new Date(groupEnd).toISOString(),
    durationMs: groupEnd - groupStart,
    cost: groupCost,
  });

  return steps;
}

async function meshFlow(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const logsDir = path.join(cwd, '.ai/tx/logs');

  // Collect log files: v4.jsonl (current session) + v4.1-4.jsonl (prior runs)
  const logFiles: string[] = [];
  const currentLog = path.join(logsDir, 'v4.jsonl');
  if (fs.existsSync(currentLog)) logFiles.push(currentLog);
  for (let i = 1; i <= 4; i++) {
    const logPath = path.join(logsDir, `v4.${i}.jsonl`);
    if (fs.existsSync(logPath)) logFiles.push(logPath);
  }

  if (logFiles.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify({ error: 'No log files found', hint: 'Run a mesh first.' }));
    } else {
      console.log(chalk.yellow('No log files found.'));
      console.log(chalk.dim('Run a mesh first.'));
    }
    return;
  }

  const runs: FlowRun[] = [];
  let globalRunIndex = 0;

  for (const logFile of logFiles) {
    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    const allInvocations = collectInvocations(lines, meshName);
    if (allInvocations.length === 0) continue;

    const boundaries = parseMeshRunBoundaries(lines, meshName);

    if (boundaries.length > 0) {
      // Split invocations into runs by mesh-run boundaries
      for (const boundary of boundaries) {
        // For incomplete runs, use last invocation end time as window end
        const windowEnd = boundary.endMs ?? Math.max(...allInvocations.map(inv => inv.endMs));

        const runInvocations = allInvocations.filter(inv =>
          inv.startMs >= boundary.startMs && inv.startMs <= windowEnd
        );
        if (runInvocations.length === 0) continue;

        const steps = buildSteps(runInvocations);
        const totalCost = steps.reduce((s, st) => s + st.cost, 0);
        const totalDurationMs = steps.reduce((s, st) => s + st.durationMs, 0);

        globalRunIndex++;
        runs.push({
          runIndex: globalRunIndex,
          timestamp: new Date(boundary.startMs).toISOString(),
          steps,
          invocations: runInvocations,
          totalCost,
          totalDurationMs,
          stepCount: steps.length,
          meshInstance: boundary.meshInstance,
          isComplete: boundary.endMs !== null,
        });
      }
    } else {
      // Fallback: no mesh-run markers — treat entire file as one run
      const steps = buildSteps(allInvocations);
      const totalCost = steps.reduce((s, st) => s + st.cost, 0);
      const totalDurationMs = steps.reduce((s, st) => s + st.durationMs, 0);

      globalRunIndex++;
      runs.push({
        runIndex: globalRunIndex,
        timestamp: new Date(allInvocations[0].startMs).toISOString(),
        steps,
        invocations: allInvocations,
        totalCost,
        totalDurationMs,
        stepCount: steps.length,
      });
    }
  }

  if (runs.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify({ mesh: meshName, runs: [] }));
    } else {
      console.log(chalk.yellow(`No SDK metrics found for mesh '${meshName}' in prior runs.`));
    }
    return;
  }

  // JSON output
  if (flags.json) {
    console.log(JSON.stringify({ mesh: meshName, runs }, null, 2));
    return;
  }

  // Human output — vertical flow with loop detection
  const fmt = (n: number) => `$${n.toFixed(3)}`;
  const fmtDur = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  for (const run of runs) {
    const dateStr = run.timestamp
      ? new Date(run.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '?';

    const instanceLabel = run.meshInstance ? ` ${chalk.dim(`[${run.meshInstance}]`)}` : '';
    const statusLabel = run.isComplete === false ? chalk.yellow(' (in progress)') : '';
    console.log(`\n${chalk.bold(chalk.cyan(`Flow: ${meshName}`))} ${chalk.dim(dateStr)}${instanceLabel}${statusLabel}\n`);

    // Build flat agent sequence from raw invocations (accurate per-agent timing)
    const rawInvs: { name: string; durationMs: number; cost: number; startMs: number; endMs: number }[] = [];
    for (const inv of run.invocations) {
      rawInvs.push({
        name: inv.agent.split('/')[1] || inv.agent,
        durationMs: inv.endMs - inv.startMs,
        cost: inv.cost,
        startMs: inv.startMs,
        endMs: inv.endMs,
      });
    }

    // Detect truly parallel invocations (significant overlap, not just timing noise)
    // Two invocations are parallel if they overlap by >50% of the shorter one's duration
    const sequence: { name: string; durationMs: number; cost: number; parallel?: string[] }[] = [];
    const used = new Set<number>();

    for (let si = 0; si < rawInvs.length; si++) {
      if (used.has(si)) continue;
      const a = rawInvs[si];

      // Look ahead for genuinely parallel invocations
      const group = [a];
      let groupEnd = a.endMs;

      for (let sj = si + 1; sj < rawInvs.length; sj++) {
        if (used.has(sj)) continue;
        const b = rawInvs[sj];
        // Stop looking if b starts after current group ends
        if (b.startMs >= groupEnd) break;

        // Check overlap: how much of b runs while a's group is running?
        const overlapStart = Math.max(a.startMs, b.startMs);
        const overlapEnd = Math.min(groupEnd, b.endMs);
        const overlapMs = Math.max(0, overlapEnd - overlapStart);
        const shorterDur = Math.min(b.durationMs, groupEnd - a.startMs);

        // Require >50% overlap relative to the shorter duration
        if (shorterDur > 0 && overlapMs / shorterDur > 0.5) {
          group.push(b);
          used.add(sj);
          if (b.endMs > groupEnd) groupEnd = b.endMs;
        }
      }

      if (group.length === 1) {
        sequence.push({ name: a.name, durationMs: a.durationMs, cost: a.cost });
      } else {
        const names = group.map(g => g.name);
        const uniqueNames = [...new Set(names)];
        const totalCost = group.reduce((s, g) => s + g.cost, 0);
        const totalDur = groupEnd - group[0].startMs;
        sequence.push({
          name: uniqueNames.join(' + '),
          durationMs: totalDur,
          cost: totalCost,
          parallel: uniqueNames.length > 1 ? uniqueNames : undefined,
        });
      }
    }

    // Detect loops: find repeated subsequences and collapse them
    interface FlowLine {
      type: 'agent' | 'loop' | 'parallel';
      name?: string;
      agents?: string[];
      count?: number;
      durationMs: number;
      cost: number;
    }
    const flowLines: FlowLine[] = [];
    let i = 0;

    while (i < sequence.length) {
      // Try loop detection: look for repeating patterns of length 2-4
      let foundLoop = false;

      for (let patLen = 2; patLen <= 4 && i + patLen * 2 <= sequence.length; patLen++) {
        const pattern = sequence.slice(i, i + patLen).map(s => s.name);

        // Count consecutive repetitions of this pattern
        let reps = 1;
        let j = i + patLen;
        while (j + patLen <= sequence.length) {
          const next = sequence.slice(j, j + patLen).map(s => s.name);
          if (pattern.every((p, idx) => p === next[idx])) {
            reps++;
            j += patLen;
          } else {
            break;
          }
        }

        if (reps >= 2) {
          // Collapse the loop
          const totalItems = reps * patLen;
          let loopDur = 0, loopCost = 0;
          for (let k = i; k < i + totalItems; k++) {
            loopDur += sequence[k].durationMs;
            loopCost += sequence[k].cost;
          }
          flowLines.push({
            type: 'loop',
            agents: pattern,
            count: reps,
            durationMs: loopDur,
            cost: loopCost,
          });
          i += totalItems;
          foundLoop = true;
          break;
        }
      }

      if (!foundLoop) {
        const entry = sequence[i];
        flowLines.push({
          type: entry.parallel ? 'parallel' : 'agent',
          name: entry.name,
          agents: entry.parallel,
          durationMs: entry.durationMs,
          cost: entry.cost,
        });
        i++;
      }
    }

    // Render vertical flow: icon  duration  cost  agent
    const durCol = 10;
    const costCol = 10;

    console.log(chalk.dim(`    ${('DUR').padEnd(durCol)}${('COST').padEnd(costCol)}AGENT`));
    console.log(chalk.dim(`    ${'\u2500'.repeat(durCol - 2).padEnd(durCol)}${'\u2500'.repeat(costCol - 2).padEnd(costCol)}${'\u2500'.repeat(30)}`));

    for (const line of flowLines) {
      const dur = fmtDur(line.durationMs).padEnd(durCol);
      const cost = chalk.dim(fmt(line.cost).padEnd(costCol));

      if (line.type === 'loop') {
        const loopLabel = `${line.agents!.join(' \u21C4 ')} \u00D7${line.count}`;
        console.log(`  ${chalk.yellow('\u21BB')} ${dur}${cost}${chalk.yellow(loopLabel)}`);
      } else if (line.type === 'parallel') {
        const label = line.agents!.join(' \u2016 ');
        console.log(`  ${chalk.green('\u2551')} ${dur}${cost}${chalk.green(label)}`);
      } else {
        console.log(`  ${chalk.dim('\u2502')} ${dur}${cost}${chalk.cyan(line.name || '')}`);
      }
    }

    console.log(chalk.dim(`    ${'\u2500'.repeat(durCol - 2).padEnd(durCol)}${'\u2500'.repeat(costCol - 2).padEnd(costCol)}`));
    console.log(`    ${chalk.bold(fmtDur(run.totalDurationMs).padEnd(durCol))}${chalk.bold(fmt(run.totalCost).padEnd(costCol))}${chalk.dim(`${flowLines.length} lines, ${sequence.length} invocations`)}`);
  }

  console.log();
}

/**
 * Show ideal execution stages derived from routing table and manifest.
 * BFS from entry_point groups agents by depth (stage). Manifest provides read/write files per agent.
 */
async function meshIdeal(meshName: string, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();

  let configPath = path.join(cwd, 'meshes', meshName, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    configPath = path.join(cwd, 'meshes', meshName, 'config.yml');
  }
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`Config not found: meshes/${meshName}/config.yaml`));
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(chalk.red('Failed to parse config:'), (err as Error).message);
    return;
  }

  const routing = config.routing as Record<string, Record<string, Record<string, string>>> | undefined;
  const entryPoint = config.entry_point as string | undefined;
  const manifest = config.manifest as { id: string; reads: string[]; writes: string[] }[] | undefined;

  if (!routing || !entryPoint) {
    console.error(chalk.red('Mesh must have routing and entry_point defined.'));
    return;
  }

  // Build adjacency: agent → set of destination agents (across all message types)
  // Also capture route labels for branch naming
  const adjacency = new Map<string, Set<string>>();
  const routeLabels = new Map<string, Map<string, string>>(); // agent → dest → label
  for (const [agent, routes] of Object.entries(routing)) {
    const dests = new Set<string>();
    const labels = new Map<string, string>();
    for (const typeRoutes of Object.values(routes)) {
      for (const [dest, label] of Object.entries(typeRoutes)) {
        if (dest !== 'core') {
          dests.add(dest);
          labels.set(dest, label as string);
        }
      }
    }
    adjacency.set(agent, dests);
    routeLabels.set(agent, labels);
  }

  // Detect branches: entry_point's direct destinations define separate flows
  // Flow name = first agent of the branch (the root)
  const entryDests = adjacency.get(entryPoint) || new Set<string>();
  const branches: { name: string; root: string }[] = [];

  if (entryDests.size > 1) {
    // Multiple branches from entry — name each by its root agent
    for (const dest of entryDests) {
      branches.push({ name: dest, root: dest });
    }
  } else {
    // Single flow
    branches.push({ name: 'main', root: entryPoint });
  }

  // BFS per branch to get per-flow stages
  interface FlowData {
    name: string;
    stages: Map<number, string[]>;
    depth: Map<string, number>;
  }
  const flows: FlowData[] = [];

  for (const branch of branches) {
    const depth = new Map<string, number>();
    const queue: string[] = [];

    // Always include entry at stage 1, branch root at stage 2
    if (branches.length > 1) {
      depth.set(entryPoint, 1);
      depth.set(branch.root, 2);
      queue.push(branch.root);
    } else {
      depth.set(entryPoint, 1);
      queue.push(entryPoint);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = depth.get(current)!;
      const dests = adjacency.get(current);
      if (!dests) continue;

      for (const dest of dests) {
        // Don't cross into other branch roots (except if they converge later)
        const isOtherBranchRoot = branches.length > 1 &&
          branches.some(b => b.root === dest && b.name !== branch.name) &&
          current === entryPoint;

        if (!depth.has(dest) && !isOtherBranchRoot) {
          depth.set(dest, currentDepth + 1);
          queue.push(dest);
        }
      }
    }

    // Group agents by stage
    const stages = new Map<number, string[]>();
    for (const [agent, d] of depth) {
      if (!stages.has(d)) stages.set(d, []);
      stages.get(d)!.push(agent);
    }

    flows.push({ name: branch.name, stages, depth });
  }

  // Build manifest lookup: agent → { reads: file[], writes: file[] }
  const agentFiles = new Map<string, { reads: string[]; writes: string[] }>();
  if (manifest) {
    for (const entry of manifest) {
      for (const reader of entry.reads || []) {
        if (!agentFiles.has(reader)) agentFiles.set(reader, { reads: [], writes: [] });
        agentFiles.get(reader)!.reads.push(entry.id);
      }
      for (const writer of entry.writes || []) {
        if (!agentFiles.has(writer)) agentFiles.set(writer, { reads: [], writes: [] });
        agentFiles.get(writer)!.writes.push(entry.id);
      }
    }
  }

  // JSON output
  if (flags.json) {
    const result = flows.map(flow => ({
      flow: flow.name,
      stages: [...flow.stages.keys()].sort((a, b) => a - b).map(stageNum => ({
        stage: stageNum,
        agents: flow.stages.get(stageNum)!,
        reads: [...new Set(flow.stages.get(stageNum)!.flatMap(a => agentFiles.get(a)?.reads || []))],
        writes: [...new Set(flow.stages.get(stageNum)!.flatMap(a => agentFiles.get(a)?.writes || []))],
      })),
    }));
    console.log(JSON.stringify({ mesh: meshName, flows: result }, null, 2));
    return;
  }

  // Build file → location mapping from manifest
  const fileLocation = new Map<string, string>();
  if (manifest) {
    for (const entry of manifest) {
      if (!fileLocation.has(entry.id)) {
        fileLocation.set(entry.id, (entry as { location?: string }).location || 'other');
      }
    }
  }

  const locationOrder = ['session', 'workspace', 'game', 'campaign', 'template', 'other'];

  console.log(`\n${chalk.bold(chalk.cyan(`Ideal: ${meshName}`))}\n`);

  // Show entry point if multiple branches
  if (flows.length > 1) {
    console.log(chalk.dim(`Entry: ${entryPoint} → branches to ${flows.map(f => f.name).join(', ')}`));
    console.log();
  }

  // Render each flow as a separate swimlane
  for (const flow of flows) {
    const sortedStages = [...flow.stages.keys()].sort((a, b) => a - b);

    // Collect files for this flow
    const allFiles: string[] = [];
    const fileFirstWrite = new Map<string, number>();
    const fileLastRead = new Map<string, number>();

    for (const stageNum of sortedStages) {
      const agents = flow.stages.get(stageNum)!;
      const reads = [...new Set(agents.flatMap(a => agentFiles.get(a)?.reads || []))];
      const writes = [...new Set(agents.flatMap(a => agentFiles.get(a)?.writes || []))];

      for (const f of writes) {
        if (!fileFirstWrite.has(f)) {
          fileFirstWrite.set(f, stageNum);
          allFiles.push(f);
        }
      }
      for (const f of reads) {
        fileLastRead.set(f, stageNum);
        if (!fileFirstWrite.has(f) && !allFiles.includes(f)) {
          allFiles.push(f);
        }
      }
    }

    const uniqueFiles = [...new Set(allFiles)];

    // Group files by location
    const filesByLocation = new Map<string, string[]>();
    for (const loc of locationOrder) {
      filesByLocation.set(loc, []);
    }
    for (const file of uniqueFiles) {
      const loc = fileLocation.get(file) || 'other';
      if (!filesByLocation.has(loc)) filesByLocation.set(loc, []);
      filesByLocation.get(loc)!.push(file);
    }

    // Build per-stage read/write sets
    const stageReads = new Map<number, Set<string>>();
    const stageWrites = new Map<number, Set<string>>();
    for (const stageNum of sortedStages) {
      const agents = flow.stages.get(stageNum)!;
      stageReads.set(stageNum, new Set(agents.flatMap(a => agentFiles.get(a)?.reads || [])));
      stageWrites.set(stageNum, new Set(agents.flatMap(a => agentFiles.get(a)?.writes || [])));
    }

    const fileColWidth = Math.max(30, ...uniqueFiles.map(f => f.length)) + 2;

    // Flow header
    console.log(chalk.bold(chalk.magenta(`═══ Flow: ${flow.name} ═══`)));
    console.log();

    // Stage listing
    console.log(chalk.bold('Stages:'));
    for (const stageNum of sortedStages) {
      const agents = flow.stages.get(stageNum)!;
      console.log(chalk.dim(`  ${String(stageNum).padStart(2)}. `) + chalk.cyan(agents.join(', ')));
    }
    console.log();

    // Column header
    let header = ''.padEnd(fileColWidth) + '│';
    for (const stageNum of sortedStages) {
      header += ` ${chalk.bold(String(stageNum).padStart(2))} `;
    }
    console.log(header);
    console.log('─'.repeat(fileColWidth) + '┼' + '────'.repeat(sortedStages.length));

    // File row renderer
    const renderFileRow = (file: string): string => {
      const lastRead = fileLastRead.get(file);
      let activeFlowLine = false;
      let row = chalk.dim(file.padEnd(fileColWidth)) + '│';

      for (const stageNum of sortedStages) {
        const reads = stageReads.get(stageNum)!;
        const writes = stageWrites.get(stageNum)!;
        const isWrite = writes.has(file);
        const isRead = reads.has(file);

        let sym: string;
        if (isWrite && isRead) {
          sym = chalk.yellow('◈');
          activeFlowLine = true;
        } else if (isWrite) {
          sym = chalk.green('◆');
          activeFlowLine = true;
        } else if (isRead) {
          sym = chalk.blue('○');
        } else if (activeFlowLine && lastRead && stageNum < lastRead) {
          sym = chalk.dim('─');
        } else {
          sym = ' ';
        }

        if (lastRead && stageNum >= lastRead) {
          activeFlowLine = false;
        }

        row += `  ${sym} `;
      }
      return row;
    };

    // Render files grouped by location
    for (const loc of locationOrder) {
      const files = filesByLocation.get(loc);
      if (!files || files.length === 0) continue;

      console.log(chalk.yellow(`[${loc}]`));
      for (const file of files) {
        console.log(renderFileRow(file));
      }
    }

    console.log();
  }

  // Legend
  console.log(chalk.dim('Legend: ') + chalk.green('◆') + chalk.dim(' write  ') + chalk.blue('○') + chalk.dim(' read  ') + chalk.yellow('◈') + chalk.dim(' both  ') + chalk.dim('─') + chalk.dim(' data flows right'));
}

/**
 * Show guardrail violations from activity logs
 * Reads activity.jsonl (and rotated files) for guardrail: events.
 */
async function meshGuardrails(meshName: string | undefined, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const logsDir = path.join(cwd, '.ai/tx/logs');

  // Collect activity log files (current + rotated)
  const logFiles: string[] = [];
  const currentLog = path.join(logsDir, 'activity.jsonl');
  if (fs.existsSync(currentLog)) logFiles.push(currentLog);
  for (let i = 1; i <= 10; i++) {
    const rotated = path.join(logsDir, `activity.${i}.jsonl`);
    if (fs.existsSync(rotated)) logFiles.push(rotated);
  }

  if (logFiles.length === 0) {
    console.log(chalk.yellow('No activity logs found.'));
    return;
  }

  interface GuardrailEvent {
    timestamp: string;
    event: string;
    agentId: string;
    content: string;
  }

  const events: GuardrailEvent[] = [];
  for (const file of logFiles) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.event?.startsWith('guardrail:')) continue;
        if (meshName && !entry.agentId?.startsWith(`${meshName}/`)) continue;
        events.push(entry);
      } catch { /* skip malformed lines */ }
    }
  }

  if (events.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify({ events: [] }));
    } else {
      console.log(chalk.dim('No guardrail violations found.'));
    }
    return;
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (flags.json) {
    console.log(JSON.stringify({ events, total: events.length }, null, 2));
    return;
  }

  // Summary by type
  const byType = new Map<string, number>();
  const byAgent = new Map<string, number>();
  for (const e of events) {
    const type = e.event.replace('guardrail:', '');
    byType.set(type, (byType.get(type) || 0) + 1);
    byAgent.set(e.agentId, (byAgent.get(e.agentId) || 0) + 1);
  }

  console.log(`\n${chalk.bold('Guardrail Violations')} ${chalk.dim(`(${events.length} total)`)}\n`);

  // By type
  console.log(chalk.bold('  By type:'));
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    const icon = type.includes('write') ? '✏️' : type.includes('read') ? '📖' : type.includes('edge') ? '🔄' : type.includes('artifact') ? '📦' : type.includes('preflight') ? '🚧' : '🛡️';
    console.log(`    ${icon}  ${type.padEnd(20)} ${chalk.bold(String(count))}`);
  }

  // By agent
  console.log(`\n${chalk.bold('  By agent:')}`);
  for (const [agent, count] of [...byAgent.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${chalk.cyan(agent.padEnd(35))} ${chalk.bold(String(count))}`);
  }

  // Recent violations (last 15)
  const recent = events.slice(-15);
  console.log(`\n${chalk.bold('  Recent violations:')}`);
  for (const e of recent) {
    const time = e.timestamp.slice(11, 19);
    const type = e.event.replace('guardrail:', '');
    const agent = e.agentId.split('/').pop() || e.agentId;
    const isBlock = e.content.includes('BLOCKED') || e.content.includes('HALT') || e.content.includes('KILL');
    const color = isBlock ? chalk.red : e.content.includes('WARNING') ? chalk.yellow : chalk.dim;
    console.log(`    ${chalk.dim(time)} ${chalk.magenta(type.padEnd(14))} ${chalk.cyan(agent.padEnd(18))} ${color(e.content.slice(0, 80))}`);
  }

  console.log();
}

/**
 * Chronological dump of all events for a mesh run.
 * Merges logs, messages, sessions, and prompts into a single timeline.
 */
async function meshDump(meshName: string | undefined, flags: MeshFlags): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const logsDir = path.join(cwd, '.ai/tx/logs');
  const queuePath = path.join(cwd, '.ai/tx/queue.db');
  const sessionsPath = path.join(cwd, '.ai/tx/data/sessions.db');
  const promptsDir = path.join(cwd, '.ai/tx/prompts');

  // --- Unified event type for chronological merge ---
  interface DumpEvent {
    timestamp: number;
    type: 'log' | 'msg' | 'session' | 'prompt';
    data: Record<string, unknown>;
  }

  const events: DumpEvent[] = [];

  // --- 1. Collect log files (reuse meshFlow pattern) ---
  const logFiles: string[] = [];
  const currentLog = path.join(logsDir, 'v4.jsonl');
  if (fs.existsSync(currentLog)) logFiles.push(currentLog);
  for (let i = 1; i <= 4; i++) {
    const logPath = path.join(logsDir, `v4.${i}.jsonl`);
    if (fs.existsSync(logPath)) logFiles.push(logPath);
  }

  // Read all log lines across files
  const allLogLines: string[] = [];
  for (const logFile of logFiles) {
    const content = fs.readFileSync(logFile, 'utf-8');
    allLogLines.push(...content.split('\n').filter(Boolean));
  }

  // --- 2. Identify mesh name if not provided (pick last active mesh) ---
  if (!meshName) {
    // Find the most recent mesh run from boundaries
    let latestMs = 0;
    let latestMesh = '';
    for (const line of allLogLines) {
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.message !== 'Mesh run started') continue;
      const data = entry.data as Record<string, unknown> | undefined;
      if (!data?.meshName || !data?.meshInstance) continue;
      const ts = Date.parse(entry.timestamp as string);
      if (ts > latestMs) {
        latestMs = ts;
        latestMesh = data.meshName as string;
      }
    }
    if (!latestMesh) {
      if (flags.json) {
        console.log(JSON.stringify({ error: 'No mesh runs found', hint: 'Specify a mesh name or run a mesh first.' }));
      } else {
        console.log(chalk.yellow('No mesh runs found.'));
        console.log(chalk.dim('Specify a mesh name or run a mesh first.'));
      }
      return;
    }
    meshName = latestMesh;
  }

  // --- 3. Parse run boundaries ---
  const boundaries = parseMeshRunBoundaries(allLogLines, meshName);

  // Determine which runs to dump
  let targetRuns: { meshInstance: string; startMs: number; endMs: number | null }[];
  if (flags.all || boundaries.length === 0) {
    targetRuns = boundaries.length > 0 ? boundaries : [{ meshInstance: 'unknown', startMs: 0, endMs: null }];
  } else {
    // Last run only
    targetRuns = [boundaries[boundaries.length - 1]];
  }

  // --- 4. Collect logs for this mesh ---
  for (const line of allLogLines) {
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line); } catch { continue; }

    const data = entry.data as Record<string, unknown> | undefined;
    const workerId = data?.workerId as string | undefined;
    const meshNameFromData = data?.meshName as string | undefined;

    // Filter: belongs to this mesh
    const belongsToMesh =
      meshNameFromData === meshName ||
      (workerId && workerId.startsWith(`${meshName}/`)) ||
      (data?.meshInstance && (data.meshInstance as string).startsWith(meshName!));

    if (!belongsToMesh) continue;

    const ts = Date.parse(entry.timestamp as string);
    if (isNaN(ts)) continue;

    events.push({
      timestamp: ts,
      type: 'log',
      data: {
        level: entry.level || 'info',
        component: entry.component || '',
        message: entry.message || '',
        workerId: workerId || '',
        ...((data?.durationMs !== undefined) ? { durationMs: data.durationMs } : {}),
        ...((data?.totalCostUsd !== undefined) ? { cost: data.totalCostUsd } : {}),
        ...((data?.model !== undefined) ? { model: data.model } : {}),
        ...((data?.targetCount !== undefined) ? { targetCount: data.targetCount } : {}),
        ...((data?.targets !== undefined) ? { targets: data.targets } : {}),
      },
    });
  }

  // --- 5. Collect messages ---
  if (fs.existsSync(queuePath)) {
    const queue = new MessageQueue(queuePath);
    try {
      // Get all messages and filter for this mesh
      const allMsgs = queue.queryMessages({ limit: 5000 });
      const meshMsgs = allMsgs.filter(m =>
        m.to_agent.startsWith(`${meshName}/`) ||
        m.from_agent.startsWith(`${meshName}/`)
      );

      for (const msg of meshMsgs) {
        const ts = msg.created_at || 0;
        const payload = msg.payload || {};
        events.push({
          timestamp: ts,
          type: 'msg',
          data: {
            from: msg.from_agent,
            to: msg.to_agent,
            msgType: msg.type,
            status: msg.status || 'unknown',
            headline: (payload as Record<string, unknown>).headline || '',
            id: msg.id,
          },
        });
      }
    } finally {
      queue.close();
    }
  }

  // --- 6. Collect sessions ---
  if (fs.existsSync(sessionsPath)) {
    const sessionStore = new SessionStore(sessionsPath);
    try {
      const sessions = sessionStore.listSessionsByMesh(meshName, 200);
      for (const session of sessions) {
        // Use endedAt for session events (when they completed)
        const ts = session.endedAt || session.startedAt;
        const filesChanged = session.filesChanged;
        const filesList: string[] = [];
        if (filesChanged) {
          if (filesChanged.created) filesList.push(...filesChanged.created.map(f => `+${f}`));
          if (filesChanged.modified) filesList.push(...filesChanged.modified.map(f => `~${f}`));
          if (filesChanged.deleted) filesList.push(...filesChanged.deleted.map(f => `-${f}`));
        }

        events.push({
          timestamp: ts,
          type: 'session',
          data: {
            agent: session.agentId,
            status: session.finalStatus || 'unknown',
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            durationSeconds: session.durationSeconds || (session.endedAt ? Math.round((session.endedAt - session.startedAt) / 1000) : undefined),
            messageCount: session.messageCount || 0,
            toolCalls: session.toolCalls || 0,
            headline: session.headline || '',
            files: filesList.length > 0 ? filesList : undefined,
          },
        });
      }
    } finally {
      sessionStore.close();
    }
  }

  // --- 7. Collect prompts ---
  const meshPromptsDir = path.join(promptsDir, meshName);
  if (fs.existsSync(meshPromptsDir)) {
    const promptFiles = fs.readdirSync(meshPromptsDir).filter(f => f.endsWith('.md'));
    for (const file of promptFiles) {
      const filePath = path.join(meshPromptsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse frontmatter for timestamp and agent
      let timestamp = 0;
      let agent = file.replace('.md', '');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fm = fmMatch[1];
        const tsMatch = fm.match(/timestamp:\s*(.+)/);
        if (tsMatch) {
          const parsed = Date.parse(tsMatch[1].trim());
          if (!isNaN(parsed)) timestamp = parsed;
        }
        const agentMatch = fm.match(/agent:\s*(.+)/);
        if (agentMatch) agent = agentMatch[1].trim();
      }

      // Extract first few lines of prompt body (after frontmatter)
      const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content.trim();
      const previewLines = body.split('\n').slice(0, 3).join('\n');

      events.push({
        timestamp: timestamp || 0,
        type: 'prompt',
        data: {
          agent,
          file: file,
          preview: previewLines,
          fullContent: flags.verbose ? body : undefined,
        },
      });
    }
  }

  // --- 8. Sort all events chronologically ---
  events.sort((a, b) => a.timestamp - b.timestamp);

  if (events.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify({ mesh: meshName, events: [], error: 'No events found' }));
    } else {
      console.log(chalk.yellow(`No events found for mesh '${meshName}'.`));
      console.log(chalk.dim('Run the mesh first, or check the mesh name.'));
    }
    return;
  }

  // --- 9. Filter events by run boundaries ---
  for (const run of targetRuns) {
    const windowStart = run.startMs || 0;
    const windowEnd = run.endMs || Date.now();

    // Include events in the run window (with 5s grace before start for prompts)
    const runEvents = (run.startMs === 0 && run.endMs === null)
      ? events  // No boundaries, include everything
      : events.filter(e =>
          e.timestamp >= windowStart - 5000 && e.timestamp <= windowEnd + 5000
        );

    if (runEvents.length === 0) continue;

    // --- 10. JSON output ---
    if (flags.json) {
      const jsonEvents = runEvents.map(e => ({
        timestamp: new Date(e.timestamp).toISOString(),
        type: e.type,
        ...e.data,
      }));

      // Compute summary
      const logCount = runEvents.filter(e => e.type === 'log').length;
      const msgCount = runEvents.filter(e => e.type === 'msg').length;
      const sessionCount = runEvents.filter(e => e.type === 'session').length;
      const promptCount = runEvents.filter(e => e.type === 'prompt').length;
      const totalCost = runEvents
        .filter(e => e.type === 'log' && e.data.cost)
        .reduce((s, e) => s + (e.data.cost as number), 0);
      const uniqueAgents = new Set<string>();
      for (const e of runEvents) {
        const wid = (e.data.workerId || e.data.agent || '') as string;
        if (wid && wid.includes('/')) uniqueAgents.add(wid);
      }

      console.log(JSON.stringify({
        mesh: meshName,
        meshInstance: run.meshInstance,
        startTime: run.startMs ? new Date(run.startMs).toISOString() : null,
        endTime: run.endMs ? new Date(run.endMs).toISOString() : null,
        status: run.endMs ? 'completed' : 'in_progress',
        agents: uniqueAgents.size,
        totalCost,
        summary: { logs: logCount, messages: msgCount, sessions: sessionCount, prompts: promptCount },
        events: jsonEvents,
      }, null, 2));
      continue;
    }

    // --- 11. Human-readable rendering ---
    const startStr = run.startMs
      ? new Date(run.startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : '?';
    const endStr = run.endMs
      ? new Date(run.endMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : 'in progress';

    // Count unique agents and total cost
    const uniqueAgents = new Set<string>();
    let totalCost = 0;
    for (const e of runEvents) {
      const wid = (e.data.workerId || e.data.agent || '') as string;
      if (wid && wid.includes('/')) uniqueAgents.add(wid);
      if (e.type === 'log' && e.data.cost) totalCost += e.data.cost as number;
    }

    const status = run.endMs ? 'completed' : 'in progress';
    const statusColor = run.endMs ? chalk.green(status) : chalk.yellow(status);

    // Header
    console.log(`\n${chalk.bold('══════════════════════════════════════════════════')}`);
    console.log(chalk.bold(` Mesh Dump: ${chalk.cyan(meshName)}`));
    console.log(` Run: ${chalk.dim(startStr)}  →  ${chalk.dim(endStr)}`);
    console.log(` Status: ${statusColor}  |  Agents: ${chalk.bold(String(uniqueAgents.size))}  |  Cost: ${chalk.bold('$' + totalCost.toFixed(3))}`);
    console.log(chalk.bold('══════════════════════════════════════════════════\n'));

    // Render each event
    for (const event of runEvents) {
      const time = new Date(event.timestamp).toISOString().slice(11, 19); // HH:MM:SS
      const timeStr = chalk.dim(time);

      switch (event.type) {
        case 'log': {
          const level = event.data.level as string;
          const message = event.data.message as string;
          const component = event.data.component as string;
          const workerId = event.data.workerId as string;

          // Color by level
          let levelColor: string;
          if (level === 'error') levelColor = chalk.red('ERR');
          else if (level === 'warn') levelColor = chalk.yellow('WRN');
          else levelColor = chalk.dim('LOG');

          // Build detail string
          const parts: string[] = [];
          if (workerId) parts.push(chalk.cyan(workerId.split('/')[1] || workerId));
          if (component && !workerId) parts.push(chalk.dim(component));

          // Special formatting for key log messages
          let extra = '';
          if (event.data.durationMs) extra += chalk.dim(` ${((event.data.durationMs as number) / 1000).toFixed(1)}s`);
          if (event.data.cost) extra += chalk.dim(` $${(event.data.cost as number).toFixed(3)}`);
          if (event.data.model) extra += chalk.dim(` (${event.data.model})`);
          if (event.data.targetCount) extra += chalk.dim(` ${event.data.targetCount} targets`);

          console.log(`─── ${timeStr}  ${levelColor}  ${parts.join(' ')} ${message}${extra}`);
          break;
        }

        case 'msg': {
          const from = event.data.from as string;
          const to = event.data.to as string;
          const msgType = event.data.msgType as string;
          const headline = event.data.headline as string;

          // Direction arrow
          const isIncoming = from.startsWith(`${meshName}/`);
          const arrow = isIncoming ? chalk.blue('←') : chalk.green('→');
          const target = isIncoming ? `${chalk.cyan(from)}` : `${chalk.cyan(to)}`;

          // Type badge
          let typeBadge: string;
          if (msgType === 'task') typeBadge = chalk.green('[task]');
          else if (msgType === 'task-complete') typeBadge = chalk.blue('[complete]');
          else if (msgType === 'ask-human') typeBadge = chalk.yellow('[ask-human]');
          else if (msgType === 'ask-response') typeBadge = chalk.magenta('[response]');
          else typeBadge = chalk.dim(`[${msgType}]`);

          const headlineStr = headline ? ` "${headline}"` : '';
          console.log(`─── ${timeStr}  ${chalk.bold('MSG')}  ${arrow} ${target}  ${typeBadge}${chalk.dim(headlineStr)}`);
          break;
        }

        case 'session': {
          const agent = event.data.agent as string;
          const sessionStatus = event.data.status as string;
          const durationSeconds = event.data.durationSeconds as number | undefined;
          const toolCalls = event.data.toolCalls as number;
          const headline = event.data.headline as string;
          const files = event.data.files as string[] | undefined;

          const statusStr = sessionStatus === 'success'
            ? chalk.green(sessionStatus)
            : sessionStatus === 'error'
              ? chalk.red(sessionStatus)
              : chalk.yellow(sessionStatus);

          const durStr = durationSeconds ? `${durationSeconds}s` : '';
          const toolStr = toolCalls ? `${toolCalls} tool calls` : '';
          const details = [durStr, toolStr].filter(Boolean).join(', ');

          console.log(`─── ${timeStr}  ${chalk.magenta('SESSION')}  ${chalk.cyan(agent)} — ${statusStr} (${details})`);
          if (headline) console.log(`    ${chalk.dim('Headline:')} ${headline}`);
          if (files && files.length > 0) console.log(`    ${chalk.dim('Files:')} ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` (+${files.length - 5} more)` : ''}`);
          break;
        }

        case 'prompt': {
          const agent = event.data.agent as string;
          const preview = event.data.preview as string;
          const fullContent = event.data.fullContent as string | undefined;

          console.log(`─── ${timeStr}  ${chalk.yellow('PROMPT')}  ${chalk.cyan(agent)}`);
          if (fullContent) {
            // Verbose mode: show full prompt indented
            const indented = fullContent.split('\n').map(l => `    ${l}`).join('\n');
            console.log(chalk.dim(indented));
          } else if (preview) {
            // Default: show first 3 lines
            const indented = preview.split('\n').map(l => `    ${chalk.dim(l)}`).join('\n');
            console.log(indented);
          }
          break;
        }
      }
    }

    // Footer
    const logCount = runEvents.filter(e => e.type === 'log').length;
    const msgCount = runEvents.filter(e => e.type === 'msg').length;
    const sessionCount = runEvents.filter(e => e.type === 'session').length;
    const promptCount = runEvents.filter(e => e.type === 'prompt').length;
    console.log(`\n${chalk.bold('══════════════════════════════════════════════════')}`);
    console.log(chalk.dim(`  ${runEvents.length} events: ${logCount} logs, ${msgCount} msgs, ${sessionCount} sessions, ${promptCount} prompts`));
    console.log();
  }
}

/**
 * Print usage help
 */
function printUsage(): void {
  console.log(`
${chalk.bold('Usage:')} tx mesh <action> [mesh] [options]

${chalk.bold('Actions:')}
  ${chalk.cyan('list')}                    List meshes with activity
  ${chalk.cyan('status')} <mesh>           Show mesh state snapshot
  ${chalk.cyan('kill')} <mesh>             Kill all workers for a mesh (via tmux)
  ${chalk.cyan('reload')} [mesh]           Hot-reload mesh config(s) at runtime
  ${chalk.cyan('clear')} <mesh>            Clear SQLite state (suspended sessions, pending asks, FSM)
  ${chalk.cyan('unstick')} <mesh>          Clear halt state only (preserves FSM state)
  ${chalk.cyan('validate')} <mesh>         Validate mesh configuration
  ${chalk.cyan('fsm-chain')} <mesh>       Show FSM state transition chain with validation
  ${chalk.cyan('fsm-reset')} <mesh>       Reset FSM to initial state (preserves sessions)
  ${chalk.cyan('fsm-goto')} <mesh> <state> Force FSM to a specific state
  ${chalk.cyan('run')} <mesh> "<prompt>"    Run full FSM pipeline end-to-end
  ${chalk.cyan('cost')} [mesh]              Per-agent cost/token/cache from prior runs
  ${chalk.cyan('flow')} <mesh>             Agent execution timeline with concurrency grouping
  ${chalk.cyan('guardrails')} [mesh]       Show guardrail violations from activity logs
  ${chalk.cyan('ideal')} <mesh>            Ideal execution stages from routing + manifest
  ${chalk.cyan('dump')} [mesh]             Chronological dump of all events (logs, msgs, sessions, prompts)

${chalk.bold('Options:')}
  ${chalk.dim('--json')}                  Output as JSON
  ${chalk.dim('--force')}                 Force clear even if workers are running
  ${chalk.dim('--strict')}                Treat warnings as errors (validate only)
  ${chalk.dim('--next')}                  Machine-readable dispatch output (status only)
  ${chalk.dim('--all')}                   Dump all runs, not just last (dump only)
  ${chalk.dim('--verbose')}               Show full prompts (dump only)

${chalk.bold('Examples:')}
  tx mesh list
  tx mesh list --json
  tx mesh status narrative-engine
  tx mesh status dev --json
  tx mesh kill narrative-engine
  tx mesh clear test-mesh
  tx mesh clear test-mesh --force
  tx mesh cost
  tx mesh cost narrative-engine --json
  tx mesh flow test-fsm-full
  tx mesh flow test-fsm-full --json
  tx mesh ideal narrative-engine
  tx mesh ideal narrative-engine --json
  tx mesh dump dev-tdd
  tx mesh dump dev-tdd --json
  tx mesh dump --all
`);
}

/**
 * Main mesh command entry point
 */
export async function mesh(args: string[]): Promise<void> {
  const nonFlagArgs = getNonFlagArgs(args);
  const [action, meshName] = nonFlagArgs;
  const flags = parseFlags(args);

  try {
    switch (action) {
      case 'list':
        await listMeshes(flags);
        break;

      case 'status': {
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh status narrative-engine'));
          return;
        }
        const statusCwd = process.env.TX_CWD || process.cwd();
        // Silent FSM check — avoid loadFSMConfig's console.error for non-FSM meshes
        const hasFsm = (() => {
          let cp = path.join(statusCwd, 'meshes', meshName, 'config.yaml');
          if (!fs.existsSync(cp)) cp = path.join(statusCwd, 'meshes', meshName, 'config.yml');
          if (!fs.existsSync(cp)) return false;
          try { return !!YAML.parse(fs.readFileSync(cp, 'utf-8'))?.fsm; } catch { return false; }
        })();

        if (hasFsm && (flags.json || flags.next)) {
          // JSON/next mode: FSM pipeline view only (single structured output)
          await fsmStatus(meshName, flags);
        } else {
          // Default mode: show runtime status, then FSM pipeline if applicable
          await showMeshStatus(meshName, flags);
          if (hasFsm) {
            await fsmStatus(meshName, flags);
          }
        }
        break;
      }

      case 'kill':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh kill narrative-engine'));
          return;
        }
        await killMeshWorkers(meshName, flags);
        break;

      case 'reload':
        await reloadMeshConfigs(meshName, flags);
        break;

      case 'clear':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh clear test-mesh'));
          return;
        }
        await clearMeshState(meshName, flags);
        break;

      case 'unstick':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh unstick narrative-engine'));
          return;
        }
        await unstickMesh(meshName, flags);
        break;

      case 'drain':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh drain opus-soul'));
          return;
        }
        await drainMesh(meshName, flags);
        break;

      case 'validate':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name or path required'));
          console.log(chalk.dim('Example: tx mesh validate narrative-engine'));
          return;
        }
        await validateMesh(meshName, { strict: flags.strict });
        break;

      case 'fsm-chain':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh fsm-chain narrative-engine-fsm'));
          return;
        }
        await fsmChain(meshName, flags);
        break;

      case 'fsm-reset':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh fsm-reset test-fsm-full'));
          return;
        }
        await fsmReset(meshName, flags);
        break;

      case 'fsm-goto': {
        const targetState = nonFlagArgs[2];
        if (!meshName || !targetState) {
          console.error(chalk.red('Error: Mesh name and target state required'));
          console.log(chalk.dim('Example: tx mesh fsm-goto test-fsm-full linear_pipeline'));
          return;
        }
        await fsmGoto(meshName, targetState, flags);
        break;
      }

      case 'run': {
        // Collect prompt from remaining non-flag args after mesh name
        const promptParts = nonFlagArgs.slice(2);
        if (!meshName || promptParts.length === 0) {
          console.error(chalk.red('Error: Mesh name and prompt required'));
          console.log(chalk.dim('Example: tx mesh run test-fsm-full "go"'));
          return;
        }
        await meshRun(meshName, promptParts.join(' '), flags);
        break;
      }

      case 'cost':
        await meshCost(meshName, flags);
        break;

      case 'flow':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh flow test-fsm-full'));
          return;
        }
        await meshFlow(meshName, flags);
        break;

      case 'guardrails':
        await meshGuardrails(meshName, flags);
        break;

      case 'ideal':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh ideal narrative-engine'));
          return;
        }
        await meshIdeal(meshName, flags);
        break;

      case 'dump':
        await meshDump(meshName, flags);
        break;

      default:
        printUsage();
    }
  } catch (err) {
    log.error('cli-mesh', 'Mesh command failed', {
      action,
      meshName,
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(chalk.red('Error:'), err instanceof Error ? err.message : String(err));
  }
}

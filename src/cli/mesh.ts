/**
 * tx mesh - Mesh state management CLI command
 *
 * Commands:
 *   tx mesh list              List meshes with activity
 *   tx mesh status <mesh>     Show mesh state snapshot
 *   tx mesh kill <mesh>       Kill all workers for a mesh (via tmux)
 *   tx mesh clear <mesh>      Clear SQLite state (suspended sessions, pending asks, FSM)
 */

import { MessageQueue, FSMPersistence } from '../queue/index.ts';
import { SessionStore } from '../session/index.ts';
import { log } from '../shared/logger.ts';
import { chalk } from '../shared/colors.ts';
import { formatTimeAgo } from '../shared/time.ts';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

interface MeshFlags {
  json?: boolean;
  force?: boolean;
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

    // Combine all meshes
    const allMeshes = new Set<string>([
      ...suspendedByMesh.keys(),
      ...pendingByMesh.keys(),
      ...sessionsByMesh.keys(),
      ...fsmMeshes,
      ...workersByMesh.keys(),
    ]);

    const meshActivities: MeshActivity[] = [];
    for (const meshName of allMeshes) {
      meshActivities.push({
        meshName,
        suspendedCount: suspendedByMesh.get(meshName) || 0,
        pendingAsksCount: pendingByMesh.get(meshName) || 0,
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
      chalk.dim('SESSIONS'.padEnd(10)) +
      chalk.dim('STATUS')
    );
    console.log(chalk.dim('-'.repeat(62)));

    for (const mesh of meshActivities) {
      const statusParts: string[] = [];
      if (mesh.hasWorkers) statusParts.push(chalk.green('running'));
      if (mesh.hasFsmState) statusParts.push(chalk.blue('fsm'));
      if (statusParts.length === 0) statusParts.push(chalk.dim('idle'));

      console.log(
        chalk.cyan(mesh.meshName.padEnd(20)) +
        (mesh.suspendedCount > 0 ? chalk.yellow(String(mesh.suspendedCount).padEnd(12)) : chalk.dim('0'.padEnd(12))) +
        (mesh.pendingAsksCount > 0 ? chalk.yellow(String(mesh.pendingAsksCount).padEnd(10)) : chalk.dim('0'.padEnd(10))) +
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
    if (fsmState) {
      console.log(`  ${chalk.dim('FSM state:')} cleared (was: ${fsmState.currentState})`);
    }

    if (suspendedCleared === 0 && asksCleared === 0 && !fsmState) {
      console.log(chalk.dim('  No state to clear.'));
    }
    console.log();

    log.info('cli-mesh', 'Cleared mesh state', {
      meshName,
      suspendedCleared,
      asksCleared,
      fsmCleared: !!fsmState,
    });
  } finally {
    queue.close();
  }
}

/**
 * Kill all workers for a mesh by killing matching tmux sessions
 * Session naming pattern: tx-tx-{meshname}-{hash}
 */
async function killMeshWorkers(meshName: string, flags: MeshFlags): Promise<void> {
  try {
    // List all tmux sessions
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}"');
    const sessions = stdout.trim().split('\n').filter(Boolean);

    // Find sessions matching this mesh (pattern: tx-tx-{meshname}-{hash})
    const pattern = `tx-tx-${meshName}-`;
    const matchingSessions = sessions.filter(s => s.startsWith(pattern));

    if (matchingSessions.length === 0) {
      if (flags.json) {
        console.log(JSON.stringify({ killed: 0, message: 'No active sessions found for mesh' }));
      } else {
        console.log(chalk.yellow(`No active sessions found for mesh: ${meshName}`));
      }
      return;
    }

    // Kill each matching session
    let killed = 0;
    const errors: string[] = [];

    for (const session of matchingSessions) {
      try {
        await execAsync(`tmux kill-session -t '${session}'`);
        killed++;
        log.info('cli-mesh', 'Killed tmux session', { session, meshName });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${session}: ${msg}`);
        log.error('cli-mesh', 'Failed to kill session', { session, error: msg });
      }
    }

    if (flags.json) {
      console.log(JSON.stringify({
        killed,
        total: matchingSessions.length,
        sessions: matchingSessions,
        errors: errors.length > 0 ? errors : undefined
      }));
    } else {
      console.log(chalk.green(`✓ Killed ${killed}/${matchingSessions.length} session(s) for ${meshName}`));
      if (errors.length > 0) {
        console.log(chalk.yellow('Some sessions failed to kill:'));
        errors.forEach(e => console.log(chalk.dim(`  ${e}`)));
      }
    }
  } catch (err) {
    // tmux list-sessions fails if no sessions exist
    if (flags.json) {
      console.log(JSON.stringify({ killed: 0, message: 'No tmux sessions running' }));
    } else {
      console.log(chalk.yellow('No tmux sessions running'));
    }
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
  ${chalk.cyan('clear')} <mesh>            Clear SQLite state (suspended sessions, pending asks, FSM)

${chalk.bold('Options:')}
  ${chalk.dim('--json')}                  Output as JSON
  ${chalk.dim('--force')}                 Force clear even if workers are running

${chalk.bold('Examples:')}
  tx mesh list
  tx mesh list --json
  tx mesh status narrative-engine
  tx mesh status dev --json
  tx mesh kill narrative-engine
  tx mesh clear test-mesh
  tx mesh clear test-mesh --force
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

      case 'status':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh status narrative-engine'));
          return;
        }
        await showMeshStatus(meshName, flags);
        break;

      case 'kill':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh kill narrative-engine'));
          return;
        }
        await killMeshWorkers(meshName, flags);
        break;

      case 'clear':
        if (!meshName) {
          console.error(chalk.red('Error: Mesh name required'));
          console.log(chalk.dim('Example: tx mesh clear test-mesh'));
          return;
        }
        await clearMeshState(meshName, flags);
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

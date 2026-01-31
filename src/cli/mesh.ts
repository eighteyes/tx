/**
 * tx mesh - Mesh state management CLI command
 *
 * Commands:
 *   tx mesh list              List meshes with activity
 *   tx mesh status <mesh>     Show mesh state snapshot
 *   tx mesh kill <mesh>       Kill all workers for a mesh (via tmux)
 *   tx mesh clear <mesh>      Clear SQLite state (suspended sessions, pending asks, FSM)
 *   tx mesh validate <mesh>   Validate mesh configuration
 *   tx mesh fsm-chain <mesh>  Show FSM state transition chain with validation
 *   tx mesh fsm-reset <mesh>  Reset FSM to initial state (preserves sessions)
 *   tx mesh fsm-goto <mesh> <state>  Force FSM to a specific state
 *   tx mesh run <mesh> "<prompt>"   Run full FSM pipeline end-to-end
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
            'task-complete'
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
  ${chalk.cyan('validate')} <mesh>         Validate mesh configuration
  ${chalk.cyan('fsm-chain')} <mesh>       Show FSM state transition chain with validation
  ${chalk.cyan('fsm-reset')} <mesh>       Reset FSM to initial state (preserves sessions)
  ${chalk.cyan('fsm-goto')} <mesh> <state> Force FSM to a specific state
  ${chalk.cyan('run')} <mesh> "<prompt>"    Run full FSM pipeline end-to-end

${chalk.bold('Options:')}
  ${chalk.dim('--json')}                  Output as JSON
  ${chalk.dim('--force')}                 Force clear even if workers are running
  ${chalk.dim('--strict')}                Treat warnings as errors (validate only)

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

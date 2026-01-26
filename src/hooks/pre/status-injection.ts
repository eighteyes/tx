/**
 * Status Injection Pre-Hook
 *
 * Injects comprehensive TX system state into agent context before processing.
 * Supports two modes:
 * - Passive (default): Shows file paths, agent reads what's relevant
 * - Active: Injects full message content directly
 *
 * State gathered:
 * - Active meshes with worker counts
 * - Locked agents (processing, awaiting)
 * - Pending asks awaiting response
 * - Queued messages
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

/**
 * Worker state from workers.json
 */
interface WorkerState {
  id: string;
  agentId: string;
  status: string;
  startedAt: number;
  messagesProcessed: number;
  duration: number;
  awaitingResponses?: string[];
  awaitDuration?: number;
}

/**
 * Parsed workers.json file
 */
interface WorkersFile {
  workers: WorkerState[];
  updatedAt: number;
}

/**
 * Mesh status summary
 */
interface MeshStatus {
  name: string;
  activeWorkers: number;
  state: 'active' | 'idle' | 'suspended';
}

/**
 * Locked agent info
 */
interface LockedAgent {
  agentId: string;
  reason: 'processing' | 'awaiting';
  durationSecs: number;
}

/**
 * Queued message summary
 */
interface QueuedMessage {
  path: string;
  type: string;
  from: string;
  to: string;
}

/**
 * Check if status injection is in active mode
 * Active mode injects full message content, passive mode shows file paths
 */
function isActiveMode(): boolean {
  return process.env.TX_STATUS_INJECTION_MODE === 'active';
}

/**
 * Read workers.json state file
 */
function readWorkersState(workDir: string): WorkersFile | null {
  const workersPath = path.join(workDir, '.ai', 'tx', 'data', 'workers.json');

  if (!fs.existsSync(workersPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(workersPath, 'utf-8');
    return JSON.parse(content) as WorkersFile;
  } catch (error) {
    log.warn('hooks', 'Failed to read workers.json', {
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Group workers by mesh and calculate mesh status
 */
function getMeshStatuses(workers: WorkerState[]): MeshStatus[] {
  const meshMap = new Map<string, { active: number; awaiting: number }>();

  for (const worker of workers) {
    const meshName = worker.agentId.split('/')[0];
    if (!meshName) continue;

    const current = meshMap.get(meshName) || { active: 0, awaiting: 0 };

    if (worker.status === 'awaiting') {
      current.awaiting++;
    } else {
      current.active++;
    }

    meshMap.set(meshName, current);
  }

  return Array.from(meshMap.entries()).map(([name, counts]) => ({
    name,
    activeWorkers: counts.active + counts.awaiting,
    state: counts.awaiting > 0 ? 'suspended' as const :
           counts.active > 0 ? 'active' as const : 'idle' as const,
  }));
}

/**
 * Extract locked agents from worker state
 * Workers in 'awaiting' status are considered locked
 */
function getLockedAgents(workers: WorkerState[]): LockedAgent[] {
  const now = Date.now();

  return workers
    .filter(w => w.status === 'awaiting' || w.status === 'running')
    .map(w => ({
      agentId: w.agentId,
      reason: w.status === 'awaiting' ? 'awaiting' as const : 'processing' as const,
      durationSecs: Math.round((now - w.startedAt) / 1000),
    }));
}

/**
 * Format mesh summary line
 * Example: "dev(2), brain(1)"
 */
function formatMeshSummary(meshes: MeshStatus[]): string {
  if (meshes.length === 0) return 'none';
  return meshes.map(m => `${m.name}(${m.activeWorkers})`).join(', ');
}

/**
 * Format locked agents line
 * Example: "dev/worker (processing, 45s)"
 */
function formatLockedAgents(locked: LockedAgent[]): string {
  if (locked.length === 0) return 'none';
  return locked.map(a => `${a.agentId} (${a.reason}, ${a.durationSecs}s)`).join(', ');
}

/**
 * Build passive mode output - file paths only
 */
function buildPassiveOutput(
  meshes: MeshStatus[],
  locked: LockedAgent[],
  pendingAskCount: number,
  messages: QueuedMessage[],
  msgsDir: string
): string {
  const lines: string[] = [
    '[TX System State]',
    `Meshes: ${formatMeshSummary(meshes)}`,
    `Locked: ${formatLockedAgents(locked)}`,
    `Pending asks: ${pendingAskCount}`,
    '',
  ];

  if (messages.length > 0) {
    lines.push(`New messages (${messages.length}):`);
    for (const msg of messages) {
      lines.push(`- ${msg.path}`);
    }
    lines.push('');
    lines.push('Use Read tool for relevant messages.');
  } else {
    lines.push('No new messages.');
  }

  lines.push('');
  lines.push(`Write response messages to: ${msgsDir}`);

  return lines.join('\n');
}

/**
 * Build active mode output - full message content
 */
function buildActiveOutput(
  meshes: MeshStatus[],
  locked: LockedAgent[],
  messages: QueuedMessage[],
  msgsDir: string
): string {
  const lines: string[] = [
    '[TX System State]',
    `Meshes: ${formatMeshSummary(meshes)}`,
    '',
  ];

  // Include full message content
  for (const msg of messages) {
    try {
      const content = fs.readFileSync(msg.path, 'utf-8');
      lines.push(`[Message from ${msg.from}]`);
      lines.push(content);
      lines.push('');
      lines.push('---');
      lines.push('');
    } catch {
      // Skip messages that can't be read
      lines.push(`[Message from ${msg.from}] (file not readable: ${msg.path})`);
      lines.push('');
    }
  }

  lines.push(`Write response messages to: ${msgsDir}`);

  return lines.join('\n');
}

/**
 * Hook handler
 */
const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const startTime = Date.now();
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;

  log.debug('hooks', 'Running status injection', { agentId });

  try {
    // 1. Get worker state from workers.json
    const workersData = readWorkersState(utils.workDir);
    const workers = workersData?.workers || [];

    // 2. Calculate mesh statuses
    const meshes = getMeshStatuses(workers);

    // 3. Get locked agents
    const locked = getLockedAgents(workers);

    // 4. Get pending asks from queue
    const allPendingAsks = utils.queue.getAllPendingAsks();
    const pendingAskCount = allPendingAsks.length;

    // 5. Get queued messages for this agent
    const pendingMessages = utils.queue.peek(agentId);
    const msgsDir = context.msgsDir || path.join(utils.workDir, '.ai', 'tx', 'msgs');

    // Convert to QueuedMessage format with file paths
    const queuedMessages: QueuedMessage[] = pendingMessages.map(msg => ({
      path: msg.payload?.filepath as string || path.join(msgsDir, `${msg.id}.md`),
      type: msg.type,
      from: msg.from_agent,
      to: msg.to_agent,
    }));

    // 6. Build output based on mode
    const activeMode = isActiveMode();
    const output = activeMode
      ? buildActiveOutput(meshes, locked, queuedMessages, msgsDir)
      : buildPassiveOutput(meshes, locked, pendingAskCount, queuedMessages, msgsDir);

    // Store in context for the worker to use
    // The workspace/prompt injector will need to consume this
    context.statusInjection = output;

    const elapsed = Date.now() - startTime;
    log.debug('hooks', 'Status injection complete', {
      agentId,
      mode: activeMode ? 'active' : 'passive',
      meshCount: meshes.length,
      lockedCount: locked.length,
      pendingAskCount,
      messageCount: queuedMessages.length,
      elapsed,
    });

    // Warn if hook is too slow (should be <100ms)
    if (elapsed > 100) {
      log.warn('hooks', 'Status injection exceeded 100ms target', { elapsed });
    }
  } catch (error) {
    // Fail silently - status injection is best-effort
    log.warn('hooks', 'Status injection failed, continuing without state', {
      agentId,
      error: (error as Error).message,
    });
    context.statusInjection = null;
  }
};

/**
 * Status injection hook definition
 */
export const statusInjectionHook: HookDefinition = {
  name: 'status:injection',
  phase: 'pre',
  priority: 10, // Early in pre-hook chain, before quality preflight
  description: 'Injects TX system state into agent context',
  handler,
};

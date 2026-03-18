/**
 * tx mesh-cmd - Dynaprompt runtime commands CLI
 *
 * Commands:
 *   tx mesh-cmd checkpoint save <label> [--snapshot]
 *   tx mesh-cmd checkpoint get <id>
 *   tx mesh-cmd checkpoint list [--mesh MESH] [--agent AGENT]
 *   tx mesh-cmd checkpoint tree <root-id>
 *   tx mesh-cmd progress emit <step> <total> [--label TEXT]
 *   tx mesh-cmd progress show <agent-id>
 */

import path from 'node:path';
import { AgentCheckpointStore, AgentProgressStore } from '../dynaprompt/stores/index.ts';
import { WorkspaceSnapshotter } from '../dynaprompt/workspace-snapshotter.ts';
import { log } from '../shared/logger.ts';
import type { CheckpointNode } from '../dynaprompt/types.ts';

const COMPONENT = 'mesh-cmd';

// Lazy-initialized stores (shared across all commands)
let checkpointStore: AgentCheckpointStore | null = null;
let progressStore: AgentProgressStore | null = null;
let snapshotter: WorkspaceSnapshotter | null = null;

/**
 * Get or initialize checkpoint store
 */
function getCheckpointStore(): AgentCheckpointStore {
  if (!checkpointStore) {
    const dbPath = path.join(process.cwd(), '.ai/tx/queue.db');
    checkpointStore = new AgentCheckpointStore(dbPath);
  }
  return checkpointStore;
}

/**
 * Get or initialize progress store
 */
function getProgressStore(): AgentProgressStore {
  if (!progressStore) {
    const dbPath = path.join(process.cwd(), '.ai/tx/queue.db');
    progressStore = new AgentProgressStore(dbPath);
  }
  return progressStore;
}

/**
 * Get or initialize workspace snapshotter
 */
function getSnapshotter(): WorkspaceSnapshotter {
  if (!snapshotter) {
    const snapshotsDir = path.join(process.cwd(), '.ai/tx/data/checkpoint-snapshots');
    snapshotter = new WorkspaceSnapshotter(snapshotsDir);
  }
  return snapshotter;
}

/**
 * Parse flags from args
 */
function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
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
 * Get required environment variables for agent context
 */
function getAgentContext(): { meshInstance: string; agentId: string; conversationId: string } {
  const meshInstance = process.env.TX_MESH_INSTANCE;
  const agentId = process.env.TX_AGENT_ID;
  const conversationId = process.env.TX_CONVERSATION_ID;

  if (!meshInstance || !agentId || !conversationId) {
    throw new Error(
      'Missing required environment variables. ' +
      'mesh-cmd must be called from within a running mesh agent. ' +
      'Available: TX_MESH_INSTANCE, TX_AGENT_ID, TX_CONVERSATION_ID'
    );
  }

  return { meshInstance, agentId, conversationId };
}

// ============================================
// Checkpoint Handlers
// ============================================

async function checkpointSave(args: string[]): Promise<void> {
  try {
    const flags = parseFlags(args);
    const nonFlags = getNonFlagArgs(args);
    const label = nonFlags[0] || null;
    const enableSnapshot = Boolean(flags.snapshot);

    const { meshInstance, agentId, conversationId } = getAgentContext();
    const store = getCheckpointStore();

    let snapshotPath: string | null = null;

    // Create workspace snapshot if requested
    if (enableSnapshot) {
      const workspacePath = path.join(process.cwd(), '.ai/output', meshInstance);
      if (workspacePath) {
        const snap = getSnapshotter();
        const checkpointId = `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        snapshotPath = await snap.snapshot(workspacePath, checkpointId);
      }
    }

    // Save checkpoint
    const checkpointId = store.save({
      mesh_instance: meshInstance,
      agent_id: agentId,
      conversation_id: conversationId,
      parent_checkpoint_id: null,
      label,
      snapshot_path: snapshotPath,
      summary: null
    });

    console.log(JSON.stringify({
      action: 'checkpoint-saved',
      checkpoint_id: checkpointId,
      label,
      snapshot_created: Boolean(snapshotPath),
      mesh_instance: meshInstance,
      agent_id: agentId
    }, null, 2));

    log.info(COMPONENT, 'Checkpoint saved', { checkpointId, label, agentId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Checkpoint save failed', { error });
    process.exit(1);
  }
}

async function checkpointGet(args: string[]): Promise<void> {
  try {
    const nonFlags = getNonFlagArgs(args);
    const checkpointId = nonFlags[0];

    if (!checkpointId) {
      throw new Error('Missing required argument: checkpoint ID');
    }

    const store = getCheckpointStore();
    const checkpoint = store.get(checkpointId);

    if (!checkpoint) {
      console.log(JSON.stringify({ error: 'Checkpoint not found', checkpoint_id: checkpointId }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify(checkpoint, null, 2));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Checkpoint get failed', { error });
    process.exit(1);
  }
}

async function checkpointList(args: string[]): Promise<void> {
  try {
    const flags = parseFlags(args);
    const store = getCheckpointStore();

    let checkpoints;
    if (flags.mesh) {
      checkpoints = store.listForMesh(flags.mesh as string);
    } else if (flags.agent) {
      checkpoints = store.listForAgent(flags.agent as string);
    } else {
      const { meshInstance } = getAgentContext();
      checkpoints = store.listForMesh(meshInstance);
    }

    console.log(JSON.stringify({ checkpoints }, null, 2));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Checkpoint list failed', { error });
    process.exit(1);
  }
}

async function checkpointTree(args: string[]): Promise<void> {
  try {
    const nonFlags = getNonFlagArgs(args);
    const rootId = nonFlags[0];

    if (!rootId) {
      throw new Error('Missing required argument: root checkpoint ID');
    }

    const store = getCheckpointStore();
    const tree = store.tree(rootId);

    if (!tree) {
      console.log(JSON.stringify({ error: 'Root checkpoint not found', root_id: rootId }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify(renderTree(tree), null, 2));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Checkpoint tree failed', { error });
    process.exit(1);
  }
}

/**
 * Render checkpoint tree as nested structure
 */
function renderTree(node: CheckpointNode, depth: number = 0): any {
  return {
    checkpoint: {
      id: node.checkpoint.id,
      label: node.checkpoint.label,
      created_at: node.checkpoint.created_at,
      has_snapshot: Boolean(node.checkpoint.snapshot_path)
    },
    children: node.children.map(child => renderTree(child, depth + 1))
  };
}

// ============================================
// Progress Handlers
// ============================================

async function progressEmit(args: string[]): Promise<void> {
  try {
    const flags = parseFlags(args);
    const nonFlags = getNonFlagArgs(args);
    const step = parseInt(nonFlags[0], 10);
    const total = parseInt(nonFlags[1], 10);
    const label = flags.label as string || null;

    if (isNaN(step) || isNaN(total)) {
      throw new Error('Invalid step or total: must be integers');
    }

    if (step < 0 || total < 1 || step > total) {
      throw new Error(`Invalid progress: step=${step}, total=${total}. Step must be 0..total.`);
    }

    const { meshInstance, agentId } = getAgentContext();
    const store = getProgressStore();

    store.save({
      mesh_instance: meshInstance,
      agent_id: agentId,
      step,
      total,
      label
    });

    console.log(JSON.stringify({
      action: 'progress-emitted',
      agent_id: agentId,
      step,
      total,
      label
    }, null, 2));

    log.debug(COMPONENT, 'Progress emitted', { agentId, step, total, label });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Progress emit failed', { error });
    process.exit(1);
  }
}

async function progressShow(args: string[]): Promise<void> {
  try {
    const nonFlags = getNonFlagArgs(args);
    let agentId = nonFlags[0];

    // If no agent specified, use current agent from env
    if (!agentId) {
      const context = getAgentContext();
      agentId = context.agentId;
    }

    const store = getProgressStore();
    const latest = store.latest(agentId);

    if (!latest) {
      console.log(JSON.stringify({ error: 'No progress found', agent_id: agentId }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify(latest, null, 2));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Progress show failed', { error });
    process.exit(1);
  }
}

// ============================================
// Main Router
// ============================================

export async function meshCmd(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: tx mesh-cmd <subcommand> [args...]');
    console.error('');
    console.error('Subcommands:');
    console.error('  checkpoint save <label> [--snapshot]');
    console.error('  checkpoint get <id>');
    console.error('  checkpoint list [--mesh MESH] [--agent AGENT]');
    console.error('  checkpoint tree <root-id>');
    console.error('  progress emit <step> <total> [--label TEXT]');
    console.error('  progress show [agent-id]');
    process.exit(1);
  }

  const [subcommand, ...subArgs] = args;

  try {
    switch (subcommand) {
      case 'checkpoint':
        const checkpointAction = subArgs[0];
        const checkpointArgs = subArgs.slice(1);

        switch (checkpointAction) {
          case 'save':
            await checkpointSave(checkpointArgs);
            break;
          case 'get':
            await checkpointGet(checkpointArgs);
            break;
          case 'list':
            await checkpointList(checkpointArgs);
            break;
          case 'tree':
            await checkpointTree(checkpointArgs);
            break;
          default:
            throw new Error(`Unknown checkpoint action: ${checkpointAction}`);
        }
        break;

      case 'progress':
        const progressAction = subArgs[0];
        const progressArgs = subArgs.slice(1);

        switch (progressAction) {
          case 'emit':
            await progressEmit(progressArgs);
            break;
          case 'show':
            await progressShow(progressArgs);
            break;
          default:
            throw new Error(`Unknown progress action: ${progressAction}`);
        }
        break;

      default:
        throw new Error(`Unknown subcommand: ${subcommand}`);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'mesh-cmd failed', { subcommand, error });
    process.exit(1);
  }
}

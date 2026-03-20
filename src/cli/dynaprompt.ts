/**
 * tx dynaprompt - User-facing fragment and exploration CLI
 *
 * Commands:
 *   tx dynaprompt register <mesh> <agent> <name> <file>
 *   tx dynaprompt list <mesh> <agent>
 *   tx dynaprompt inject <mesh> <agent> <fragment-name> [--content TEXT]
 *   tx dynaprompt explore <mesh> <agent> <checkpoint-id> <fragments> [options]
 */

import fs from 'node:fs';
import path from 'node:path';
import { FragmentRegistry } from '../dynaprompt/fragment-registry.ts';
import { AgentCheckpointStore } from '../dynaprompt/stores/index.ts';
import { MeshConfigLoader } from '../mesh/config-loader.ts';
import { GuardrailConfig } from '../worker/guardrail-config.ts';
import { log } from '../shared/logger.ts';
import type { Fragment } from '../dynaprompt/types.ts';

const COMPONENT = 'dynaprompt-cli';

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
 * Load fragment registry for mesh/agent
 */
function loadFragmentRegistry(meshName: string, agentName: string): FragmentRegistry {
  const workDir = process.cwd();
  const meshesDir = path.join(workDir, 'meshes');

  const configLoader = new MeshConfigLoader({ workDir, meshesDir });

  // Load on demand if not already loaded
  configLoader.loadOnDemand(meshName);
  const meshConfig = configLoader.get(meshName);

  if (!meshConfig) {
    throw new Error(`Mesh not found: ${meshName}`);
  }

  const agentConfig = meshConfig.agents.find((a) => a.name === agentName);

  if (!agentConfig) {
    throw new Error(`Agent not found: ${agentName} in mesh ${meshName}`);
  }

  const registry = new FragmentRegistry();

  // Determine fragment directories
  const meshDir = path.join(meshesDir, meshName, 'fragments');
  const agentDir = path.join(meshesDir, meshName, 'agents', agentName, 'fragments');

  registry.load(
    { fragments: meshConfig.fragments },
    { fragments: agentConfig.fragments },
    meshDir,
    agentDir
  );

  return registry;
}

// ============================================
// Command Handlers
// ============================================

async function registerFragment(args: string[]): Promise<void> {
  try {
    const nonFlags = getNonFlagArgs(args);
    const meshName = nonFlags[0];
    const agentName = nonFlags[1];
    const fragmentName = nonFlags[2];
    const filePath = nonFlags[3];

    if (!meshName || !agentName || !fragmentName || !filePath) {
      throw new Error('Usage: tx dynaprompt register <mesh> <agent> <name> <file>');
    }

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Read and validate content
    const content = fs.readFileSync(filePath, 'utf-8');
    const MAX_FRAGMENT_SIZE = 50 * 1024;

    if (content.length > MAX_FRAGMENT_SIZE) {
      throw new Error(
        `Fragment exceeds size limit: ${content.length} bytes (max: ${MAX_FRAGMENT_SIZE} bytes)`
      );
    }

    // Determine destination
    const agentFragmentDir = path.join(process.cwd(), 'meshes', meshName, 'agents', agentName, 'fragments');
    const destination = path.join(agentFragmentDir, `${fragmentName}.md`);

    // Create directory if needed
    if (!fs.existsSync(agentFragmentDir)) {
      fs.mkdirSync(agentFragmentDir, { recursive: true });
    }

    // Copy file
    fs.writeFileSync(destination, content, 'utf-8');

    console.log(JSON.stringify({
      action: 'registered',
      name: fragmentName,
      source: 'agent-dir',
      destination,
      agent_id: `${meshName}/${agentName}`,
      size_bytes: content.length
    }, null, 2));

    log.info(COMPONENT, 'Fragment registered', { meshName, agentName, fragmentName, destination });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Fragment registration failed', { error });
    process.exit(1);
  }
}

async function listFragments(args: string[]): Promise<void> {
  try {
    const nonFlags = getNonFlagArgs(args);
    const meshName = nonFlags[0];
    const agentName = nonFlags[1];

    if (!meshName || !agentName) {
      throw new Error('Usage: tx dynaprompt list <mesh> <agent>');
    }

    const registry = loadFragmentRegistry(meshName, agentName);
    const fragments = registry.list();

    // Format for output
    const output = fragments.map((f: Fragment) => ({
      name: f.name,
      description: f.description,
      source: f.source,
      size_bytes: f.content.length
    }));

    console.log(JSON.stringify({ fragments: output }, null, 2));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Fragment list failed', { error });
    process.exit(1);
  }
}

async function injectFragment(args: string[]): Promise<void> {
  try {
    const flags = parseFlags(args);
    const nonFlags = getNonFlagArgs(args);
    const meshName = nonFlags[0];
    const agentName = nonFlags[1];
    const fragmentName = nonFlags[2];

    if (!meshName || !agentName) {
      throw new Error('Usage: tx dynaprompt inject <mesh> <agent> <fragment-name> [--content TEXT]');
    }

    let content: string;

    // Either use --content flag or resolve fragment name
    if (flags.content) {
      content = flags.content as string;
    } else {
      if (!fragmentName) {
        throw new Error('Must provide fragment name or --content flag');
      }

      const registry = loadFragmentRegistry(meshName, agentName);
      const fragment = registry.resolve(fragmentName);

      if (!fragment) {
        const available = registry.list().map((f: Fragment) => f.name);
        throw new Error(
          `Fragment not found: ${fragmentName}. Available fragments: ${available.join(', ') || '(none)'}`
        );
      }

      content = fragment.content;
    }

    // Generate message file
    const timestamp = Math.floor(Date.now() / 1000);
    const shortId = Date.now().toString(36).slice(-6);
    const msgId = `dynaprompt-inject-${shortId}`;
    const filename = `${timestamp}-system-dynaprompt--${meshName}-${agentName}-${shortId}.md`;
    const msgPath = path.join(process.cwd(), '.ai/tx/msgs', filename);

    // Write message file with frontmatter
    const messageContent = `---
to: ${agentName}
from: system/dynaprompt
msg-id: ${msgId}
type: system-feedback
---

${content}
`;

    fs.writeFileSync(msgPath, messageContent, 'utf-8');

    console.log(JSON.stringify({
      action: 'injected',
      fragment: fragmentName || '(raw content)',
      agent_id: `${meshName}/${agentName}`,
      msg_path: msgPath,
      msg_id: msgId,
      content_length: content.length
    }, null, 2));

    log.info(COMPONENT, 'Fragment injected', { meshName, agentName, fragmentName, msgId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Fragment injection failed', { error });
    process.exit(1);
  }
}

async function exploreFragments(args: string[]): Promise<void> {
  try {
    const flags = parseFlags(args);
    const nonFlags = getNonFlagArgs(args);
    const meshName = nonFlags[0];
    const agentName = nonFlags[1];
    const checkpointId = nonFlags[2];
    const fragmentsArg = nonFlags[3];

    if (!meshName || !agentName || !checkpointId || !fragmentsArg) {
      throw new Error(
        'Usage: tx dynaprompt explore <mesh> <agent> <checkpoint-id> <fragments> [--judge AGENT] [--budget N]'
      );
    }

    // Parse fragments (comma-separated)
    const fragmentNames = fragmentsArg.split(',').map((s) => s.trim());

    if (fragmentNames.length === 0) {
      throw new Error('Must provide at least one fragment name');
    }

    // Validate checkpoint exists
    const dbPath = path.join(process.cwd(), '.ai/tx/queue.db');
    const checkpointStore = new AgentCheckpointStore(dbPath);
    const checkpoint = checkpointStore.get(checkpointId);

    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    if (!checkpoint.conversation_id) {
      throw new Error(`Checkpoint has no conversation_id (cannot branch): ${checkpointId}`);
    }

    // Validate fragments exist
    const registry = loadFragmentRegistry(meshName, agentName);
    const missingFragments: string[] = [];

    for (const name of fragmentNames) {
      if (!registry.has(name)) {
        missingFragments.push(name);
      }
    }

    if (missingFragments.length > 0) {
      const available = registry.list().map((f: Fragment) => f.name);
      throw new Error(
        `Fragments not found: ${missingFragments.join(', ')}. Available: ${available.join(', ') || '(none)'}`
      );
    }

    // Check max_forks guardrail
    const guardrailConfig = new GuardrailConfig(process.cwd());
    const maxForks = guardrailConfig.getMaxForks(meshName, agentName);
    const mode = guardrailConfig.getMode('max_forks', meshName, agentName);

    if (maxForks !== null && fragmentNames.length > maxForks) {
      const error = `Fork limit exceeded: requested ${fragmentNames.length} forks, limit is ${maxForks}`;

      if (mode.strict) {
        // Block the explore operation
        throw new Error(error);
      }

      if (mode.warning) {
        // Log warning but allow operation
        log.warn(COMPONENT, 'max_forks guardrail exceeded (warning mode)', {
          requested: fragmentNames.length,
          limit: maxForks,
          meshName,
          agentName
        });
      }
    }

    // Build explore plan
    const plan = {
      action: 'explore',
      checkpoint_id: checkpointId,
      mesh_instance: checkpoint.mesh_instance,
      agent_id: `${meshName}/${agentName}`,
      fragments: fragmentNames,
      branch_count: fragmentNames.length,
      judge: flags.judge as string || null,
      budget_per_branch: flags.budget ? parseInt(flags.budget as string, 10) : null,
      conversation_id: checkpoint.conversation_id
    };

    console.log(JSON.stringify(plan, null, 2));

    log.info(COMPONENT, 'Explore plan generated', { checkpointId, fragments: fragmentNames, meshName, agentName });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'Explore failed', { error });
    process.exit(1);
  }
}

// ============================================
// Main Router
// ============================================

export async function dynapromptCli(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: tx dynaprompt <subcommand> [args...]');
    console.error('');
    console.error('Subcommands:');
    console.error('  register <mesh> <agent> <name> <file>');
    console.error('  list <mesh> <agent>');
    console.error('  inject <mesh> <agent> <fragment-name> [--content TEXT]');
    console.error('  explore <mesh> <agent> <checkpoint-id> <fragments> [--judge AGENT] [--budget N]');
    process.exit(1);
  }

  const [subcommand, ...subArgs] = args;

  try {
    switch (subcommand) {
      case 'register':
        await registerFragment(subArgs);
        break;
      case 'list':
        await listFragments(subArgs);
        break;
      case 'inject':
        await injectFragment(subArgs);
        break;
      case 'explore':
        await exploreFragments(subArgs);
        break;
      default:
        throw new Error(`Unknown subcommand: ${subcommand}`);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error }, null, 2));
    log.error(COMPONENT, 'dynaprompt command failed', { subcommand, error });
    process.exit(1);
  }
}

/**
 * tx dynaprompt - Dynamic prompt fragment management
 *
 * Responsibilities:
 * - Inject pre-authored or runtime fragments into active sessions
 * - Register agent-authored fragments
 * - List available fragments for an agent
 * - Orchestrate explore pattern (checkpoint + parallel branches + judge)
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FragmentRegistry } from '../prompt/fragment-registry.ts';
import { log } from '../shared/logger.ts';
import Database from 'better-sqlite3';

const HELP = `tx dynaprompt - Dynamic prompt fragment management

Commands:
  inject <mesh> <agent> <fragment>    Inject a fragment into active session
  register <mesh> <agent> <name> <path>  Register a runtime fragment
  list <mesh> <agent>                 List available fragments
  explore <mesh> <agent> [options]    Fork-and-explore with multiple fragments

Inject options:
  --content <text>     Inject raw text instead of named fragment

Explore options:
  --checkpoint <id>    Checkpoint to fork from (required)
  --fragments <a,b,c>  Comma-separated fragment names
  --judge <agent>      Judge agent to evaluate branches
  --budget <n>         Max turns per branch (default: 10)

Output: JSON (for agent parsing)`;

function getMeshBasePath(meshInstance: string): string {
  const cwd = process.env.TX_CWD || process.cwd();
  const meshName = meshInstance.includes('/') ? meshInstance.split('/')[0] : meshInstance;
  return path.join(cwd, 'meshes', meshName);
}

function buildRegistry(meshBasePath: string, agentName: string): FragmentRegistry {
  const registry = new FragmentRegistry();

  // Mesh-level fragments (lower priority)
  registry.loadFromDir(path.join(meshBasePath, 'fragments'));

  // Agent-level fragments (higher priority)
  registry.loadFromDir(path.join(meshBasePath, agentName, 'fragments'));

  return registry;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function getNonFlags(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (args[i + 1] && !args[i + 1].startsWith('--')) i++;
    } else {
      result.push(args[i]);
    }
  }
  return result;
}

export async function dynaprompt(args: string[]): Promise<void> {
  const action = args[0];
  const subArgs = args.slice(1);

  switch (action) {
    case 'inject':
      await injectFragment(subArgs);
      break;

    case 'register':
      registerFragment(subArgs);
      break;

    case 'list':
      listFragments(subArgs);
      break;

    case 'explore':
      await exploreFragments(subArgs);
      break;

    case '-h':
    case '--help':
    case undefined:
      console.log(HELP);
      break;

    default:
      console.error(JSON.stringify({ error: `Unknown dynaprompt action: ${action}` }));
      process.exit(1);
  }
}

async function injectFragment(args: string[]): Promise<void> {
  const nonFlags = getNonFlags(args);
  const flags = parseFlags(args);

  const meshInstance = nonFlags[0];
  const agentId = nonFlags[1];
  const fragmentName = nonFlags[2];

  if (!meshInstance || !agentId) {
    console.error(JSON.stringify({ error: 'Usage: tx dynaprompt inject <mesh> <agent> <fragment>' }));
    process.exit(1);
  }

  let content: string;

  if (flags.content) {
    content = flags.content as string;
  } else if (fragmentName) {
    const meshBasePath = getMeshBasePath(meshInstance);
    const agentName = agentId.includes('/') ? agentId.split('/')[1] : agentId;
    const registry = buildRegistry(meshBasePath, agentName);

    const fragment = registry.get(fragmentName);
    if (!fragment) {
      const available = registry.list();
      console.error(JSON.stringify({
        error: `Fragment not found: ${fragmentName}`,
        available,
      }));
      process.exit(1);
    }
    content = fragment;
  } else {
    console.error(JSON.stringify({ error: 'Provide fragment name or --content' }));
    process.exit(1);
  }

  // Write fragment as a system message to the agent's message directory
  const cwd = process.env.TX_CWD || process.cwd();
  const msgsDir = path.join(cwd, '.ai', 'tx', 'msgs');
  const msgId = `dynaprompt-${Date.now()}`;
  const meshName = meshInstance.includes('/') ? meshInstance.split('/')[0] : meshInstance;
  const agentName = agentId.includes('/') ? agentId.split('/')[1] : agentId;
  const msgPath = path.join(msgsDir, meshName, `${agentName}-dynaprompt-${crypto.randomUUID().slice(0, 8)}.md`);

  // Ensure mesh dir exists
  fs.mkdirSync(path.join(msgsDir, meshName), { recursive: true });

  const msgContent = `---
to: ${meshInstance}/${agentName}
from: system/dynaprompt
type: message
msg-id: ${msgId}
---

# Dynamic Prompt Fragment${fragmentName ? `: ${fragmentName}` : ''}

The following instructions are now active for your session. Incorporate them into your approach.

---

${content}
`;

  fs.writeFileSync(msgPath, msgContent);

  console.log(JSON.stringify({
    action: 'injected',
    fragment: fragmentName || '(inline)',
    agent_id: `${meshInstance}/${agentName}`,
    msg_path: msgPath,
    msg_id: msgId,
  }));
}

function registerFragment(args: string[]): void {
  const nonFlags = getNonFlags(args);
  const meshInstance = nonFlags[0];
  const agentId = nonFlags[1];
  const name = nonFlags[2];
  const filePath = nonFlags[3];

  if (!meshInstance || !agentId || !name || !filePath) {
    console.error(JSON.stringify({
      error: 'Usage: tx dynaprompt register <mesh> <agent> <name> <path>',
    }));
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(JSON.stringify({ error: `File not found: ${filePath}` }));
    process.exit(1);
  }

  // Copy to agent fragments directory
  const meshBasePath = getMeshBasePath(meshInstance);
  const agentName = agentId.includes('/') ? agentId.split('/')[1] : agentId;
  const fragDir = path.join(meshBasePath, agentName, 'fragments');
  fs.mkdirSync(fragDir, { recursive: true });

  const destPath = path.join(fragDir, `${name}.md`);
  fs.copyFileSync(filePath, destPath);

  console.log(JSON.stringify({
    action: 'registered',
    name,
    source: filePath,
    destination: destPath,
    agent_id: `${meshInstance}/${agentName}`,
  }));
}

function listFragments(args: string[]): void {
  const nonFlags = getNonFlags(args);
  const meshInstance = nonFlags[0];
  const agentId = nonFlags[1];

  if (!meshInstance || !agentId) {
    console.error(JSON.stringify({ error: 'Usage: tx dynaprompt list <mesh> <agent>' }));
    process.exit(1);
  }

  const meshBasePath = getMeshBasePath(meshInstance);
  const agentName = agentId.includes('/') ? agentId.split('/')[1] : agentId;
  const registry = buildRegistry(meshBasePath, agentName);

  const fragments = registry.list();
  console.log(JSON.stringify({
    mesh_instance: meshInstance,
    agent_id: `${meshInstance}/${agentName}`,
    fragments,
    count: fragments.length,
  }));
}

async function exploreFragments(args: string[]): Promise<void> {
  const nonFlags = getNonFlags(args);
  const flags = parseFlags(args);

  const meshInstance = nonFlags[0];
  const agentId = nonFlags[1];

  if (!meshInstance || !agentId) {
    console.error(JSON.stringify({
      error: 'Usage: tx dynaprompt explore <mesh> <agent> --checkpoint <id> --fragments <a,b,c> --judge <agent>',
    }));
    process.exit(1);
  }

  const checkpointId = flags.checkpoint as string;
  const fragmentList = flags.fragments as string;
  const judgeAgent = flags.judge as string;
  const budget = parseInt(flags.budget as string || '10', 10);

  if (!checkpointId || !fragmentList) {
    console.error(JSON.stringify({
      error: '--checkpoint and --fragments are required for explore',
    }));
    process.exit(1);
  }

  const fragmentNames = fragmentList.split(',').map(f => f.trim());

  // Validate fragments exist
  const meshBasePath = getMeshBasePath(meshInstance);
  const agentName = agentId.includes('/') ? agentId.split('/')[1] : agentId;
  const registry = buildRegistry(meshBasePath, agentName);

  const missing = fragmentNames.filter(f => !registry.has(f));
  if (missing.length > 0) {
    console.error(JSON.stringify({
      error: `Fragments not found: ${missing.join(', ')}`,
      available: registry.list(),
    }));
    process.exit(1);
  }

  // Look up checkpoint to get replay cost estimate
  const cwd = process.env.TX_CWD || process.cwd();
  const cpDbPath = path.join(cwd, '.ai', 'tx', 'queue.db');
  let replayWarning: string | null = null;
  let replayTokenEstimate: number | null = null;

  if (fs.existsSync(cpDbPath)) {
    const cpDb = new Database(cpDbPath);
    const { AgentCheckpointStore } = await import('../checkpoint/index.ts');
    const cpStore = new AgentCheckpointStore(cpDb);
    const cp = cpStore.get(checkpointId);
    cpDb.close();

    if (cp?.replay_token_estimate) {
      replayTokenEstimate = cp.replay_token_estimate;
      const totalReplayCost = cp.replay_token_estimate * fragmentNames.length;
      if (totalReplayCost > 100000) {
        replayWarning = `High replay cost: ~${totalReplayCost.toLocaleString()} input tokens across ${fragmentNames.length} branches (${cp.replay_token_estimate.toLocaleString()} per branch). Consider checkpointing earlier in the session.`;
      }
    }

    if (cp?.session_file_path && !fs.existsSync(cp.session_file_path)) {
      console.error(JSON.stringify({
        error: `Session file missing for checkpoint ${checkpointId}`,
        session_file_path: cp.session_file_path,
        hint: 'Cannot fork — the JSONL session history has been deleted.',
      }));
      process.exit(1);
    }
  }

  // Output explore plan — dispatcher reads this to orchestrate
  // The actual forking is done by the dispatcher, not the CLI
  console.log(JSON.stringify({
    action: 'explore',
    checkpoint_id: checkpointId,
    mesh_instance: meshInstance,
    agent_id: `${meshInstance}/${agentName}`,
    fragments: fragmentNames,
    branch_count: fragmentNames.length,
    judge: judgeAgent || null,
    budget_per_branch: budget,
    replay_token_estimate: replayTokenEstimate,
    replay_warning: replayWarning,
    instructions: 'Write this JSON to a message file for the dispatcher to process',
  }));
}

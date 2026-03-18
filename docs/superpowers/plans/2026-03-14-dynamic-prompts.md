# Dynamic Prompt Fragments (dynaprompt) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable agents to inject prompt fragments mid-session and author new fragments at runtime, with a fork-and-explore pattern combining checkpoints + parallel branch execution + dedicated judge evaluation.

**Architecture:** Prompt fragments are markdown files in a `fragments/` directory within each agent's mesh config path. Agents activate fragments via `tx mesh-cmd dynaprompt inject`, which writes a system message into the agent's active session. For runtime-authored fragments, agents write files to workspace and register them via `tx mesh-cmd dynaprompt register`. The explore pattern (`tx mesh-cmd dynaprompt explore`) saves a checkpoint, spawns N parallel branches with different fragments, and routes outputs to a judge agent.

**Tech Stack:** TypeScript, existing PromptInjector + SdkRunner session injection, existing parallelism infrastructure (fork_from, parallelBlocks), existing AgentCheckpointStore (from checkpoint plan).

**Depends on:** `2026-03-14-agent-checkpoints.md` (AgentCheckpointStore, `tx mesh-cmd` router)

### SDK Fork Reality: Replay Cost

The explore pattern forks N branches from a checkpoint. Each branch **replays the full conversation history** up to that checkpoint (the SDK doesn't support true server-side forking). This means:

- **Cost scales with depth**: 3 branches from a 5-turn checkpoint replays 15 turns of input. 3 branches from a 50-turn checkpoint replays 150 turns.
- **The explore command should warn** when `replay_token_estimate * branch_count` exceeds a threshold.
- **Bias toward early checkpoints**: The earlier in the session you checkpoint, the cheaper branching is.
- **Budget enforcement matters**: `budgetPerBranch` limits new work per branch, but replay tokens are unavoidable overhead.

---

## Chunk 1: Fragment Registry + Catalog

### Task 1: FragmentRegistry — Load and resolve fragments

**Files:**
- Create: `src/prompt/fragment-registry.ts`
- Test: `test/unit/fragment-registry.test.ts`

Fragments are markdown files. The registry loads them from config-defined paths and makes them available by name.

Fragment resolution order:
1. Agent-level: `meshes/<mesh>/<agent>/fragments/<name>.md`
2. Mesh-level: `meshes/<mesh>/fragments/<name>.md`
3. Runtime-registered: workspace or arbitrary path (agent-authored)

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/fragment-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FragmentRegistry } from '../../src/prompt/fragment-registry.ts';

describe('FragmentRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frag-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads fragments from agent directory', () => {
    const fragDir = path.join(tmpDir, 'fragments');
    fs.mkdirSync(fragDir);
    fs.writeFileSync(path.join(fragDir, 'deep-dive.md'), '# Deep Dive\nAnalyze in detail.');
    fs.writeFileSync(path.join(fragDir, 'contrarian.md'), '# Contrarian\nChallenge assumptions.');

    const registry = new FragmentRegistry();
    registry.loadFromDir(fragDir);

    expect(registry.list()).toEqual(['contrarian', 'deep-dive']);
    expect(registry.get('deep-dive')).toContain('Analyze in detail');
  });

  it('returns null for unknown fragment', () => {
    const registry = new FragmentRegistry();
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('registers runtime fragments', () => {
    const registry = new FragmentRegistry();
    registry.register('custom', '# Custom\nAgent-authored fragment.');

    expect(registry.get('custom')).toContain('Agent-authored');
    expect(registry.list()).toContain('custom');
  });

  it('loads from multiple directories with priority', () => {
    const meshFrags = path.join(tmpDir, 'mesh-frags');
    const agentFrags = path.join(tmpDir, 'agent-frags');
    fs.mkdirSync(meshFrags);
    fs.mkdirSync(agentFrags);
    fs.writeFileSync(path.join(meshFrags, 'shared.md'), 'mesh version');
    fs.writeFileSync(path.join(agentFrags, 'shared.md'), 'agent version');

    const registry = new FragmentRegistry();
    registry.loadFromDir(meshFrags);    // lower priority
    registry.loadFromDir(agentFrags);   // higher priority (loaded second, overwrites)

    expect(registry.get('shared')).toBe('agent version');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run test/unit/fragment-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FragmentRegistry**

```typescript
// src/prompt/fragment-registry.ts
/**
 * FragmentRegistry - Manages prompt fragment catalog for agents
 *
 * Responsibilities:
 * - Load fragment markdown files from disk (mesh/agent directories)
 * - Register runtime-authored fragments
 * - Resolve fragments by name with priority ordering
 * - List available fragment names for catalog injection
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';

export class FragmentRegistry {
  private fragments: Map<string, string> = new Map();

  /**
   * Load all .md files from a directory as fragments.
   * Fragment name = filename without extension.
   * Later loads overwrite earlier ones (for priority ordering).
   */
  loadFromDir(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    for (const file of files) {
      const name = path.basename(file, '.md');
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      this.fragments.set(name, content);
    }

    log.debug('fragment-registry', 'Loaded fragments', { dir, count: files.length });
  }

  /**
   * Register a runtime fragment (agent-authored).
   */
  register(name: string, content: string): void {
    this.fragments.set(name, content);
    log.debug('fragment-registry', 'Registered runtime fragment', { name });
  }

  /**
   * Get fragment content by name. Returns null if not found.
   */
  get(name: string): string | null {
    return this.fragments.get(name) ?? null;
  }

  /**
   * List all available fragment names (sorted).
   */
  list(): string[] {
    return Array.from(this.fragments.keys()).sort();
  }

  /**
   * Check if a fragment exists.
   */
  has(name: string): boolean {
    return this.fragments.has(name);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/fragment-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/prompt/fragment-registry.ts test/unit/fragment-registry.test.ts
git commit -m "feat(dynaprompt): add FragmentRegistry for prompt fragment catalog"
```

---

### Task 2: Config support — `fragments` field on agents

**Files:**
- Modify: `src/mesh/config-loader.ts` (AgentConfig interface + normalization)
- Test: existing mesh config tests

- [ ] **Step 1: Add `fragments` field to AgentConfig**

In `src/mesh/config-loader.ts`, add to `AgentConfig` interface:

```typescript
fragments?: Record<string, string> | string;  // Fragment map { name: path } or directory path
```

- [ ] **Step 2: Add normalization in config loading**

In the agent normalization section, resolve fragment paths relative to mesh basePath:

```typescript
// Normalize fragments to absolute paths
if (typeof agent.fragments === 'string') {
  // Directory path — resolved relative to mesh base
  agent.fragments = path.resolve(basePath, agent.fragments);
} else if (agent.fragments && typeof agent.fragments === 'object') {
  // Map of name → path — resolve each
  const resolved: Record<string, string> = {};
  for (const [name, fragPath] of Object.entries(agent.fragments)) {
    resolved[name] = path.resolve(basePath, fragPath);
  }
  agent.fragments = resolved;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/mesh/config-loader.ts
git commit -m "feat(config): add fragments field to AgentConfig"
```

---

### Task 3: Inject fragment catalog into agent prompt

**Files:**
- Modify: `src/workspace/injector.ts`

When an agent has fragments configured, inject a catalog section into their system prompt telling them what fragments are available and how to activate them.

- [ ] **Step 1: Add injectFragmentCatalog method to PromptInjector**

```typescript
/**
 * Inject available fragment catalog into agent prompt.
 * Tells agent what fragments exist and how to activate them.
 */
injectFragmentCatalog(basePrompt: string, fragmentNames: string[], meshInstance: string, agentId: string): string {
  if (fragmentNames.length === 0) return basePrompt;

  const catalog = fragmentNames.map(n => `  - \`${n}\``).join('\n');

  const section = `
# Available Prompt Fragments

You have access to specialized prompt fragments that can reshape your approach mid-session.
To activate a fragment, run:

\`\`\`bash
tx mesh-cmd dynaprompt inject ${meshInstance} ${agentId} <fragment-name>
\`\`\`

Available fragments:
${catalog}

Use fragments when you encounter a problem that would benefit from a different analytical lens.
Fragment activation injects additional instructions into your session context.`;

  return `${basePrompt}\n${section}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workspace/injector.ts
git commit -m "feat(dynaprompt): inject fragment catalog into agent prompts"
```

---

## Chunk 2: CLI Commands — `tx mesh-cmd dynaprompt`

### Task 4: dynaprompt inject command

**Files:**
- Create: `src/cli/mesh-cmd/dynaprompt.ts`
- Modify: `src/cli/mesh-cmd.ts` (add routing)

The inject command loads a fragment and writes it as a message file that the system injects into the agent's active session. This uses the existing message-based injection mechanism (writing to `.ai/tx/msgs/`).

- [ ] **Step 1: Implement dynaprompt CLI handler**

```typescript
// src/cli/mesh-cmd/dynaprompt.ts
/**
 * tx mesh-cmd dynaprompt - Dynamic prompt fragment management
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
import { FragmentRegistry } from '../../prompt/fragment-registry.ts';
import { chalk } from '../../shared/colors.ts';
import { log } from '../../shared/logger.ts';

const HELP = `tx mesh-cmd dynaprompt - Dynamic prompt fragment management

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
    console.error(JSON.stringify({ error: 'Usage: tx mesh-cmd dynaprompt inject <mesh> <agent> <fragment>' }));
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
      error: 'Usage: tx mesh-cmd dynaprompt register <mesh> <agent> <name> <path>',
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
    console.error(JSON.stringify({ error: 'Usage: tx mesh-cmd dynaprompt list <mesh> <agent>' }));
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
      error: 'Usage: tx mesh-cmd dynaprompt explore <mesh> <agent> --checkpoint <id> --fragments <a,b,c> --judge <agent>',
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
  const cpDbPath = path.join(cwd, '.ai', 'tx', 'queue.db');
  let replayWarning: string | null = null;
  let replayTokenEstimate: number | null = null;

  if (fs.existsSync(cpDbPath)) {
    const Database = (await import('better-sqlite3')).default;
    const cpDb = new Database(cpDbPath);
    const { AgentCheckpointStore } = await import('../../checkpoint/index.ts');
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
```

- [ ] **Step 2: Add dynaprompt routing to mesh-cmd.ts**

In `src/cli/mesh-cmd.ts`, add import:
```typescript
import { dynaprompt } from './mesh-cmd/dynaprompt.ts';
```

Add case:
```typescript
case 'dynaprompt':
  await dynaprompt(subArgs);
  break;
```

Update HELP text to include dynaprompt subcommands.

- [ ] **Step 3: Commit**

```bash
git add src/cli/mesh-cmd/dynaprompt.ts src/cli/mesh-cmd.ts
git commit -m "feat(cli): add tx mesh-cmd dynaprompt inject/register/list/explore"
```

---

## Chunk 3: Prompt Injection into Active Sessions

### Task 5: Wire fragment injection to session resume

**Files:**
- Modify: `src/worker/dispatcher.ts`

When a `system/dynaprompt` message arrives via the consumer, the dispatcher needs to treat it as a session resume event (similar to system-feedback). The fragment content becomes the resume prompt.

- [ ] **Step 1: Add dynaprompt message handler in dispatcher**

The consumer already watches `.ai/tx/msgs/` and emits `worker-message` for non-core messages. The dynaprompt message (`from: system/dynaprompt`) will arrive as a `worker-message` event. The dispatcher should:

1. Recognize the `system/dynaprompt` source
2. Find the active worker for the target agent
3. Inject the fragment content as a session resume with reason `'system-feedback'`

In the dispatcher's message handler (where it processes incoming tasks), add a check:

```typescript
// In the worker-message handler, before spawning:
if (event.from === 'system/dynaprompt') {
  // Dynamic prompt injection — resume active session with fragment content
  const activeWorker = this.workerLifecycle.getWorker(event.agentId);
  if (activeWorker?.runner && activeWorker.sessionId) {
    const message = this.queue.get(event.id);
    if (message) {
      await this.resumeSession({
        reason: 'system-feedback',
        agentId: event.agentId,
        sessionId: activeWorker.sessionId,
        prompt: message.payload.body || '',
        runner: activeWorker.runner,
        metadata: { source: 'dynaprompt', fragment: message.payload.headline },
      });
      this.queue.markDelivered(event.id);
    }
  } else {
    log.warn('dispatcher', 'Dynaprompt received but no active session', { agentId: event.agentId });
  }
  return;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/dispatcher.ts
git commit -m "feat(dispatcher): handle dynaprompt messages as session resume"
```

---

### Task 6: Fragment injection for queued agents (not yet active)

**Files:**
- Modify: `src/workspace/injector.ts`

When a dynaprompt message is queued for an agent that hasn't started yet, the fragment should be included in the agent's initial system prompt. The injector already has `injectSituationalContext` — extend it to include pending dynaprompt messages.

- [ ] **Step 1: Add pending fragment injection**

In the `injectSituationalContext` method, check for undelivered `system/dynaprompt` messages targeting this agent and include their content in the situational context section.

```typescript
// Inside injectSituationalContext, after existing pending checks:
// Check for pending dynaprompt fragments
const pendingFragments = queue.getByAgent(agentId)
  .filter(m => m.from_agent === 'system/dynaprompt' && m.status === 'pending');

if (pendingFragments.length > 0) {
  parts.push('\n## Active Prompt Fragments\n');
  parts.push('The following dynamic prompt fragments have been activated for this session:\n');
  for (const frag of pendingFragments) {
    parts.push(`---\n${frag.payload.body || ''}\n---\n`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workspace/injector.ts
git commit -m "feat(injector): include pending dynaprompt fragments in initial prompt"
```

---

## Chunk 4: Explore Pattern — Fork-and-Judge

### Task 7: Explore orchestrator

**Files:**
- Create: `src/worker/explore-orchestrator.ts`
- Test: `test/unit/explore-orchestrator.test.ts`

The explore orchestrator manages the fork-and-judge lifecycle:
1. Read checkpoint data from AgentCheckpointStore
2. For each fragment, spawn a branch worker with:
   - `resumeSessionAt` = checkpoint's message_uuid
   - `forkSession` = true
   - Fragment content injected as initial resume prompt
3. Track branch completions
4. When all branches complete, send outputs to judge agent

This follows the existing `parallelBlocks` pattern in the dispatcher.

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/explore-orchestrator.test.ts
import { describe, it, expect } from 'vitest';
import { ExploreOrchestrator, type ExplorePlan } from '../../src/worker/explore-orchestrator.ts';

describe('ExploreOrchestrator', () => {
  it('creates branch plan from explore request', () => {
    const plan: ExplorePlan = {
      checkpointId: 'cp-123',
      meshInstance: 'research',
      agentId: 'research/analyst',
      sessionId: 'sess-abc',
      messageUuid: 'msg-uuid-456',
      fragments: [
        { name: 'analytical', content: '# Analytical\nUse data.' },
        { name: 'creative', content: '# Creative\nThink laterally.' },
        { name: 'adversarial', content: '# Adversarial\nFind flaws.' },
      ],
      judge: 'research/evaluator',
      budgetPerBranch: 10,
    };

    const orchestrator = new ExploreOrchestrator();
    const branches = orchestrator.planBranches(plan);

    expect(branches).toHaveLength(3);
    expect(branches[0].fragmentName).toBe('analytical');
    expect(branches[0].resumeSessionAt).toBe('msg-uuid-456');
    expect(branches[0].forkSession).toBe(true);
    expect(branches[0].branchId).toBeDefined();
  });

  it('builds judge prompt from branch outputs', () => {
    const orchestrator = new ExploreOrchestrator();
    const judgePrompt = orchestrator.buildJudgePrompt(
      'cp-123',
      [
        { branchId: 'b1', fragmentName: 'analytical', output: 'Result A' },
        { branchId: 'b2', fragmentName: 'creative', output: 'Result B' },
      ],
    );

    expect(judgePrompt).toContain('analytical');
    expect(judgePrompt).toContain('Result A');
    expect(judgePrompt).toContain('creative');
    expect(judgePrompt).toContain('Result B');
    expect(judgePrompt).toContain('evaluate');
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement ExploreOrchestrator**

```typescript
// src/worker/explore-orchestrator.ts
/**
 * ExploreOrchestrator - Fork-and-judge lifecycle for dynamic prompt exploration
 *
 * Responsibilities:
 * - Generate branch plans from explore requests
 * - Track branch completions
 * - Build judge prompts from branch outputs
 * - Coordinate with dispatcher for branch spawning
 */

import crypto from 'node:crypto';
import { log } from '../shared/logger.ts';

export interface ExplorePlan {
  checkpointId: string;
  meshInstance: string;
  agentId: string;
  sessionId: string;
  messageUuid?: string;
  fragments: Array<{ name: string; content: string }>;
  judge?: string;
  budgetPerBranch: number;
}

export interface BranchPlan {
  branchId: string;
  fragmentName: string;
  fragmentContent: string;
  resumeSessionAt?: string;
  forkSession: boolean;
  sessionId: string;
  maxTurns: number;
}

export interface BranchOutput {
  branchId: string;
  fragmentName: string;
  output: string;
}

export class ExploreOrchestrator {
  private activeExplorations: Map<string, {
    plan: ExplorePlan;
    branches: Map<string, BranchOutput | null>; // branchId → output (null = pending)
  }> = new Map();

  planBranches(plan: ExplorePlan): BranchPlan[] {
    const explorationId = crypto.randomUUID().slice(0, 8);
    const branches: BranchPlan[] = [];

    const branchMap = new Map<string, BranchOutput | null>();

    for (const fragment of plan.fragments) {
      const branchId = `${explorationId}-${fragment.name}`;
      branchMap.set(branchId, null);

      branches.push({
        branchId,
        fragmentName: fragment.name,
        fragmentContent: fragment.content,
        resumeSessionAt: plan.messageUuid,
        forkSession: true,
        sessionId: plan.sessionId,
        maxTurns: plan.budgetPerBranch,
      });
    }

    this.activeExplorations.set(explorationId, { plan, branches: branchMap });

    log.info('explore', 'Planned branches', {
      explorationId,
      branches: branches.length,
      fragments: plan.fragments.map(f => f.name),
    });

    return branches;
  }

  recordBranchOutput(branchId: string, output: string): {
    explorationId: string;
    allComplete: boolean;
  } | null {
    for (const [explorationId, exploration] of this.activeExplorations) {
      if (exploration.branches.has(branchId)) {
        const fragmentName = branchId.split('-').slice(1).join('-');
        exploration.branches.set(branchId, { branchId, fragmentName, output });

        const allComplete = Array.from(exploration.branches.values()).every(b => b !== null);

        log.debug('explore', 'Branch completed', {
          explorationId, branchId, allComplete,
        });

        return { explorationId, allComplete };
      }
    }
    return null;
  }

  getExploration(explorationId: string): { plan: ExplorePlan; outputs: BranchOutput[] } | null {
    const exploration = this.activeExplorations.get(explorationId);
    if (!exploration) return null;

    const outputs = Array.from(exploration.branches.values())
      .filter((b): b is BranchOutput => b !== null);

    return { plan: exploration.plan, outputs };
  }

  buildJudgePrompt(checkpointId: string, outputs: BranchOutput[]): string {
    const branchSections = outputs.map((o, i) => (
      `## Branch ${i + 1}: ${o.fragmentName}\n\n${o.output}`
    )).join('\n\n---\n\n');

    return `# Explore Evaluation

You are evaluating ${outputs.length} parallel branches that explored the same problem from checkpoint \`${checkpointId}\` using different approaches.

Your task: evaluate each branch's output and select the best approach. Explain your reasoning.

${branchSections}

---

## Your Evaluation

For each branch, assess:
1. **Quality** of the output
2. **Completeness** of the approach
3. **Correctness** of reasoning

Then select the best branch and explain why.

Format your response as:
\`\`\`
SELECTED: <branch-number>
REASON: <explanation>
\`\`\``;
  }

  cleanup(explorationId: string): void {
    this.activeExplorations.delete(explorationId);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/explore-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/worker/explore-orchestrator.ts test/unit/explore-orchestrator.test.ts
git commit -m "feat(dynaprompt): add ExploreOrchestrator for fork-and-judge lifecycle"
```

---

## Chunk 5: Integration + Documentation

### Task 8: Wire ExploreOrchestrator into Dispatcher

**Files:**
- Modify: `src/worker/dispatcher.ts`

- [ ] **Step 1: Add ExploreOrchestrator instance**

```typescript
import { ExploreOrchestrator } from './explore-orchestrator.ts';
```

Add field:
```typescript
private exploreOrchestrator: ExploreOrchestrator;
```

Initialize in constructor:
```typescript
this.exploreOrchestrator = new ExploreOrchestrator();
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/dispatcher.ts
git commit -m "feat(dispatcher): wire ExploreOrchestrator"
```

---

### Task 9: Documentation and skill updates

**Files:**
- Modify: `CLAUDE.md` (tx-core)
- Modify: `src/cli/agent-help.ts`
- Modify: `.claude/skills/mesh-builder/SKILL.md`

- [ ] **Step 1: Add dynaprompt to CLAUDE.md**

Add mesh-cmd dynaprompt docs and fragment config pattern.

- [ ] **Step 2: Add agent-help topic for dynaprompt**

```typescript
dynaprompt: `## Dynamic Prompt Fragments

Inject prompt fragments mid-session to change analytical approach.

### List available fragments
\`\`\`bash
tx mesh-cmd dynaprompt list <mesh> <agent>
\`\`\`

### Inject a fragment
\`\`\`bash
tx mesh-cmd dynaprompt inject <mesh> <agent> <fragment-name>
\`\`\`

### Inject custom content
\`\`\`bash
tx mesh-cmd dynaprompt inject <mesh> <agent> --content "Focus on security implications"
\`\`\`

### Register agent-authored fragment
\`\`\`bash
tx mesh-cmd dynaprompt register <mesh> <agent> <name> <path>
\`\`\`

### Fork-and-explore
\`\`\`bash
tx mesh-cmd dynaprompt explore <mesh> <agent> \\
  --checkpoint <checkpoint-id> \\
  --fragments analytical,creative,adversarial \\
  --judge evaluator
\`\`\`

Output is JSON. Use jq for parsing.
`,
```

- [ ] **Step 3: Update mesh-builder skill**

Add fragments config documentation and dynaprompt CLI reference.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md src/cli/agent-help.ts .claude/skills/mesh-builder/SKILL.md
git commit -m "docs: add dynaprompt to CLI docs, agent-help, mesh-builder skill"
```

---

### Task 10: E2E test for dynaprompt inject + list

**Files:**
- Create: `test/e2e/38-dynaprompt-infra.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
// test/e2e/38-dynaprompt-infra.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

describe('tx mesh-cmd dynaprompt (e2e)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-dp-e2e-'));
    // Create mesh structure with fragments
    fs.mkdirSync(path.join(tmpDir, '.ai', 'tx', 'msgs'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'meshes', 'test-mesh', 'analyst', 'fragments'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'meshes', 'test-mesh', 'analyst', 'fragments', 'deep-dive.md'),
      '# Deep Dive\nAnalyze in exhaustive detail.',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'meshes', 'test-mesh', 'analyst', 'fragments', 'contrarian.md'),
      '# Contrarian\nChallenge every assumption.',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCmd(cmd: string): string {
    return execSync(cmd, {
      cwd: tmpDir,
      env: { ...process.env, TX_CWD: tmpDir },
      encoding: 'utf-8',
    }).trim();
  }

  it('lists available fragments', () => {
    const output = JSON.parse(runCmd(
      `npx tsx src/cli/index.ts mesh-cmd dynaprompt list test-mesh test-mesh/analyst`
    ));

    expect(output.fragments).toContain('deep-dive');
    expect(output.fragments).toContain('contrarian');
    expect(output.count).toBe(2);
  });

  it('injects a fragment as a message file', () => {
    const output = JSON.parse(runCmd(
      `npx tsx src/cli/index.ts mesh-cmd dynaprompt inject test-mesh test-mesh/analyst deep-dive`
    ));

    expect(output.action).toBe('injected');
    expect(output.fragment).toBe('deep-dive');
    expect(fs.existsSync(output.msg_path)).toBe(true);

    const msgContent = fs.readFileSync(output.msg_path, 'utf-8');
    expect(msgContent).toContain('to: test-mesh/analyst');
    expect(msgContent).toContain('from: system/dynaprompt');
    expect(msgContent).toContain('Analyze in exhaustive detail');
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run test/e2e/38-dynaprompt-infra.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/e2e/38-dynaprompt-infra.test.ts
git commit -m "test(e2e): add dynaprompt infrastructure tests"
```

---

## Summary: File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/prompt/fragment-registry.ts` | Fragment catalog: load, resolve, register |
| Create | `src/cli/mesh-cmd/dynaprompt.ts` | Dynaprompt CLI handler |
| Create | `src/worker/explore-orchestrator.ts` | Fork-and-judge lifecycle |
| Modify | `src/cli/mesh-cmd.ts` | Add dynaprompt routing |
| Modify | `src/mesh/config-loader.ts` | Add `fragments` to AgentConfig |
| Modify | `src/workspace/injector.ts` | Fragment catalog + pending fragment injection |
| Modify | `src/worker/dispatcher.ts` | Handle dynaprompt messages + explore orchestration |
| Modify | `CLAUDE.md` | Document dynaprompt |
| Modify | `src/cli/agent-help.ts` | Add dynaprompt reference |
| Modify | `.claude/skills/mesh-builder/SKILL.md` | Document fragment pattern |
| Create | `test/unit/fragment-registry.test.ts` | Unit tests |
| Create | `test/unit/explore-orchestrator.test.ts` | Unit tests |
| Create | `test/e2e/38-dynaprompt-infra.test.ts` | E2E infrastructure test |

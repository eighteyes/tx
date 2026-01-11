/**
 * tx start - Start core agent with Claude in tmux
 */

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import YAML from 'yaml';
import { TmuxSession, findClaudePath, injectFile, getSessionName, waitForUserIdle } from '../core/tmux.ts';
import { MessageQueue, StaleMessageCleaner, DeadlockDetector } from '../queue/index.ts';
import { MessageConsumer } from '../core/consumer.ts';
import { WorkerDispatcher } from '../worker/index.ts';
import { log } from '../shared/logger.ts';

export interface StartOptions {
  continue?: boolean;
  model?: string;  // claude model: opus, sonnet, haiku
  low?: boolean;   // low cost mode (opus -> sonnet)
}

export async function start(workDir?: string, options?: StartOptions): Promise<void> {
  // Work directory: where .ai/tx/ lives (default: current directory)
  const cwd = workDir || process.env.TX_CWD || process.cwd();

  // TX installation: where meshes/ lives (default: same as work directory)
  const txRoot = process.env.TX_ROOT || cwd;

  const aiDir = path.join(cwd, '.ai', 'tx');

  // Debug: Show resolved paths
  console.log(`[debug] cwd (work): ${cwd}`);
  console.log(`[debug] txRoot (meshes): ${txRoot}`);

  // Ensure directories exist
  const msgsDir = path.join(aiDir, 'msgs');
  const dataDir = path.join(aiDir, 'data');
  const logsDir = path.join(aiDir, 'logs');

  try {
    for (const dir of [msgsDir, dataDir, logsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  } catch (err: any) {
    if (err.code === 'EACCES') {
      console.error(`\n❌ Permission denied: Cannot create directories in ${cwd}`);
      console.error(`\nFix with one of:`);
      console.error(`  sudo chown -R $(whoami) ${cwd}`);
      console.error(`  chmod -R u+w ${cwd}`);
      console.error(`  cd to a directory you have write access to\n`);
      process.exit(1);
    }
    throw err;
  }

  // Optional checks for know CLI - warn but allow continue
  const knowWarnings: string[] = [];

  // Check 1: know CLI in PATH
  const knowInPath = process.env.PATH?.split(':').some(p => {
    try { return fs.existsSync(path.join(p, 'know')); } catch { return false; }
  });
  if (!knowInPath) {
    knowWarnings.push(`know CLI not in PATH (install: npm install -g know-cli)`);
  }

  // Check 2: .claude/commands/know/ exists
  const knowCommandsDir = path.join(cwd, '.claude', 'commands', 'know');
  if (!fs.existsSync(knowCommandsDir)) {
    knowWarnings.push(`/know:* commands not found (.claude/commands/know/)`);
  }

  // If warnings, prompt user to continue or abort
  if (knowWarnings.length > 0) {
    console.warn(`\n⚠️  Know integration not configured:`);
    for (const warn of knowWarnings) {
      console.warn(`   • ${warn}`);
    }
    console.warn(`\nBrain mesh and /know:* workflows will not work.`);
    console.warn(`Other meshes (dev, test, research) will work fine.\n`);

    const continueStart = await promptYesNo('Continue without know? (y/n): ');
    if (!continueStart) {
      console.log('\nTo set up know:');
      console.log(`  1. Install CLI:  npm install -g know-cli`);
      console.log(`  2. Init project: know init`);
      console.log(`  Or copy commands: cp -r ${txRoot}/.claude/commands/know ${cwd}/.claude/commands/\n`);
      process.exit(0);
    }
    console.log('');  // Blank line before continuing
  }

  // Backup previous logs before starting fresh session
  const mainLog = path.join(logsDir, 'v4.jsonl');
  const activityLog = path.join(logsDir, 'activity.jsonl');
  const lastMainLog = path.join(logsDir, 'v4.last.jsonl');
  const lastActivityLog = path.join(logsDir, 'activity.last.jsonl');

  // Backup logs if they exist and have content (try-catch handles missing files)
  try {
    if (fs.statSync(mainLog).size > 0) {
      fs.copyFileSync(mainLog, lastMainLog);
      fs.writeFileSync(mainLog, '');
      console.log(`[logs] Backed up v4.jsonl → v4.last.jsonl`);
    }
  } catch { /* File doesn't exist, nothing to back up */ }

  try {
    if (fs.statSync(activityLog).size > 0) {
      fs.copyFileSync(activityLog, lastActivityLog);
      fs.writeFileSync(activityLog, '');
      console.log(`[logs] Backed up activity.jsonl → activity.last.jsonl`);
    }
  } catch { /* File doesn't exist, nothing to back up */ }

  // Initialize logger (file-based to avoid polluting tmux session)
  log.init(cwd, 'debug');
  log.info('start', 'Starting TX V4', { cwd, aiDir });

  console.log('\n🚀 Starting TX V4...\n');

  // Create tmux session with unique name per directory
  const sessionName = getSessionName(cwd);
  const tmux = new TmuxSession(sessionName);

  if (await tmux.exists()) {
    console.log(`[tmux] Killing existing session: ${sessionName}`);
    await tmux.kill();
  }

  console.log(`[tmux] Creating session: ${sessionName}`);
  await tmux.create(cwd);
  await new Promise(resolve => setTimeout(resolve, 500));

  // Load tmux config if it exists (check work dir first, then TX_ROOT)
  let tmuxConf = path.join(cwd, '.tmux.conf');
  if (!fs.existsSync(tmuxConf)) {
    tmuxConf = path.join(txRoot, '.tmux.conf');
  }

  if (fs.existsSync(tmuxConf)) {
    console.log(`[tmux] Loading config: ${tmuxConf}`);
    tmux.send(`tmux source-file '${tmuxConf}'`);
    tmux.sendEnter();
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Write core prompt to file
  const corePromptPath = path.join(aiDir, 'core-prompt.md');
  const meshesDir = path.join(txRoot, 'meshes');
  const corePrompt = getCorePrompt(msgsDir, meshesDir);
  fs.writeFileSync(corePromptPath, corePrompt);

  // Start services first (they run on event loop while attached)
  console.log('[core] Starting services...');
  const dbPath = path.join(dataDir, 'queue.db');
  const queue = new MessageQueue(dbPath);

  const staleCount = queue.markPendingAsFailed();
  if (staleCount > 0) {
    log.info('start', `Marked ${staleCount} stale pending messages as failed`);
  }
  queue.clearAllSessions();

  for (const file of ['v4.jsonl', 'activity.jsonl', 'debug.jsonl', 'error.jsonl']) {
    const logPath = path.join(logsDir, file);
    if (fs.existsSync(logPath)) fs.writeFileSync(logPath, '');
  }

  log.info('start', 'Cleared pending messages, sessions, and logs');

  const consumer = new MessageConsumer(msgsDir, queue, meshesDir);
  await consumer.start();

  const dispatcher = new WorkerDispatcher({
    workDir: cwd,
    msgsDir,
    meshesDir: path.join(txRoot, 'meshes'),
    lowMode: options?.low
  }, queue);

  // Wire up parity gate: consumer subscribes to dispatcher for session-start events
  consumer.subscribeToDispatcher(dispatcher);

  dispatcher.on('worker:spawn', ({ agentId, model, resume, sessionId }) => {
    log.info('dispatcher', `Spawning worker: ${agentId}`, { model, mode: resume ? `resume:${sessionId?.slice(0, 8)}` : 'new', sessionId });
  });
  dispatcher.on('worker:complete', ({ id, messagesProcessed, sessionId }) => {
    log.info('dispatcher', `Worker complete: ${id}`, { messagesProcessed, sessionId });
  });
  dispatcher.on('worker:error', ({ id, error, stack, stderr, code }) => {
    // Log detailed error info for debugging SDK failures
    const errorContext: Record<string, unknown> = { error };
    if (code !== undefined) errorContext.exitCode = code;
    if (stderr) errorContext.stderr = stderr.slice(0, 300);
    if (stack) errorContext.stack = stack.split('\n').slice(0, 3).join(' | ');

    log.error('dispatcher', `Worker error: ${id}`, errorContext);
  });
  dispatcher.on('worker:output', ({ id, data }) => {
    log.info('worker', data.length > 200 ? data.slice(0, 200) + '...' : data, { id });
  });

  // Quality stack event logging
  dispatcher.on('quality:preflight:start', (data) => {
    log.info('quality', 'Preflight analysis started', data);
  });
  dispatcher.on('quality:preflight:complete', (data) => {
    log.info('quality', 'Preflight analysis complete', {
      agentId: data.agentId,
      taskId: data.taskId,
      taskType: data.result?.taskType,
      gates: [...(data.result?.requiredGates || []), ...(data.result?.suggestedGates || [])],
    });
  });
  dispatcher.on('quality:stack:start', (data) => {
    log.info('quality', 'Quality stack started', data);
  });
  dispatcher.on('quality:stage:complete', (data) => {
    log.info('quality', 'Quality gate complete', {
      agentId: data.agentId,
      taskId: data.taskId,
      gate: data.stage,
      passed: data.result?.passed,
      confidence: data.result?.confidence,
    });
  });
  dispatcher.on('quality:stack:complete', (data) => {
    log.info('quality', 'Quality stack complete', {
      agentId: data.agentId,
      taskId: data.taskId,
      passed: data.result?.passed,
      iterations: data.result?.iterations,
    });
  });
  dispatcher.on('quality:pass', (data) => {
    log.info('quality', 'Quality stack PASSED', {
      agentId: data.agentId,
      taskId: data.taskId,
      iterations: data.result?.iterations,
    });
  });
  dispatcher.on('quality:retry', (data) => {
    log.warn('quality', 'Quality stack RETRY', {
      agentId: data.agentId,
      taskId: data.taskId,
      iteration: data.iteration,
      feedback: data.feedback,
    });
  });
  dispatcher.on('quality:halt', (data) => {
    log.error('quality', 'Quality stack HALTED', {
      agentId: data.agentId,
      taskId: data.taskId,
      feedback: data.result?.feedback,
    });
  });
  dispatcher.on('quality:exhausted', (data) => {
    log.warn('quality', 'Quality stack EXHAUSTED (max iterations)', {
      agentId: data.agentId,
      taskId: data.taskId,
      maxIterations: data.result?.iterations,
    });
  });

  // Self-healing event logging
  dispatcher.on('agent:nudged', (data) => {
    log.warn('self-healing', 'Stuck agent nudged', {
      agentId: data.agentId,
      nudgeCount: data.nudgeCount,
      reason: data.reason,
      duration: data.duration,
    });
  });
  dispatcher.on('agent:escalated', (data) => {
    log.error('self-healing', 'Stuck agent escalated and killed', {
      agentId: data.agentId,
      reason: data.reason,
      duration: data.duration,
      nudgeCount: data.nudgeCount,
    });
  });

  // Initialize stale message cleaner
  const staleCleaner = new StaleMessageCleaner(queue.getDatabase(), {
    ttlMs: 1800000,      // 30 minutes
    scanIntervalMs: 300000, // 5 minutes
    action: 'archive',
  });
  staleCleaner.on('stale:archived', (msg) => {
    log.info('self-healing', 'Stale message archived', {
      id: msg.id,
      to: msg.to_agent,
      type: msg.type,
      reason: msg.reason,
    });
  });
  staleCleaner.start();

  // Initialize deadlock detector
  const deadlockDetector = new DeadlockDetector(queue, msgsDir, {
    enabled: true,
    scanIntervalMs: 60000, // 1 minute
    autoBreakDepth: 3,
    escalateDepth: 5,
  });
  deadlockDetector.on('deadlock:detected', (cycle) => {
    log.warn('self-healing', 'Deadlock detected', {
      agents: cycle.agents,
      depth: cycle.cycleDepth,
    });
  });
  deadlockDetector.on('deadlock:broken', (data) => {
    log.info('self-healing', 'Deadlock broken', {
      cycle: data.cycle.agents,
      brokenMsgId: data.brokenAsk.msg_id,
    });
  });
  deadlockDetector.on('deadlock:escalated', (cycle) => {
    log.error('self-healing', 'Deadlock escalated to human', {
      agents: cycle.agents,
      depth: cycle.cycleDepth,
    });
  });
  deadlockDetector.start();

  // Event-driven message injector with backoff retry
  const pendingRetries = new Map<number, { timeout: NodeJS.Timeout; id: number }>();
  const MAX_INJECT_ATTEMPTS = 10;

  const tryInject = async (id: number, filepath: string, from: string, type: string, attempt = 1) => {
    if (!fs.existsSync(filepath)) {
      log.warn('injector', 'Message source file not found', { id, from, type, filepath });
      queue.markProcessed(id);
      return;
    }

    // Wait for user to stop typing before injecting
    // Uses env vars TX_INJECT_DEBOUNCE_MS (default 5000) and TX_INJECT_MAX_WAIT_MS (default 60000)
    await waitForUserIdle(tmux);

    const injected = injectFile(tmux, filepath);
    log.debug('injector', 'injectFile result', { id, injected, attempt });
    if (injected) {
      log.info('injector', 'Injected message to core', { id, from, type, file: path.basename(filepath) });
      queue.markProcessed(id);
      pendingRetries.delete(id);
    } else if (attempt >= MAX_INJECT_ATTEMPTS) {
      log.error('injector', 'Max retry attempts reached, marking failed', { id, from, type, attempts: attempt });
      queue.markProcessed(id);  // Mark as processed so it doesn't stay pending
      pendingRetries.delete(id);
    } else {
      // Backoff: 2s, 4s, 8s, 16s, max 30s
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      log.debug('injector', 'Claude busy, retry scheduled', { id, from, type, attempt, delayMs: delay });

      const timeout = setTimeout(() => tryInject(id, filepath, from, type, attempt + 1), delay);
      pendingRetries.set(id, { timeout, id });
    }
  };

  // Subscribe to core-message BEFORE starting dispatcher to avoid race
  consumer.on('core-message', ({ id, filepath, from, type }) => {
    log.info('injector', 'Received core-message event', { id, from, type, file: path.basename(filepath) });
    tryInject(id, filepath, from, type);
  });

  await dispatcher.start(consumer);

  console.log('\n✅ TX V4 services ready!');
  console.log('Attaching to session... (Ctrl+B D to detach)\n');

  // Attach FIRST, then send Claude command (user sees it live)
  const attachPromise = new Promise<void>((resolve) => {
    const attach = spawn('tmux', ['attach', '-t', sessionName], {
      stdio: 'inherit'
    });
    attach.on('exit', () => resolve());
    attach.on('error', () => resolve());
  });

  // Small delay to let attach take over terminal
  await new Promise(r => setTimeout(r, 100));

  // Now send Claude command - user sees it in attached session
  const claudePath = findClaudePath();
  const continueFlag = options?.continue ? ' --continue' : '';
  const modelFlag = options?.model ? ` --model ${options.model}` : '';
  tmux.send(`clear && ${claudePath} --dangerously-skip-permissions${continueFlag}${modelFlag} --system-prompt "$(cat '${corePromptPath}')"`);
  tmux.sendEnter();

  // Wait for detach
  await attachPromise;

  // Cleanup
  console.log('\n[core] Detached from session.');
  for (const { timeout, id } of pendingRetries.values()) {
    clearTimeout(timeout);
    queue.markProcessed(id);  // Mark as processed so they don't stay pending
  }
  if (pendingRetries.size > 0) {
    log.info('injector', `Marked ${pendingRetries.size} pending retries as processed on shutdown`);
  }
  pendingRetries.clear();

  // Stop self-healing components
  staleCleaner.stop();
  deadlockDetector.stop();

  await dispatcher.stop(consumer);
  await consumer.stop();
  queue.close();

  console.log(`[core] Consumer stopped. Claude session still running.`);
  console.log(`[core] Re-attach: tmux attach -t ${sessionName}`);
  console.log(`[core] Kill: tmux kill-session -t ${sessionName}`);
}

/**
 * Stop tx - kill tmux session and cleanup
 */
export async function stop(workDir?: string): Promise<void> {
  const cwd = workDir || process.env.TX_CWD || process.cwd();
  const sessionName = getSessionName(cwd);
  const tmux = new TmuxSession(sessionName);

  if (await tmux.exists()) {
    console.log(`Killing session: ${sessionName}`);
    await tmux.kill();
    console.log('✓ TX stopped');
  } else {
    console.log('TX is not running');
  }

  // Reset terminal state (fixes mouse mode, raw mode, escape sequence corruption)
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l'); // Disable mouse tracking
  process.stdout.write('\x1b[0m');  // Reset colors/attributes
  process.stdout.write('\x1bc');    // Full terminal reset (like 'reset' command)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode?.(false);
  }
}

/**
 * Build mesh list from available mesh configs
 * Returns formatted list with descriptions and intents
 */
function buildMeshList(meshesDir: string): string {
  const meshConfigs: Array<{
    mesh: string;
    description?: string;
    entry_point?: string;
    intents?: { patterns?: string[] };
    worktree?: boolean;  // Requires feature: frontmatter
  }> = [];

  // Scan meshes directory for config files (YAML preferred, JSON legacy)
  if (!fs.existsSync(meshesDir)) {
    return '- No meshes available';
  }

  const scanDir = (dir: string, depth: number = 0) => {
    if (depth > 2) return;
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Check for config files in priority order: YAML > JSON
    const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
    const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

    if (yamlConfig) {
      try {
        const content = fs.readFileSync(path.join(dir, yamlConfig.name), 'utf-8');
        const config = YAML.parse(content);
        meshConfigs.push(config);
      } catch {
        // Skip invalid configs
      }
    } else if (jsonConfig) {
      try {
        const content = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
        const config = JSON.parse(content);
        meshConfigs.push(config);
      } catch {
        // Skip invalid configs
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        scanDir(path.join(dir, entry.name), depth + 1);
      }
    }
  };

  scanDir(meshesDir);

  if (meshConfigs.length === 0) {
    return '- No meshes available';
  }

  // Format mesh list with descriptions and intents
  return meshConfigs
    .map(mesh => {
      const entryPoint = mesh.entry_point || 'worker';
      let line = `- \`${mesh.mesh}\` - ${mesh.description || 'No description'}`;

      // Add intents if present
      if (mesh.intents?.patterns && mesh.intents.patterns.length > 0) {
        const intentList = mesh.intents.patterns.map(p => `"${p}"`).join(', ');
        line += `\n  Use when user wants to: ${intentList}`;
      }

      // Add routing info
      line += `\n  Route to: \`${mesh.mesh}/${entryPoint}\``;

      // Add worktree requirement note (dynamically detected from config)
      if (mesh.worktree) {
        line += `\n  **REQUIRES**: \`feature:\` frontmatter with kebab-case feature name`;
      }

      return line;
    })
    .join('\n\n');
}

function getCorePrompt(msgsDir: string, meshesDir: string): string {
  const meshList = buildMeshList(meshesDir);

  return `# TX V4 Core Agent

You are the core agent for TX. You coordinate work by writing messages to meshes.

To verify TX is operational:
\`\`\`bash
tx status --json
\`\`\`

## CRITICAL: How Work Gets Done

When the user asks you to do something like "run tests" or "build the feature":
- DO NOT run shell commands yourself
- WRITE A TASK MESSAGE to the appropriate mesh
- The message triggers a worker agent to handle it

**"run X" = write a task message to mesh X**

## Available Meshes

${meshList}

## Impact Assessment (CRITICAL)

Before routing work, assess its impact:

**TRIVIAL** (handle directly or route to dev):
- Quick fixes (typos, small config changes)
- Research questions you can answer yourself
- One-liner changes with obvious solutions
- Read-only exploration

**IMPACTFUL** (MUST route to brain first):
- New features or capabilities
- Multi-file changes
- Architectural decisions
- Anything with "build", "implement", "develop", "refactor"
- Changes that affect system behavior

**For IMPACTFUL work - two flows:**

**First, check if feature is tracked:**
Use the \`/know-tool\` skill for spec-graph operations. Search with partial match:
\`\`\`bash
know -g .ai/spec-graph.json list-type feature | grep -i "<keywords>"
\`\`\`
- If matches found → show user, confirm which one, then Flow B (building)
- If no matches → Flow A (planning)
- If ambiguous → ask user to clarify or pick from matches

**A. Planning/designing (not tracked):**
1. **Enter plan mode** - explore codebase, identify gaps, clarify requirements
2. Exit plan mode with clear scope
3. Route to \`brain/brain\` with \`/know:plan\` or \`/know:add\`
4. Brain populates spec-graph → DONE (planning complete, not building yet)

**B. Building (already tracked):**
1. **Enter plan mode** - explore, clarify implementation approach
2. Exit plan mode with clear scope
3. Route to \`brain/brain\` with \`/know:validate\` - brain confirms it's tracked
4. Brain sends back validation approval
5. **On approval** → route to \`dev/worker\` to build

**NEVER route impactful work directly to dev. Planning: plan mode → brain. Building: plan mode → brain validation → dev.**

**Codebase questions** ("how does X work?", "where is Y?", "explain Z"):
- Route to \`brain/brain\` - brain is the knowledge keeper
- No slash command needed, just the question

## Available Tools

Use tools for data gathering and research. Tools are CLI commands, not meshes.

- \`tx tool search <query>\` - Search multiple sources (StackOverflow, GitHub, arXiv, Wikipedia, HackerNews)
  Use when user wants to: "search for", "find information about", "look up", "research"

- \`tx tool getwww <url>\` - Fetch and extract content from URLs with archive fallback
  Use when user wants to: "fetch this URL", "get content from", "download page", "scrape"

- \`tx tool youtube-transcript <video-id>\` - Extract YouTube video transcripts
  Use when user wants to: "get transcript", "YouTube captions", "video text"

- \`tx tool search --providers\` - List available search providers and their status
  Use when user wants to: "what sources", "available providers", "search engines"

**IMPORTANT**: Tools are for data gathering only. DO NOT write task messages to tools. Execute tools yourself when gathering information for the user.

## Message Directory: ${msgsDir}/

## How to Start Work

Write a \`task\` message to trigger a worker:

\`\`\`markdown
---
to: test/worker
from: core/core
type: task
msg-id: task-${Date.now()}
headline: Run the tests
timestamp: ${new Date().toISOString()}
---

Please run the test suite and report results.
\`\`\`

Save to: \`${msgsDir}/{timestamp}-task-core--test-worker-{id}.md\`

## Worktree-Enabled Meshes

Meshes marked with **REQUIRES: \`feature:\`** run in isolated git worktrees. Include the \`feature:\` field:

\`\`\`markdown
---
to: dev-worktree/worker
from: core/core
type: task
feature: user-authentication
msg-id: task-${Date.now()}
headline: Implement login form
---

Build the login form component.
\`\`\`

**Rules**:
- Feature name must be kebab-case (e.g., \`user-auth\`, not \`userAuth\`)
- Creates isolated worktree at \`.ai/worktrees/{feature}/\`
- Changes stay isolated until merged via \`/know:done {feature}\`

## CRITICAL: Slash Command Routing

When the user types a slash command pattern like \`/know:prepare\` or \`/know:add feature-name\`:

1. **IMMEDIATELY** write a task message with the \`command\` frontmatter field
2. Send to the appropriate mesh
3. The worker will execute the slash command directly

**Pattern**: \`/namespace:action [args]\` → route via \`command\` frontmatter

### Example: User says "/know:prepare"

\`\`\`markdown
---
to: brain/brain
from: core/core
type: task
command: /know:prepare
msg-id: task-${Date.now()}
headline: Execute /know:prepare
timestamp: ${new Date().toISOString()}
---

User requested: /know:prepare
\`\`\`

### Example: User says "/know:add auth-system"

\`\`\`markdown
---
to: brain/brain
from: core/core
type: task
command: /know:add auth-system
msg-id: task-${Date.now()}
headline: Execute /know:add auth-system
timestamp: ${new Date().toISOString()}
---

User requested: /know:add auth-system
\`\`\`

**DO NOT** try to execute slash commands yourself. Always route them via the \`command\` frontmatter to the appropriate worker.

## Handling Responses

1. \`ask-human\` - Worker needs user input. Ask the user, then send \`ask-response\`
2. \`task-complete\` - Worker finished. Display result to user.

### Output Format Field

Workers may include a \`format\` field in task-complete frontmatter:

- \`format: verbatim\` - Display the body as-is with markdown rendering. Use for prose, formatted output, or content that should not be summarized.
- No format field - Summarize or acknowledge as appropriate.

## Example ask-response:

\`\`\`markdown
---
to: test/worker
from: core/core
type: ask-response
msg-id: resp-123
headline: User response
---

The user said: [their response here]
\`\`\`

You are now active. When user asks to run something, write a task message.
`;
}

function formatMessageForClaude(msg: any): string {
  return `# Incoming Message

**From**: ${msg.from_agent}
**Type**: ${msg.type}
**Headline**: ${msg.payload?.headline || 'N/A'}

---

${msg.payload?.body || JSON.stringify(msg.payload, null, 2)}

---

Process this message. If it's ask-human, present the question and wait for user input, then send ask-response.
`;
}

/**
 * Prompt user for yes/no confirmation
 */
function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

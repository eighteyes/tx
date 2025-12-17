/**
 * tx start - Start core agent with Claude in tmux
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { TmuxSession, findClaudePath, injectFile } from '../core/tmux.ts';
import { MessageQueue } from '../queue/index.ts';
import { MessageConsumer } from '../core/consumer.ts';
import { WorkerDispatcher } from '../worker/index.ts';
import { log } from '../shared/logger.ts';

const SESSION_NAME = 'tx-v4-core';

export interface StartOptions {
  continue?: boolean;
}

export async function start(workDir?: string, options?: StartOptions): Promise<void> {
  const cwd = workDir || process.env.TX_CWD || process.cwd();
  const aiDir = path.join(cwd, '.ai', 'tx');

  // Debug: Show resolved paths
  console.log(`[debug] TX_CWD: ${process.env.TX_CWD}`);
  console.log(`[debug] TX_ROOT: ${process.env.TX_ROOT}`);
  console.log(`[debug] cwd: ${cwd}`);

  // Ensure directories exist
  const msgsDir = path.join(aiDir, 'msgs');
  const dataDir = path.join(aiDir, 'data');
  const logsDir = path.join(aiDir, 'logs');

  for (const dir of [msgsDir, dataDir, logsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Initialize logger (file-based to avoid polluting tmux session)
  log.init(cwd, 'debug');
  log.info('start', 'Starting TX V4', { cwd, aiDir });

  console.log('\n🚀 Starting TX V4...\n');

  // Create tmux session
  const tmux = new TmuxSession(SESSION_NAME);

  if (await tmux.exists()) {
    console.log(`[tmux] Killing existing session: ${SESSION_NAME}`);
    await tmux.kill();
  }

  console.log(`[tmux] Creating session: ${SESSION_NAME}`);
  await tmux.create(cwd);
  await new Promise(resolve => setTimeout(resolve, 500));

  // Load tmux config if it exists
  const tmuxConf = path.join(cwd, '.tmux.conf');
  if (fs.existsSync(tmuxConf)) {
    console.log(`[tmux] Loading config: ${tmuxConf}`);
    tmux.send(`tmux source-file '${tmuxConf}'`);
    tmux.sendEnter();
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Write core prompt to file
  const corePromptPath = path.join(aiDir, 'core-prompt.md');
  fs.writeFileSync(corePromptPath, getCorePrompt(msgsDir));

  // Start Claude with --system-prompt
  const claudePath = findClaudePath();
  const continueFlag = options?.continue ? ' --continue' : '';
  console.log(`[tmux] Starting Claude${options?.continue ? ' (continuing previous session)' : ''}...`);

  tmux.send(`${claudePath} --dangerously-skip-permissions${continueFlag} --system-prompt "$(cat '${corePromptPath}')"`);
  tmux.sendEnter();

  // Wait for Claude to be ready
  console.log('[tmux] Waiting for Claude to initialize...');
  await waitForClaudeReady(tmux, 60000);
  console.log('[tmux] Claude is ready');

  // Initialize queue and consumer
  const dbPath = path.join(dataDir, 'queue.db');
  const queue = new MessageQueue(dbPath);

  // Clear old state on fresh start
  queue.clearAllMessages();
  queue.clearAllSessions();

  // Clear logs and activity
  const logFiles = ['v4.jsonl', 'activity.jsonl', 'debug.jsonl', 'error.jsonl'];
  for (const file of logFiles) {
    const logPath = path.join(logsDir, file);
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
    }
  }

  log.info('start', 'Cleared queue, sessions, and logs');

  const consumer = new MessageConsumer(msgsDir, queue);

  // Start message consumer
  await consumer.start();
  console.log(`[core] Watching: ${msgsDir}`);
  console.log(`[core] Queue: ${dbPath}`);

  // Start worker dispatcher
  const dispatcher = new WorkerDispatcher({
    workDir: cwd,
    msgsDir,
    meshesDir: path.join(cwd, 'meshes'),
    pollInterval: 1000
  }, queue);

  dispatcher.on('worker:spawn', ({ agentId, model, resume, sessionId }) => {
    const mode = resume ? `resume:${sessionId?.slice(0, 8)}` : 'new';
    log.info('dispatcher', `Spawning worker: ${agentId}`, { model, mode, sessionId });
  });
  dispatcher.on('worker:complete', ({ id, messagesProcessed, sessionId }) => {
    log.info('dispatcher', `Worker complete: ${id}`, { messagesProcessed, sessionId });
  });
  dispatcher.on('worker:error', ({ id, error }) => {
    log.error('dispatcher', `Worker error: ${id}`, { error });
  });
  dispatcher.on('worker:output', ({ id, data }) => {
    // Log worker output (truncated)
    const preview = data.length > 200 ? data.slice(0, 200) + '...' : data;
    log.info('worker', preview, { id });
  });

  await dispatcher.start();
  console.log(`[dispatcher] Watching for task messages`);

  // Start the message injector as a background interval
  // Injects ONE message per interval to avoid overwhelming Claude
  const injectorInterval = setInterval(async () => {
    try {
      const msg = queue.pollOne('core/core');
      if (!msg) return;

      // Inject the original message file directly - core agent handles frontmatter
      const filepath = msg.payload.filepath as string | undefined;
      if (filepath && fs.existsSync(filepath)) {
        injectFile(tmux, filepath);
        log.info('injector', 'Injected message to core', {
          from: msg.from_agent,
          type: msg.type,
          headline: msg.payload.headline,
          file: filepath
        });
      } else {
        log.warn('injector', 'Message source file not found', {
          from: msg.from_agent,
          type: msg.type,
          filepath
        });
      }
    } catch (err) {
      // Ignore errors during injection - session may have been detached
    }
  }, 1000);

  console.log('\n✅ TX V4 is running!');
  console.log('\nAttaching to session... (Ctrl+B D to detach)\n');

  // Attach to tmux session using spawn (NOT execSync - that blocks the event loop!)
  // This allows chokidar and intervals to keep running while attached
  await new Promise<void>((resolve) => {
    const attach = spawn('tmux', ['attach', '-t', SESSION_NAME], {
      stdio: 'inherit'
    });

    attach.on('exit', () => {
      resolve();
    });

    attach.on('error', () => {
      resolve();
    });
  });

  // Cleanup after detach
  console.log('\n[core] Detached from session.');
  clearInterval(injectorInterval);
  await dispatcher.stop();
  await consumer.stop();
  queue.close();

  console.log(`[core] Consumer stopped. Claude session still running.`);
  console.log(`[core] Re-attach: tmux attach -t ${SESSION_NAME}`);
  console.log(`[core] Kill: tmux kill-session -t ${SESSION_NAME}`);
}

/**
 * Stop tx - kill tmux session and cleanup
 */
export async function stop(): Promise<void> {
  const tmux = new TmuxSession(SESSION_NAME);

  if (await tmux.exists()) {
    console.log(`Killing session: ${SESSION_NAME}`);
    await tmux.kill();
    console.log('✓ TX stopped');
  } else {
    console.log('TX is not running');
  }
}

async function waitForClaudeReady(tmux: TmuxSession, timeout: number): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeout) {
    const output = tmux.capture(30);

    // Check for gate patterns (need user intervention)
    if (/Trust.*project/i.test(output) || /initial configuration/i.test(output)) {
      console.log('[tmux] Claude needs configuration. Attach to session and complete setup.');
      console.log(`[tmux] Run: tmux attach -t ${tmux.name}`);
      return false;
    }

    // Look for stable output indicating ready
    if (output.length > 100) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const output2 = tmux.capture(30);
      if (output2 === output || output2.length >= output.length) {
        return true;
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return false;
}

function getCorePrompt(msgsDir: string): string {
  return `# TX V4 Core Agent

You are the core agent for TX. You coordinate work by writing messages to meshes.

## CRITICAL: How Work Gets Done

When the user asks you to do something like "run tests" or "build the feature":
- DO NOT run shell commands yourself
- WRITE A TASK MESSAGE to the appropriate mesh
- The message triggers a worker agent to handle it

**"run X" = write a task message to mesh X**

## Available Meshes

- \`brain\` - Knowledge gateway agent (handles /know:prepare, spec-graph queries)
- \`test\` - Test mesh for validating HITL flow

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

## CRITICAL: Slash Command Routing

When the user types a slash command pattern like \`/know:prepare\` or \`/know:add feature-name\`:

1. **IMMEDIATELY** write a task message with the \`command\` frontmatter field
2. Route to the appropriate mesh (brain handles /know:* commands)
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

### Slash Command Routing Table

| Pattern | Route to | Description |
|---------|----------|-------------|
| \`/know:*\` | brain/brain | Knowledge graph commands |

**DO NOT** try to execute slash commands yourself. Always route them via the \`command\` frontmatter to the appropriate worker.

## Handling Responses

1. \`ask-human\` - Worker needs user input. Ask the user, then send \`ask-response\`
2. \`task-complete\` - Worker finished. Acknowledge to user.

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

/**
 * tx start - Start core agent with Claude in tmux
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import YAML from 'yaml';
import { TmuxSession, findClaudePath, injectFile, getSessionName } from '../core/tmux.ts';
import { MessageQueue } from '../queue/index.ts';
import { MessageConsumer } from '../core/consumer.ts';
import { WorkerDispatcher } from '../worker/index.ts';
import { log } from '../shared/logger.ts';

export interface StartOptions {
  continue?: boolean;
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

  // Backup previous logs before starting fresh session
  const mainLog = path.join(logsDir, 'v4.jsonl');
  const activityLog = path.join(logsDir, 'activity.jsonl');
  const lastMainLog = path.join(logsDir, 'v4.last.jsonl');
  const lastActivityLog = path.join(logsDir, 'activity.last.jsonl');

  if (fs.existsSync(mainLog) && fs.statSync(mainLog).size > 0) {
    fs.copyFileSync(mainLog, lastMainLog);
    fs.writeFileSync(mainLog, ''); // Clear for fresh session
    console.log(`[logs] Backed up v4.jsonl → v4.last.jsonl`);
  }
  if (fs.existsSync(activityLog) && fs.statSync(activityLog).size > 0) {
    fs.copyFileSync(activityLog, lastActivityLog);
    fs.writeFileSync(activityLog, ''); // Clear for fresh session
    console.log(`[logs] Backed up activity.jsonl → activity.last.jsonl`);
  }

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

  // Start Claude with --system-prompt
  const claudePath = findClaudePath();
  const continueFlag = options?.continue ? ' --continue' : '';
  console.log(`[tmux] Starting Claude${options?.continue ? ' (continuing previous session)' : ''}...`);

  tmux.send(`${claudePath} --dangerously-skip-permissions${continueFlag} --system-prompt "$(cat '${corePromptPath}')"`);
  tmux.sendEnter();

  // Wait for Claude to be ready
  console.log('[tmux] Waiting for Claude to initialize...');
  const ready = await waitForClaudeReady(tmux, 15000); // Reduced timeout
  if (!ready) {
    console.log(`[tmux] Claude may need interaction. Check session with: tmux attach -t ${sessionName}`);
    console.log('[tmux] Continuing anyway...');
  } else {
    console.log('[tmux] Claude is ready');
  }

  // Initialize queue and consumer
  const dbPath = path.join(dataDir, 'queue.db');
  const queue = new MessageQueue(dbPath);

  // Clear old pending messages on fresh start (keep delivered for deduplication)
  queue.clearPendingMessages();
  queue.clearAllSessions();

  // Clear logs and activity
  const logFiles = ['v4.jsonl', 'activity.jsonl', 'debug.jsonl', 'error.jsonl'];
  for (const file of logFiles) {
    const logPath = path.join(logsDir, file);
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
    }
  }

  log.info('start', 'Cleared pending messages, sessions, and logs');

  const consumer = new MessageConsumer(msgsDir, queue, meshesDir);

  // Start message consumer
  await consumer.start();
  console.log(`[core] Watching: ${msgsDir}`);
  console.log(`[core] Queue: ${dbPath}`);

  // Start worker dispatcher
  const dispatcher = new WorkerDispatcher({
    workDir: cwd,
    msgsDir,
    meshesDir: path.join(txRoot, 'meshes'),
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
  // Only injects when Claude is idle (no interruption of user typing/scrolling)
  const injectorInterval = setInterval(async () => {
    try {
      const msg = queue.pollOne('core/core');
      if (!msg) return;

      // Inject the original message file directly - core agent handles frontmatter
      const filepath = msg.payload.filepath as string | undefined;
      if (filepath && fs.existsSync(filepath)) {
        const injected = injectFile(tmux, filepath);
        if (injected) {
          log.info('injector', 'Injected message to core', {
            from: msg.from_agent,
            type: msg.type,
            headline: msg.payload.headline,
            file: filepath
          });
        } else {
          // Claude is busy - put message back in queue for retry
          queue.insert(msg);
          log.debug('injector', 'Claude busy, queueing for retry', {
            from: msg.from_agent,
            type: msg.type
          });
        }
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
    const attach = spawn('tmux', ['attach', '-t', sessionName], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    // OSC pattern: ESC ] <code> ; <payload> (BEL or ESC \)
    const oscPattern = /\x1b\](\d+);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

    // Buffer for incomplete OSC sequences
    let oscBuffer = '';

    // Monitor stdout from tmux for OSC codes
    if (attach.stdout) {
      attach.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        const combined = oscBuffer + text;

        // Check for complete OSC sequences
        let match;
        let lastIndex = 0;
        oscPattern.lastIndex = 0;

        while ((match = oscPattern.exec(combined)) !== null) {
          const [, code, payload] = match;
          log.info('osc', 'Captured OSC code', { code, payload: payload.slice(0, 100) });

          // Re-emit the OSC code to stdout
          process.stdout.write(`\x1b]${code};${payload}\x07`);
          lastIndex = oscPattern.lastIndex;
        }

        // Keep any incomplete sequence in the buffer
        // Check if there's an incomplete OSC start at the end
        const remaining = combined.slice(lastIndex);
        const oscStartIndex = remaining.lastIndexOf('\x1b]');
        if (oscStartIndex !== -1 && !remaining.slice(oscStartIndex).includes('\x07') && !remaining.slice(oscStartIndex).includes('\x1b\\')) {
          // Incomplete OSC sequence - buffer it
          oscBuffer = remaining.slice(oscStartIndex);
          // Write the part before the incomplete sequence
          process.stdout.write(remaining.slice(0, oscStartIndex));
        } else {
          // No incomplete sequence, clear buffer and write all
          oscBuffer = '';
          process.stdout.write(remaining);
        }
      });
    }

    // Pipe stdin to tmux while monitoring for OSC codes
    if (attach.stdin && process.stdin.isTTY) {
      // Set raw mode to pass all input through
      process.stdin.setRawMode(true);
      process.stdin.resume();

      process.stdin.on('data', (data: Buffer) => {
        const text = data.toString();

        // Check for OSC codes in input
        let match;
        oscPattern.lastIndex = 0;
        while ((match = oscPattern.exec(text)) !== null) {
          const [, code, payload] = match;
          log.info('osc', 'Captured OSC code from stdin', { code, payload: payload.slice(0, 100) });

          // Re-emit the OSC code
          process.stdout.write(`\x1b]${code};${payload}\x07`);
        }

        // Pass all data through to tmux
        attach.stdin?.write(data);
      });
    } else if (attach.stdin) {
      // Non-TTY mode: just pipe
      process.stdin.pipe(attach.stdin);
    }

    attach.on('exit', () => {
      // Restore stdin
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      resolve();
    });

    attach.on('error', () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
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

    // Check for Claude prompt patterns indicating ready
    if (output.includes('send') ||
        output.includes('tokens') ||
        output.includes('⏵⏵') ||
        /bypass permissions/i.test(output)) {
      return true;
    }

    // Look for stable output indicating ready (fallback)
    if (output.length > 100) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced from 2000
      const output2 = tmux.capture(30);
      if (output2 === output || output2.length >= output.length) {
        return true;
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return false;
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

      return line;
    })
    .join('\n\n');
}

function getCorePrompt(msgsDir: string, meshesDir: string): string {
  const meshList = buildMeshList(meshesDir);

  return `# TX V4 Core Agent

You are the core agent for TX. You coordinate work by writing messages to meshes.

## CRITICAL: How Work Gets Done

When the user asks you to do something like "run tests" or "build the feature":
- DO NOT run shell commands yourself
- WRITE A TASK MESSAGE to the appropriate mesh
- The message triggers a worker agent to handle it

**"run X" = write a task message to mesh X**

## Available Meshes

${meshList}

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

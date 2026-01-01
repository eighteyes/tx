/**
 * TX Run - Headless mesh REPL command
 *
 * Responsibilities:
 * - Parse tx run <mesh> <agent> "<prompt>" command
 * - Initialize headless worker for stateful conversation
 * - REPL interface for follow-up messages
 * - Display agent responses (body only, no frontmatter)
 * - Handle @agent-name targeting and /commands
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { watch, type FSWatcher } from 'chokidar';
import { HeadlessRunner } from '../worker/headless-runner.ts';
import { MessageQueue } from '../queue/index.ts';
import { MessageConsumer } from '../core/consumer.ts';
import { log } from '../shared/logger.ts';
import { chalk } from '../shared/colors.ts';

export interface RunOptions {
  mesh?: string;
  agent?: string;
  prompt?: string;
  model?: string;
}

interface ParsedMessage {
  from: string;
  to: string;
  type: string;
  status?: string;
  body: string;
  timestamp: string;
  filepath: string;
}

/**
 * Main run command
 */
export async function run(options: RunOptions = {}): Promise<void> {
  const { mesh, agent, prompt } = options;

  if (!mesh || !agent || !prompt) {
    console.log(chalk.red('Usage: tx run <mesh> <agent> "<prompt>"'));
    console.log(chalk.dim('Example: tx run research sourcer "find papers on transformers"'));
    process.exit(1);
  }

  const workDir = process.env.TX_CWD || process.cwd();
  const msgsDir = path.join(workDir, '.ai', 'tx', 'msgs');
  const meshesDir = path.join(workDir, 'meshes');
  const dbPath = path.join(workDir, '.ai', 'tx', 'data', 'queue.db');

  // Ensure directories exist
  if (!fs.existsSync(msgsDir)) {
    fs.mkdirSync(msgsDir, { recursive: true });
  }

  // Initialize queue
  const queue = new MessageQueue(dbPath);

  // Start consumer (same as tx start - watches msgs dir and inserts to queue)
  const consumer = new MessageConsumer(msgsDir, queue, meshesDir);
  await consumer.start();
  log.info('run', 'Message consumer started', { msgsDir });

  // Initialize runner
  const runner = new HeadlessRunner({
    mesh,
    agent,
    workDir,
    msgsDir,
    meshesDir,
  }, queue);

  try {
    await runner.initialize();
  } catch (error) {
    console.log(chalk.red((error as Error).message));
    process.exit(1);
  }

  const agentId = runner.getAgentId();
  console.log(chalk.dim(`[Initializing ${agentId}...]`));

  // Track state
  let currentAgent = agentId;
  let messageCount = 0;
  let watcher: FSWatcher | null = null;
  let rl: readline.Interface | null = null;
  const displayedFiles = new Set<string>();
  let pendingQuestion = false;

  // Cleanup function
  const cleanup = async () => {
    console.log(chalk.dim('\n[Shutting down...]'));
    if (watcher) {
      await watcher.close();
    }
    if (rl) {
      rl.close();
    }
    await consumer.stop();
    await runner.stop();
    queue.close();
    console.log(chalk.dim('[Session ended]'));
  };

  // Handle Ctrl+C
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  // Watch for response files
  watcher = watch(`${msgsDir}/*.md`, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('add', (filepath) => {
    // Skip if already displayed
    if (displayedFiles.has(filepath)) return;
    displayedFiles.add(filepath);

    const msg = parseMessageFile(filepath);
    if (!msg) return;

    // Only display messages FROM agents in this mesh (not TO them)
    if (!msg.from.startsWith(`${mesh}/`)) return;

    // Skip messages TO other agents (inter-agent chatter)
    if (msg.to.startsWith(`${mesh}/`) && msg.to !== 'user/repl') return;

    // Track if this is a question requiring user input
    // ask-human = HITL, ask = question (when to user/repl), blocked = needs help
    pendingQuestion = msg.type === 'ask-human' || msg.type === 'ask' || msg.status === 'blocked';

    displayResponse(msg);
  });

  // Wire up quality event logging
  runner.on('quality:preflight:start', (data) => {
    log.info('quality', 'Preflight analysis started', data);
  });

  runner.on('quality:preflight:complete', (data) => {
    log.info('quality', 'Preflight analysis complete', {
      agentId: data.agentId,
      taskId: data.taskId,
      taskType: data.result?.taskType,
      gates: [...(data.result?.requiredGates || []), ...(data.result?.suggestedGates || [])],
    });
  });

  runner.on('quality:stack:start', (data) => {
    log.info('quality', 'Quality stack started', data);
  });

  runner.on('quality:stage:complete', (data) => {
    log.info('quality', 'Quality gate complete', {
      agentId: data.agentId,
      taskId: data.taskId,
      gate: data.stage,
      passed: data.result?.passed,
      confidence: data.result?.confidence,
    });
  });

  runner.on('quality:stack:complete', (data) => {
    log.info('quality', 'Quality stack complete', {
      agentId: data.agentId,
      taskId: data.taskId,
      passed: data.result?.passed,
      iterations: data.result?.iterations,
    });
  });

  runner.on('quality:pass', (data) => {
    log.info('quality', 'Quality stack PASSED', {
      agentId: data.agentId,
      taskId: data.taskId,
      iterations: data.result?.iterations,
    });
  });

  runner.on('quality:retry', (data) => {
    log.warn('quality', 'Quality stack RETRY', {
      agentId: data.agentId,
      taskId: data.taskId,
      iteration: data.iteration,
      feedback: data.feedback,
    });
  });

  runner.on('quality:halt', (data) => {
    log.error('quality', 'Quality stack HALTED', {
      agentId: data.agentId,
      taskId: data.taskId,
      feedback: data.result?.feedback,
    });
  });

  runner.on('quality:exhausted', (data) => {
    log.warn('quality', 'Quality stack EXHAUSTED (max iterations)', {
      agentId: data.agentId,
      taskId: data.taskId,
      maxIterations: data.result?.iterations,
    });
  });

  const promptStr = () => chalk.cyan(`${currentAgent.split('/')[1]}> `);

  // Prompt for user input when needed
  const promptUser = () => {
    if (!rl) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    rl.question(promptStr(), handleInput);
  };

  const handleInput = async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      promptUser();
      return;
    }

    // Handle commands
    if (trimmed.startsWith('/')) {
      const handled = await handleCommand(trimmed, runner, messageCount);
      if (handled === 'quit') {
        await cleanup();
        process.exit(0);
      }
      promptUser();
      return;
    }

    // Parse @agent targeting
    const { target, content } = parseAtTarget(trimmed, currentAgent, mesh, runner.getAgents());
    if (!content) {
      promptUser();
      return;
    }

    // Update current agent if targeted
    if (target !== currentAgent) {
      currentAgent = target;
    }

    // Write message (clears pending question since user is responding)
    pendingQuestion = false;
    writeMessage(msgsDir, target, content);
    messageCount++;

    // Wait for worker to complete - 'complete' handler will re-prompt or exit
    console.log(chalk.dim('[Waiting for response...]'));
  };

  // Handle worker completion
  runner.on('complete', async () => {
    // Give messages time to arrive and be processed
    await sleep(500);

    if (pendingQuestion) {
      // Worker needs input - prompt user
      promptUser();
    } else {
      // Worker finished without question - exit
      console.log(chalk.dim('\n[Worker complete]'));
      await cleanup();
      process.exit(0);
    }
  });

  // Insert initial message directly into queue (before starting worker)
  const initialMsgId = generateId();
  queue.insert({
    from_agent: 'user/repl',
    to_agent: agentId,
    type: 'task',
    payload: {
      headline: 'Initial prompt',
      body: prompt,
      'msg-id': initialMsgId,
      timestamp: new Date().toISOString(),
    },
  });
  messageCount++;
  console.log(chalk.dim(`[Message queued: ${initialMsgId}]`));

  // Now start worker (it will immediately find and process the message)
  await runner.start(prompt);
  console.log(chalk.dim(`[Worker started - processing message...]\n`));
}

/**
 * Parse message file and extract body (strip frontmatter)
 */
function parseMessageFile(filepath: string): ParsedMessage | null {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const parts = content.split(/^---$/m);

    if (parts.length < 3) {
      return null;
    }

    // Parse frontmatter
    const frontmatter: Record<string, string> = {};
    for (const line of parts[1].split('\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        frontmatter[match[1].trim()] = match[2].trim();
      }
    }

    return {
      from: frontmatter['from'] || 'unknown',
      to: frontmatter['to'] || 'unknown',
      type: frontmatter['type'] || 'unknown',
      status: frontmatter['status'],
      body: parts[2].trim(),
      timestamp: frontmatter['timestamp'] || new Date().toISOString(),
      filepath,
    };
  } catch {
    return null;
  }
}

/**
 * Display response (body only, labeled)
 */
function displayResponse(msg: ParsedMessage): void {
  const agentName = msg.from.split('/')[1] || msg.from;
  console.log();
  console.log(chalk.green(`[${agentName}]`));
  console.log(msg.body);
  console.log();
}

/**
 * Write message file to msgs directory
 */
function writeMessage(msgsDir: string, to: string, content: string): string {
  const msgId = generateId();
  const timestamp = Date.now();
  const toSafe = to.replace('/', '-');
  const filename = `${timestamp}-task-user-repl--${toSafe}-${msgId}.md`;
  const filepath = path.join(msgsDir, filename);

  const message = `---
to: ${to}
from: user/repl
type: task
msg-id: ${msgId}
timestamp: ${new Date().toISOString()}
---

${content}
`;

  fs.writeFileSync(filepath, message);
  log.info('run', 'Message written', { to, msgId });
  return msgId;
}

/**
 * Parse @agent targeting
 */
function parseAtTarget(
  input: string,
  currentAgent: string,
  mesh: string,
  availableAgents: string[]
): { target: string; content: string } {
  const atMatch = input.match(/^@([\w-]+)\s+(.+)$/s);

  if (atMatch) {
    const targetName = atMatch[1];
    const content = atMatch[2];

    // Validate agent exists
    if (!availableAgents.includes(targetName)) {
      console.log(chalk.red(`Error: Agent '${targetName}' not found in mesh '${mesh}'`));
      console.log(chalk.dim(`Available agents: ${availableAgents.join(', ')}`));
      return { target: currentAgent, content: '' };
    }

    return { target: `${mesh}/${targetName}`, content };
  }

  return { target: currentAgent, content: input };
}

/**
 * Handle REPL commands
 */
async function handleCommand(
  input: string,
  runner: HeadlessRunner,
  messageCount: number
): Promise<string | void> {
  const [cmd, ...args] = input.slice(1).split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'quit':
    case 'q':
    case 'exit':
      return 'quit';

    case 'help':
    case 'h':
    case '?':
      showHelp();
      break;

    case 'agents':
    case 'a':
      showAgents(runner);
      break;

    case 'status':
    case 's':
      showStatus(runner, messageCount);
      break;

    default:
      console.log(chalk.red(`Unknown command: /${cmd}`));
      console.log(chalk.dim('Type /help for available commands'));
  }
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
${chalk.cyan('REPL Commands:')}
  /help, /h, /?     Show this help
  /agents, /a       List available agents in mesh
  /status, /s       Show session status
  /quit, /q         Exit session

${chalk.cyan('Message Targeting:')}
  @agent-name msg   Send message to specific agent
  message           Send to current agent

${chalk.cyan('Examples:')}
  @worker implement auth
  /agents
  /quit
`);
}

/**
 * Show available agents
 */
function showAgents(runner: HeadlessRunner): void {
  const mesh = runner.getMeshConfig();
  const agents = runner.getAgents();
  const current = runner.getAgentId().split('/')[1];

  console.log(`\n${chalk.cyan(`Agents in ${mesh?.mesh}:`)}`);
  for (const agent of agents) {
    const marker = agent === current ? chalk.green('→ ') : '  ';
    console.log(`${marker}${agent}`);
  }
  console.log();
}

/**
 * Show session status
 */
function showStatus(runner: HeadlessRunner, messageCount: number): void {
  const agentId = runner.getAgentId();
  const isAlive = runner.isAlive();

  console.log(`
${chalk.cyan('Session Status:')}
  Agent:    ${agentId}
  Status:   ${isAlive ? chalk.green('running') : chalk.red('stopped')}
  Messages: ${messageCount}
`);
}

/**
 * Generate random message ID
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

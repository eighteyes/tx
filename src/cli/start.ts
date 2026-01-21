/**
 * tx start - Start core agent with Claude in tmux
 */

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { TmuxSession, findClaudePath, injectFile, getSessionName, waitForUserIdle } from '../core/tmux.ts';
import { MessageQueue, StaleMessageCleaner, DeadlockDetector } from '../queue/index.ts';
import { MessageConsumer } from '../core/consumer.ts';
import { WorkerDispatcher } from '../worker/index.ts';
import { log } from '../shared/logger.ts';
import { server as startServer } from './server.ts';
import { buildCorePrompt } from '../prompt/core.js';
import { SessionStore } from '../session/index.ts';

export interface StartOptions {
  continue?: boolean;
  model?: string;  // claude model: opus, sonnet, haiku
  low?: boolean;   // low cost mode (opus -> sonnet)
  ultraLow?: boolean; // ultra low cost mode (all -> haiku)
  serve?: boolean; // start HTTP server alongside core agent
  servePort?: number; // server port (default: 9898)
  serveHost?: string; // server host (default: 0.0.0.0)
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

  // Clear log files BEFORE initializing logger
  for (const file of ['v4.jsonl', 'activity.jsonl', 'debug.jsonl', 'error.jsonl']) {
    const logPath = path.join(logsDir, file);
    if (fs.existsSync(logPath)) fs.writeFileSync(logPath, '');
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

  // PID file for crash detection
  const pidFile = path.join(dataDir, '.pid');
  const wasUnclean = fs.existsSync(pidFile);
  if (wasUnclean) {
    const oldPid = fs.readFileSync(pidFile, 'utf-8').trim();
    log.warn('start', `Detected unclean shutdown (PID ${oldPid})`);
    console.warn(`⚠️  Detected unclean shutdown from previous session (PID ${oldPid})`);
    console.warn(`   Run 'tx recover' to view/resume interrupted work.\n`);
  }
  // Write current PID
  fs.writeFileSync(pidFile, String(process.pid));

  // Load tmux config if it exists (check work dir first, then TX_ROOT)
  let tmuxConf = path.join(cwd, '.tmux.conf');
  if (!fs.existsSync(tmuxConf)) {
    tmuxConf = path.join(txRoot, '.tmux.conf');
  }

  if (fs.existsSync(tmuxConf)) {
    console.log(`[tmux] Loading config: ${tmuxConf}`);
    const loaded = await tmux.sourceConfig(tmuxConf);
    if (!loaded) {
      console.warn(`[tmux] ⚠️  Failed to load config: ${tmuxConf}`);
      console.warn(`[tmux] Session may not have expected settings`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Write core prompt to file
  const corePromptPath = path.join(aiDir, 'core-prompt.md');
  const meshesDir = path.join(txRoot, 'meshes');
  const corePrompt = buildCorePrompt({ msgsDir, meshesDir });
  fs.writeFileSync(corePromptPath, corePrompt);

  // Start services first (they run on event loop while attached)
  console.log('[core] Starting services...');
  const dbPath = path.join(dataDir, 'queue.db');
  const queue = new MessageQueue(dbPath);

  // Handle stale pending messages based on shutdown type
  if (wasUnclean) {
    // Unclean shutdown: mark messages as interrupted (recoverable)
    const staleCount = queue.markPendingAsInterrupted();
    if (staleCount > 0) {
      log.info('start', `Marked ${staleCount} pending messages as interrupted (recoverable)`);
      console.log(`[recovery] ${staleCount} interrupted message(s) from previous session`);
    }
  } else {
    // Clean shutdown: mark messages as failed (normal cleanup)
    const staleCount = queue.markPendingAsFailed();
    if (staleCount > 0) {
      log.info('start', `Marked ${staleCount} stale pending messages as failed`);
    }
  }
  // Note: Sessions are preserved across restarts for crash recovery
  // Previously: queue.clearAllSessions() - removed to support resume

  log.info('start', 'Processed pending messages from previous session');

  // Initialize session store for session awareness
  const sessionsDbPath = path.join(dataDir, 'sessions.db');
  const sessionStore = new SessionStore(sessionsDbPath);

  // Backfill existing sessions from filesystem on first run
  const sessionsDir = path.join(aiDir, 'sessions');
  const backfilled = await sessionStore.backfillFromFilesystem(sessionsDir);
  if (backfilled > 0) {
    log.info('start', `Backfilled ${backfilled} sessions from filesystem`);
  }

  // Prune old sessions (1 year retention)
  const pruned = sessionStore.pruneOldSessions(365);
  if (pruned > 0) {
    log.info('start', `Pruned ${pruned} old sessions`);
  }

  const consumer = new MessageConsumer(msgsDir, queue, meshesDir);
  await consumer.start();

  const dispatcher = new WorkerDispatcher({
    workDir: cwd,
    msgsDir,
    meshesDir: path.join(txRoot, 'meshes'),
    lowMode: options?.low,
    ultraLowMode: options?.ultraLow,
    sessionStore,  // Pass session store for session awareness
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
  dispatcher.on('error', ({ agentId, error }: { agentId: string; error: string }) => {
    log.error('dispatcher', `Dispatcher error for agent: ${agentId}`, { error });
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

  // Start full HTTP/WebSocket server if --serve flag is set
  let serverShutdown: (() => Promise<void>) | null = null;
  if (options?.serve) {
    const port = options.servePort ?? 8088;
    const host = options.serveHost || '0.0.0.0';
    const shutdownFn = await startServer({
      port,
      host,
      embedded: true, // Returns shutdown fn instead of setting signal handlers
    });
    if (typeof shutdownFn === 'function') {
      serverShutdown = shutdownFn;
    }
  }

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

  // Stop server if running
  if (serverShutdown) {
    await serverShutdown();
    log.info('server', 'Server stopped');
  }

  await dispatcher.stop(consumer);
  await consumer.stop();
  queue.close();
  sessionStore.close();

  // Clean shutdown - remove PID file (crash recovery won't trigger on next start)
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
    log.info('start', 'PID file removed (clean shutdown)');
  }

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

  // Clean shutdown - remove PID file
  const dataDir = path.join(cwd, '.ai', 'tx', 'data');
  const pidFile = path.join(dataDir, '.pid');
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }

  // Reset terminal state (fixes mouse mode, raw mode, escape sequence corruption)
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l'); // Disable mouse tracking
  process.stdout.write('\x1b[0m');  // Reset colors/attributes
  process.stdout.write('\x1bc');    // Full terminal reset (like 'reset' command)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode?.(false);
  }
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

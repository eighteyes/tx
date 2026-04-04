/**
 * tx start - Start core agent with Claude in tmux
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { TmuxSession, findClaudePath, getSessionName, injectPrompt, isClaudeIdle } from '../core/tmux.ts';
import { MessageQueue, StaleMessageCleaner, DeadlockDetector } from '../queue/index.ts';
import { MessageConsumer, type MeshCompleteEvent } from '../core/consumer.ts';
import { WorkerDispatcher } from '../worker/index.ts';
import { log } from '../shared/logger.ts';
import { server as startServer } from './server.ts';
import { buildCorePrompt } from '../prompt/core.js';
import { SessionStore } from '../session/index.ts';
import YAML from 'yaml';

export interface StartOptions {
  continue?: boolean;
  model?: string;  // claude model: opus, sonnet, haiku
  low?: boolean;   // low cost mode (opus -> sonnet)
  ultraLow?: boolean; // ultra low cost mode (all -> haiku)
  serve?: boolean; // start HTTP server alongside core agent
  servePort?: number; // server port (default: 9898)
  serveHost?: string; // server host (default: 0.0.0.0)
  debug?: boolean; // enable forensics and verbose logging for all meshes
  noInject?: boolean; // deprecated: use inbox instead
  inbox?: 'inject' | 'hook' | 'ask'; // message delivery mode (default: inject)
  reattach?: boolean; // skip tmux create + claude command (restart mode)
  godMode?: boolean; // enable bypassPermissions instead of dontAsk (unrestricted tool access)
}

/**
 * Inject TX context hook into project's .claude/settings.json
 *
 * This ensures the UserPromptSubmit hook is configured for TX context injection.
 * - Copies hook script to .ai/scripts/tx-context-hook.ts
 * - Merges hook config into .claude/settings.json (without overwriting other settings)
 * - Avoids duplicates by checking if hook already exists
 */
function injectHookConfig(cwd: string, txRoot: string): void {
  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const scriptsDir = path.join(cwd, '.ai', 'scripts');
  const hookScriptDest = path.join(scriptsDir, 'tx-context-hook.ts');

  // 1. Copy hook script from TX installation to project
  try {
    fs.mkdirSync(scriptsDir, { recursive: true });

    // Resolve hook source from TX installation (txRoot/src/hooks/claude/)
    const hookScriptSrc = path.join(txRoot, 'src', 'hooks', 'claude', 'tx-context-hook.ts');

    if (!fs.existsSync(hookScriptSrc)) {
      log.warn('start', 'Hook script not found, skipping hook injection', { src: hookScriptSrc });
      return;
    }

    fs.copyFileSync(hookScriptSrc, hookScriptDest);
    fs.chmodSync(hookScriptDest, 0o755);
    log.debug('start', 'Copied hook script to project', { dest: hookScriptDest });
  } catch (err) {
    log.warn('start', 'Failed to copy hook script', { error: String(err) });
    return;
  }

  // 2. Merge hook config into .claude/settings.json
  try {
    fs.mkdirSync(claudeDir, { recursive: true });

    let settings: {
      hooks?: {
        UserPromptSubmit?: Array<{
          matcher: string;
          hooks: Array<{ type: string; command: string; timeout: number }>;
        }>;
      };
      [key: string]: unknown;
    } = {};

    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch (parseErr) {
        log.warn('start', 'Failed to parse existing settings.json, creating new', { error: String(parseErr) });
        settings = {};
      }
    }

    // Ensure hooks.UserPromptSubmit exists
    settings.hooks = settings.hooks || {};
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];

    // Hook command using CLAUDE_PROJECT_DIR for portability
    const hookCommand = 'npx tsx "$CLAUDE_PROJECT_DIR/.ai/scripts/tx-context-hook.ts"';

    // Check if our hook already exists (by command path)
    const hasHook = settings.hooks.UserPromptSubmit.some((h) =>
      h.hooks?.some((inner) => inner.command === hookCommand)
    );

    if (!hasHook) {
      settings.hooks.UserPromptSubmit.push({
        matcher: '',
        hooks: [{
          type: 'command',
          command: hookCommand,
          timeout: 5
        }]
      });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      log.info('start', 'Injected TX context hook into .claude/settings.json');
      console.log('[hook] Injected TX context hook into .claude/settings.json');
    } else {
      log.debug('start', 'TX context hook already configured in settings.json');
    }
  } catch (err) {
    log.warn('start', 'Failed to inject hook config', { error: String(err) });
  }
}

/**
 * Rotate a log file with numbered backups (keeps 4 prior runs).
 * v4.jsonl → v4.1.jsonl → v4.2.jsonl → v4.3.jsonl → v4.4.jsonl
 * Migrates legacy v4.last.jsonl → v4.1.jsonl on first run.
 */
function rotateLog(logsDir: string, baseName: string): void {
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, -ext.length);
  const current = path.join(logsDir, baseName);
  const legacyBackup = path.join(logsDir, `${stem}.last${ext}`);

  // One-time migration: rename legacy .last file to .1
  const slot1 = path.join(logsDir, `${stem}.1${ext}`);
  if (fs.existsSync(legacyBackup) && !fs.existsSync(slot1)) {
    fs.renameSync(legacyBackup, slot1);
    console.log(`[logs] Migrated ${stem}.last${ext} → ${stem}.1${ext}`);
  }

  try {
    if (!fs.existsSync(current) || fs.statSync(current).size === 0) return;
  } catch { return; }

  // Shift numbered backups: delete .4, rename .3→.4, .2→.3, .1→.2
  const maxSlots = 4;
  const oldest = path.join(logsDir, `${stem}.${maxSlots}${ext}`);
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);

  for (let i = maxSlots - 1; i >= 1; i--) {
    const src = path.join(logsDir, `${stem}.${i}${ext}`);
    const dst = path.join(logsDir, `${stem}.${i + 1}${ext}`);
    if (fs.existsSync(src)) fs.renameSync(src, dst);
  }

  // Copy current → .1, then truncate current
  fs.copyFileSync(current, slot1);
  fs.writeFileSync(current, '');
  console.log(`[logs] Rotated ${baseName} (kept up to ${maxSlots} prior runs)`);
}

export async function start(workDir?: string, options?: StartOptions): Promise<void> {
  // Work directory: where .ai/tx/ lives (default: current directory)
  const cwd = workDir || process.env.TX_CWD || process.cwd();

  // TX installation: where meshes/ and hooks live
  // Derive from this file's location: src/cli/start.ts -> tx-core root
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const txRoot = process.env.TX_ROOT || path.resolve(__dirname, '..', '..');
  process.env.TX_ROOT = txRoot;

  // Set TX_GOD_MODE environment variable if god mode is enabled
  if (options?.godMode) {
    process.env.TX_GOD_MODE = '1';
  }

  const aiDir = path.join(cwd, '.ai', 'tx');

  // Debug: Show resolved paths
  console.log(`[debug] cwd (work): ${cwd}`);
  console.log(`[debug] txRoot (meshes): ${txRoot}`);

  // Inject TX context hook into project's .claude/settings.json
  injectHookConfig(cwd, txRoot);

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

  // know CLI check moved to pre-hook (know:check) — runs per-mesh for brain/dev-know-build

  // Rotate previous logs (keep up to 4 prior runs)
  rotateLog(logsDir, 'v4.jsonl');
  rotateLog(logsDir, 'activity.jsonl');

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
  const sessionExists = await tmux.exists();

  if (options?.reattach) {
    if (sessionExists) {
      log.info('start', 'Reattach mode: reusing existing tmux session');
      console.log(`[tmux] Reattaching to existing session: ${sessionName}`);
    } else {
      // Session gone (race with old process cleanup or manual kill) — recreate without killing
      log.warn('start', 'Reattach mode: tmux session gone, creating fresh');
      console.log(`[tmux] Session not found, creating fresh: ${sessionName}`);
      await tmux.create(cwd);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } else {
    if (sessionExists) {
      console.log(`[tmux] Killing existing session: ${sessionName}`);
      await tmux.kill();
    }
    console.log(`[tmux] Creating session: ${sessionName}`);
    await tmux.create(cwd);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

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

  // SIGUSR2 handler for control signals (e.g., tx mesh kill)
  const controlPath = path.join(dataDir, 'control.json');
  const setupControlHandler = (disp: typeof dispatcher) => {
    process.on('SIGUSR2', () => {
      try {
        if (!fs.existsSync(controlPath)) return;
        const ctrl = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));

        if (ctrl.action === 'kill-mesh' && ctrl.mesh) {
          const killed = disp.killMeshWorkers(ctrl.mesh);
          log.info('start', 'SIGUSR2: killed mesh workers', { mesh: ctrl.mesh, killed });
        } else if (ctrl.action === 'clear-mesh' && ctrl.mesh) {
          disp.clearMeshState(ctrl.mesh);
          log.info('start', 'SIGUSR2: cleared mesh state', { mesh: ctrl.mesh });
        } else if (ctrl.action === 'reload-meshes') {
          disp.reloadMeshConfigs(ctrl.mesh);
          log.info('start', 'SIGUSR2: reloaded mesh configs', { mesh: ctrl.mesh || 'all' });
        } else if (ctrl.action === 'dlq-recover') {
          if (disp.reliability) {
            const results = ctrl.mesh === '_all'
              ? disp.reliability.recoverAll()
              : disp.reliability.recoverForMesh(ctrl.mesh, ctrl.rewindTo);
            const succeeded = results.filter((r: { success: boolean }) => r.success).length;
            log.info('start', 'SIGUSR2: DLQ recovery', {
              mesh: ctrl.mesh, attempted: results.length, succeeded,
            });
          }
        }

        // Delete control file as ACK
        fs.unlinkSync(controlPath);
      } catch (err) {
        log.error('start', 'SIGUSR2 handler error', { error: String(err) });
      }
    });
  };

  // Write runtime.json for context hook
  // Resolve inbox mode: explicit flag > backward-compat noInject > config.yaml > default 'inject'
  let configInbox: string | undefined;
  const configPath = path.join(dataDir, 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const txConfig = YAML.parse(fs.readFileSync(configPath, 'utf-8')) || {};
      configInbox = txConfig.inbox;
    } catch (err) {
      log.warn('start', 'Failed to parse config.yaml for inbox default', { error: String(err) });
    }
  }
  const inboxMode = options?.inbox || (options?.noInject ? 'ask' : undefined) || configInbox || 'inject';
  const runtimePath = path.join(dataDir, 'runtime.json');
  const runtimeState = {
    inbox: inboxMode,
    inject: inboxMode === 'hook' || inboxMode === 'inject',  // backward compat for stale hook copies
    startedAt: new Date().toISOString(),
    sessionName: tmux.name,
    projectDir: cwd,
    txRoot,
  };
  fs.writeFileSync(runtimePath, JSON.stringify(runtimeState, null, 2));
  log.info('start', 'Wrote runtime.json', { inbox: inboxMode });

  // Initialize pending-for-core.json (empty on startup)
  const pendingPath = path.join(dataDir, 'pending-for-core.json');
  const pendingState = {
    messages: [],
    lastWritten: 0,
  };
  fs.writeFileSync(pendingPath, JSON.stringify(pendingState, null, 2));

  // Reset outgoing-tasks.json (stale from previous session)
  const outgoingPath = path.join(dataDir, 'outgoing-tasks.json');
  fs.writeFileSync(outgoingPath, JSON.stringify({}, null, 2));

  // Reset hook-state.json (lastSeenId stale from previous session)
  const hookPath = path.join(dataDir, 'hook-state.json');
  fs.writeFileSync(hookPath, JSON.stringify({ lastSeenId: 0 }, null, 2));

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
  // Clear all suspended sessions — stale sessions from previous games cause cross-contamination
  queue.clearAllSessions();

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
    debug: options?.debug,  // Enable forensics and verbose logging
    godMode: options?.godMode,  // Enable god mode (bypass permissions)
    txRoot,  // TX installation root for script resolution via $TX_ROOT
  }, queue);

  // Register SIGUSR2 control handler now that dispatcher exists
  setupControlHandler(dispatcher);

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

    // Surface error to core user session
    injectSystemError(id, error, { stack, stderr, code });
  });
  // NOTE: guardrail:kill inject-response handled by consolidated handler below (near worker:error)
  dispatcher.on('error', ({ agentId, error }: { agentId: string; error: string }) => {
    log.error('dispatcher', `Dispatcher error for agent: ${agentId}`, { error });

    injectSystemError(agentId, error);
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

    injectSystemError(data.agentId, `Quality gate halted: ${data.result?.feedback || 'critical issue'}`, {
      type: 'quality:halt',
      taskId: data.taskId,
    });
  });
  dispatcher.on('quality:exhausted', (data) => {
    log.warn('quality', 'Quality stack EXHAUSTED (max iterations)', {
      agentId: data.agentId,
      taskId: data.taskId,
      maxIterations: data.result?.iterations,
    });

    injectSystemError(data.agentId, `Quality gate exhausted after ${data.result?.iterations || '?'} iterations`, {
      type: 'quality:exhausted',
      taskId: data.taskId,
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

  // Routing error handling: inject correction back to sender
  dispatcher.on('routing-error', (data: { from: string; to: string; content: string; headline: string }) => {
    log.warn('routing', 'Routing error - injecting correction', {
      from: data.from,
      to: data.to,
      headline: data.headline,
    });
    // Route as worker-resume to inject into sender's session
    consumer.emit('worker-resume', {
      from: data.from,
      to: data.to,
      content: data.content,
      headline: data.headline,
    });
  });

  // Routing escalation: write ask-human message for user intervention
  dispatcher.on('routing-escalation', (data: { from: string; to: string; content: string; headline: string }) => {
    log.error('routing', 'Routing escalation - notifying user', {
      from: data.from,
      to: data.to,
      headline: data.headline,
    });
    consumer.systemWriter.write({
      to: 'core/core',
      from: data.from,
      headline: data.headline,
      body: data.content,
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

    // Route synthetic response to dispatcher for direct injection
    if (data.syntheticResponse) {
      consumer.emit('worker-resume', {
        from: data.syntheticResponse.from,
        to: data.syntheticResponse.to,
        content: data.syntheticResponse.content,
        headline: data.syntheticResponse.headline,
      });
    }
  });
  deadlockDetector.on('deadlock:escalated', (cycle) => {
    log.error('self-healing', 'Deadlock escalated to human', {
      agents: cycle.agents,
      depth: cycle.cycleDepth,
    });
  });
  deadlockDetector.start();

  // Append message to pending-for-core.json for hook injection
  const appendPendingMessage = (id: number, filepath: string, from: string, completion: boolean) => {
    try {
      const pendingPath = path.join(dataDir, 'pending-for-core.json');
      const pending = fs.existsSync(pendingPath)
        ? JSON.parse(fs.readFileSync(pendingPath, 'utf-8'))
        : { messages: [], lastWritten: 0 };

      // Add new message
      pending.messages.push({
        id,
        from,
        completion,
        file: filepath,
        timestamp: new Date().toISOString(),
      });
      pending.lastWritten = id;

      fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
      log.info('injector', 'Appended message to pending-for-core.json', { id, from, completion });
    } catch (err) {
      log.error('injector', 'Failed to append pending message', { id, error: String(err) });
    }
  };

  // Track outgoing tasks from core to meshes
  const outgoingTasksPath = path.join(dataDir, 'outgoing-tasks.json');

  const addOutgoingTask = (mesh: string, msgId: string, options?: { injectResponse?: boolean }) => {
    try {
      const data = fs.existsSync(outgoingTasksPath)
        ? JSON.parse(fs.readFileSync(outgoingTasksPath, 'utf-8'))
        : {};

      if (!data[mesh]) {
        data[mesh] = [];
      }
      const entry: Record<string, unknown> = { msgId, timestamp: new Date().toISOString() };
      if (options?.injectResponse) {
        entry.injectResponse = true;
      }
      data[mesh].push(entry);

      fs.writeFileSync(outgoingTasksPath, JSON.stringify(data, null, 2));
      log.info('injector', 'Added outgoing task', { mesh, msgId, injectResponse: !!options?.injectResponse });
    } catch (err) {
      log.error('injector', 'Failed to add outgoing task', { mesh, msgId, error: String(err) });
    }
  };

  const removeOutgoingTask = (mesh: string): Record<string, unknown> | null => {
    try {
      if (!fs.existsSync(outgoingTasksPath)) return null;

      const data = JSON.parse(fs.readFileSync(outgoingTasksPath, 'utf-8'));
      if (data[mesh] && data[mesh].length > 0) {
        const removed = data[mesh].shift(); // FIFO pop
        if (data[mesh].length === 0) {
          delete data[mesh];
        }
        fs.writeFileSync(outgoingTasksPath, JSON.stringify(data, null, 2));
        log.info('injector', 'Removed outgoing task (FIFO)', { mesh, removed });
        return removed;
      }
    } catch (err) {
      log.error('injector', 'Failed to remove outgoing task', { mesh, error: String(err) });
    }
    return null;
  };

  const getOutgoingTaskCount = (): number => {
    try {
      if (!fs.existsSync(outgoingTasksPath)) return 0;
      const data = JSON.parse(fs.readFileSync(outgoingTasksPath, 'utf-8'));
      return Object.values(data).reduce((sum: number, tasks) => sum + (tasks as unknown[]).length, 0);
    } catch {
      return 0;
    }
  };

  // Track recently completed workers for status bar grace period
  const COMPLETION_GRACE_MS = 15_000;
  const writeRecentCompletion = (dir: string, agentId: string) => {
    try {
      const completionsPath = path.join(dir, 'recent-completions.json');
      let completions: Array<{ agentId: string; at: number }> = [];
      if (fs.existsSync(completionsPath)) {
        completions = JSON.parse(fs.readFileSync(completionsPath, 'utf-8'));
      }
      const now = Date.now();
      // Prune expired entries
      completions = completions.filter(c => now - c.at < COMPLETION_GRACE_MS);
      completions.push({ agentId, at: now });
      fs.writeFileSync(completionsPath, JSON.stringify(completions, null, 2));
    } catch {
      // Non-fatal
    }
  };

  // Write status.json for hook consumption (mirrors worker state)
  // Also updates status bar with current counts
  const writeStatusFile = () => {
    try {
      const statusPath = path.join(dataDir, 'status.json');
      const workersPath = path.join(dataDir, 'workers.json');

      // Read workers.json to get active workers
      let meshes: Record<string, { activeWorkers: number; state: string }> = {};
      let workers: string[] = [];
      let pendingAsks = 0;
      let activeWorkerCount = 0;
      let suspendedCount = 0;

      if (fs.existsSync(workersPath)) {
        const workersData = JSON.parse(fs.readFileSync(workersPath, 'utf-8'));
        const activeWorkers = workersData.workers || [];

        // Group by mesh (first part of agentId)
        for (const w of activeWorkers) {
          const [meshName] = w.agentId.split('/');
          if (!meshes[meshName]) {
            meshes[meshName] = { activeWorkers: 0, state: 'active' };
          }
          meshes[meshName].activeWorkers++;
          workers.push(w.agentId);
          activeWorkerCount++;

          // Count awaiting workers as pending asks and suspended
          if (w.status === 'awaiting') {
            pendingAsks++;
            suspendedCount++;
          }
        }
      }

      // Read pending-for-core.json and hook-state.json to get unread message count
      let messagesForCore = 0;
      const pendingForCorePath = path.join(dataDir, 'pending-for-core.json');
      const hookStatePath = path.join(dataDir, 'hook-state.json');

      if (fs.existsSync(pendingForCorePath)) {
        try {
          const pending = JSON.parse(fs.readFileSync(pendingForCorePath, 'utf-8'));
          let lastSeenId = 0;

          if (fs.existsSync(hookStatePath)) {
            const hookState = JSON.parse(fs.readFileSync(hookStatePath, 'utf-8'));
            lastSeenId = hookState.lastSeenId || 0;
          }

          // Count unread messages (id > lastSeenId)
          messagesForCore = (pending.messages || []).filter((m: { id: number }) => m.id > lastSeenId).length;
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Read halted.json for mesh halt state
      const haltedPath = path.join(dataDir, 'halted.json');
      if (fs.existsSync(haltedPath)) {
        try {
          const halted = JSON.parse(fs.readFileSync(haltedPath, 'utf-8'));
          for (const [meshName, info] of Object.entries(halted)) {
            const haltInfo = info as { suspendedAgent: string; reason: string; since: string; pendingMessages: number };
            if (!meshes[meshName]) {
              meshes[meshName] = { activeWorkers: 0, state: 'halted' };
            }
            // Mark as halted if no active workers
            if (meshes[meshName].activeWorkers === 0) {
              meshes[meshName].state = 'halted';
              (meshes[meshName] as Record<string, unknown>).suspendedAgent = haltInfo.suspendedAgent;
              (meshes[meshName] as Record<string, unknown>).haltReason = haltInfo.reason;
              (meshes[meshName] as Record<string, unknown>).pendingMessages = haltInfo.pendingMessages;
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Query pending queue messages (waiting for dispatch)
      const queueStats = queue.getStats();
      const pendingQueue = queueStats.byAgent;

      const status = {
        meshes,
        workers,
        pendingAsks,
        pendingQueue,
        timestamp: new Date().toISOString(),
      };

      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    } catch (err) {
      log.debug('injector', 'Failed to write status.json', { error: String(err) });
    }
  };

  // Active injection: persistent poll drains queue whenever Claude is idle
  const injectionQueue: Array<{ id: number; filepath: string; from: string; queuedAt: number; inlineMessage?: string; retries?: number }> = [];
  let injectionPollTimer: ReturnType<typeof setInterval> | null = null;
  const INJECTION_POLL_MS = 2000;
  const INJECTION_STALE_MS = 5 * 60 * 1000; // 5 minutes — give up on stale entries

  const drainInjectionQueue = () => {
    if (injectionQueue.length === 0) {
      // Nothing to inject — stop polling
      if (injectionPollTimer) {
        clearInterval(injectionPollTimer);
        injectionPollTimer = null;
        log.debug('injector', 'Injection queue empty, polling stopped');
      }
      return;
    }

    const now = Date.now();
    const head = injectionQueue[0];

    // Drop stale entries (already in pending-for-core.json as fallback)
    if (now - head.queuedAt > INJECTION_STALE_MS) {
      injectionQueue.shift();
      log.warn('injector', 'Dropped stale injection (>5m), available via tx inbox', { from: head.from, queued: injectionQueue.length });
      return; // Next poll will process the next item
    }

    try {
      let message: string;
      if (head.inlineMessage) {
        message = head.inlineMessage;
      } else {
        message = `Read and follow instructions: @${head.filepath}`;
      }

      const injected = injectPrompt(tmux, message);
      head.retries = (head.retries || 0) + 1;

      if (injected) {
        injectionQueue.shift();
        log.info('injector', 'Active injection succeeded', {
          id: head.id,
          from: head.from,
          waitMs: now - head.queuedAt,
          retries: head.retries,
          queued: injectionQueue.length,
        });

        // Mark as read in hook-state so tx inbox doesn't show injected messages
        if (head.id >= 0) {
          try {
            const hookStatePath = path.join(dataDir, 'hook-state.json');
            fs.writeFileSync(hookStatePath, JSON.stringify({
              lastSeenId: head.id,
              updatedAt: new Date().toISOString(),
            }, null, 2));
          } catch {
            // Non-fatal
          }
        }
      } else {
        // Log every 5th retry to avoid spam but maintain visibility
        if (head.retries % 5 === 0) {
          log.warn('injector', 'Injection blocked — Claude busy', {
            from: head.from,
            retries: head.retries,
            waitMs: now - head.queuedAt,
            queued: injectionQueue.length,
          });
        }
      }
    } catch (err) {
      log.warn('injector', 'Active injection read error', { from: head.from, error: String(err) });
      injectionQueue.shift(); // Remove bad entry
    }
  };

  const tryInjectResponse = (id: number, filepath: string, from: string, inlineMessage?: string) => {
    injectionQueue.push({ id, filepath, from, queuedAt: Date.now(), inlineMessage });
    log.info('injector', 'Queued for injection', { id, from, inline: !!inlineMessage, queued: injectionQueue.length });

    // Start polling if not already running
    if (!injectionPollTimer) {
      injectionPollTimer = setInterval(drainInjectionQueue, INJECTION_POLL_MS);
      // Also try immediately
      drainInjectionQueue();
    }
  };

  // --- System error injection (direct tmux, no message files) ---
  const systemErrorQueue: Array<{ message: string; queuedAt: number }> = [];
  let systemErrorPollTimer: ReturnType<typeof setInterval> | null = null;
  const SYSTEM_ERROR_POLL_MS = 2000;
  const SYSTEM_ERROR_STALE_MS = 2 * 60 * 1000; // 2 min — errors are urgent, don't let them go stale

  const drainSystemErrors = () => {
    if (systemErrorQueue.length === 0) {
      if (systemErrorPollTimer) {
        clearInterval(systemErrorPollTimer);
        systemErrorPollTimer = null;
      }
      return;
    }

    const now = Date.now();
    const head = systemErrorQueue[0];

    if (now - head.queuedAt > SYSTEM_ERROR_STALE_MS) {
      systemErrorQueue.shift();
      log.warn('injector', 'Dropped stale system error (>2m)', { queued: systemErrorQueue.length });
      return;
    }

    const injected = injectPrompt(tmux, head.message);
    if (injected) {
      systemErrorQueue.shift();
      log.info('injector', 'System error injected into core session', {
        waitMs: now - head.queuedAt,
        queued: systemErrorQueue.length,
      });
    }
    // If not injected (Claude busy), leave at head — next poll retries
  };

  const injectSystemError = (agentId: string, error: string, extra?: Record<string, unknown>) => {
    const parts = [`[system error from ${agentId}]`, '', `Error: ${error}`];
    if (extra?.code !== undefined) parts.push(`Exit code: ${extra.code}`);
    if (extra?.stderr) parts.push(`Stderr: ${String(extra.stderr).slice(0, 200)}`);
    if (extra?.stack) parts.push(`Stack: ${String(extra.stack).split('\n').slice(0, 3).join(' → ')}`);
    if (extra?.type) parts.push(`Type: ${extra.type}`);
    if (extra?.taskId) parts.push(`Task: ${extra.taskId}`);

    const message = parts.join('\n');
    systemErrorQueue.push({ message, queuedAt: Date.now() });

    log.info('injector', 'Queued system error for core injection', { agentId, error: error.slice(0, 100) });

    if (!systemErrorPollTimer) {
      systemErrorPollTimer = setInterval(drainSystemErrors, SYSTEM_ERROR_POLL_MS);
      drainSystemErrors(); // Try immediately
    }
  };

  // --- www session forwarding (HTTP push with file-copy fallback) ---
  const wwwSessionsPath = path.join(dataDir, 'www-sessions.json');

  /** Read www-sessions.json entry for a mesh */
  function getWwwSessionEntry(meshId: string): { sessionId: string; port?: number } | null {
    try {
      if (!fs.existsSync(wwwSessionsPath)) return null;
      const registry = JSON.parse(fs.readFileSync(wwwSessionsPath, 'utf-8'));
      const entry = registry[meshId];
      if (!entry?.sessionId) return null;
      return { sessionId: entry.sessionId, port: entry.port };
    } catch {
      return null;
    }
  }

  /** Parse a message .md file into AgentMessage fields */
  function parseMessageFromFile(filepath: string): { from: string; to: string; completion: boolean; body: string; headline?: string; msgId?: string; refMsgId?: string } | null {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (!fmMatch) return null;

      const fm: Record<string, string> = {};
      for (const line of fmMatch[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }

      const body = content.slice(fmMatch[0].length).trim();
      return {
        from: fm['from'] || '',
        to: fm['to'] || 'core/core',
        completion: fm['status'] === 'complete' || fm['outcome'] === 'complete',
        body,
        headline: fm['headline'],
        msgId: fm['msg-id'],
        refMsgId: fm['ref-msg-id'],
      };
    } catch {
      return null;
    }
  }

  /** File-copy fallback: copy message file to session msgs dir */
  function forwardViaFileCopy(filepath: string, meshId: string, sessionId: string): boolean {
    try {
      const dir = path.join(cwd, '.ai', 'tx', 'sessions', sessionId, 'msgs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const content = fs.readFileSync(filepath, 'utf-8');
      fs.writeFileSync(path.join(dir, path.basename(filepath)), content);
      log.info('injector', 'Forwarded via file-copy fallback', { meshId });
      return true;
    } catch (err) {
      log.error('injector', 'File-copy fallback failed', { error: (err as Error).message });
      return false;
    }
  }

  /** HTTP push a message to tx-serve, falling back to file-copy */
  async function pushToWwwServer(filepath: string, from: string): Promise<void> {
    const [meshId] = from.split('/');
    const entry = getWwwSessionEntry(meshId);
    if (!entry) return;

    const parsed = parseMessageFromFile(filepath);
    if (!parsed) {
      forwardViaFileCopy(filepath, meshId, entry.sessionId);
      return;
    }

    const port = entry.port || parseInt(process.env.TX_SERVER_PORT || '6000', 10);
    try {
      const res = await fetch(`http://localhost:${port}/v1/sessions/${entry.sessionId}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        log.info('injector', 'HTTP push to www server succeeded', { meshId, sessionId: entry.sessionId });
        return;
      }
      log.warn('injector', 'HTTP push returned non-OK, falling back to file-copy', { meshId, status: res.status });
    } catch (err) {
      log.warn('injector', 'HTTP push failed, falling back to file-copy', { meshId, error: (err as Error).message });
    }
    forwardViaFileCopy(filepath, meshId, entry.sessionId);
  }

  /** File-copy fallback for status messages */
  function writeWwwStatusFile(meshId: string, sessionId: string, body: string): void {
    const dir = path.join(cwd, '.ai', 'tx', 'sessions', sessionId, 'msgs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const filename = `${ts}-status-system--core-core-${rand}.md`;
    const content = `---\nfrom: system\nto: core/core\ntype: status\n---\n\n${body}\n`;
    fs.writeFileSync(path.join(dir, filename), content);
  }

  /** Check if a port is actually listening (fast TCP probe) */
  async function isPortListening(port: number): Promise<boolean> {
    const { createConnection } = await import('node:net');
    return new Promise((resolve) => {
      const socket = createConnection({ port, host: 'localhost' }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
  }

  /** HTTP push a status event to tx-serve, falling back to file-copy */
  async function pushWwwStatus(meshId: string, body: string): Promise<void> {
    const entry = getWwwSessionEntry(meshId);
    if (!entry) return;

    const port = entry.port || parseInt(process.env.TX_SERVER_PORT || '6000', 10);

    // Guard: don't attempt HTTP if server isn't listening
    if (!await isPortListening(port)) return;

    try {
      const res = await fetch(`http://localhost:${port}/v1/sessions/${entry.sessionId}/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'system',
          to: 'core/core',
          type: 'status',
          body,
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        log.info('injector', 'HTTP status push succeeded', { meshId });
        return;
      }
      log.warn('injector', 'HTTP status push non-OK, falling back to file-copy', { meshId, status: res.status });
    } catch (err) {
      log.warn('injector', 'HTTP status push failed, falling back to file-copy', { meshId, error: (err as Error).message });
    }
    writeWwwStatusFile(meshId, entry.sessionId, body);
  }

  // Subscribe to core-message BEFORE starting dispatcher to avoid race
  consumer.on('core-message', ({ id, filepath, from, completion }) => {
    log.info('injector', 'Received core-message event', { id, from, completion, file: path.basename(filepath) });
    tmux.bell();
    appendPendingMessage(id, filepath, from, completion);
    queue.markProcessed(id);

    // Remove outgoing task on completion from a mesh
    let removedTask: Record<string, unknown> | null = null;
    if (completion) {
      const [mesh] = from.split('/');
      removedTask = removeOutgoingTask(mesh);
    }

    // Forward to www session if one exists for this mesh (HTTP push, file-copy fallback)
    pushToWwwServer(filepath, from).catch(err => {
      log.error('injector', 'pushToWwwServer error', { error: (err as Error).message });
    });

    // Active injection: per-task inject-response flag OR global inject mode
    if (removedTask?.injectResponse) {
      log.info('injector', 'inject-response: actively injecting task completion', { from, completion });
      tryInjectResponse(id, filepath, from);
    } else if (inboxMode === 'inject') {
      log.info('injector', 'Inject mode: actively injecting core-message', { from, completion });
      tryInjectResponse(id, filepath, from);
    }

    writeStatusFile();  // This now updates status bar with all counts
  });

  // Track outgoing tasks when core sends tasks to meshes + forward routing status to www
  consumer.on('worker-message', ({ agentId, from, injectResponse }) => {
    if (from === 'core/core') {
      const [mesh] = agentId.split('/');
      addOutgoingTask(mesh, `task-${Date.now()}`, { injectResponse: !!injectResponse });
      writeStatusFile();
    }
    // Write routing status to www session
    const [mesh] = agentId.split('/');
    const [, fromAgent] = (from || '').split('/');
    const [, toAgent] = agentId.split('/');
    if (fromAgent && toAgent && fromAgent !== 'core') {
      pushWwwStatus(mesh, `${fromAgent} → ${toAgent}`).catch(err => {
        log.error('injector', 'pushWwwStatus error (routing)', { error: (err as Error).message });
      });
    }
  });

  // Handle mesh-complete: FSM meshes may reach terminal state without a completion
  // agent message to core/core (e.g., finalizer writes a gate file but no message).
  // Pop the outgoing task and trigger inject-response if flagged.
  consumer.on('mesh-complete', ({ meshName }: MeshCompleteEvent) => {
    const removedTask = removeOutgoingTask(meshName);
    if (removedTask?.injectResponse) {
      log.info('injector', 'mesh-complete: injecting completion for FSM mesh', { meshName });
      const completionMsg = `[mesh complete: ${meshName}]\n\nMesh "${meshName}" reached terminal state.`;
      tryInjectResponse(-1, '', meshName, completionMsg);
    }
    writeStatusFile();
  });

  // Initialize status bar and status file
  writeStatusFile();  // This now updates status bar with all counts

  // Update status.json on dispatcher events + forward status to www sessions
  dispatcher.on('worker:spawn', ({ agentId, model }: { agentId: string; model: string }) => {
    writeStatusFile();
    const [mesh, agent] = agentId.split('/');
    pushWwwStatus(mesh, `${agent} started (${model})`).catch(err => {
      log.error('injector', 'pushWwwStatus error (spawn)', { error: (err as Error).message });
    });
  });
  dispatcher.on('worker:complete', ({ id }: { id: string }) => {
    setTimeout(writeStatusFile, 50);
    // Track recent completion for status bar grace period
    writeRecentCompletion(dataDir, id);
    const [mesh, agent] = (id || '').split('/');
    if (mesh) pushWwwStatus(mesh, `${agent || id} completed`).catch(err => {
      log.error('injector', 'pushWwwStatus error (complete)', { error: (err as Error).message });
    });
  });
  dispatcher.on('guardrail:kill', ({ agentId, meshName, guardrail, reason }: { agentId: string; meshName: string; guardrail: string; reason: string }) => {
    setTimeout(writeStatusFile, 50);
    const removedTask = removeOutgoingTask(meshName);
    if (removedTask?.injectResponse) {
      const msg = `[guardrail kill: ${agentId}] ${guardrail}: ${reason}`;
      tryInjectResponse(-1, '', agentId, msg);
    }
    pushWwwStatus(meshName, `${agentId} killed: ${guardrail}`).catch(() => {});
  });
  dispatcher.on('worker:error', ({ id, error, guardrailKill }: { id: string; error: string; guardrailKill?: boolean }) => {
    if (guardrailKill) return;  // Already handled by guardrail:kill
    setTimeout(writeStatusFile, 50);
    const [mesh, agent] = (id || '').split('/');
    if (mesh) {
      pushWwwStatus(mesh, `${agent || id} error: ${error}`).catch(err => {
        log.error('injector', 'pushWwwStatus error (worker error)', { error: (err as Error).message });
      });
      // Clean up outgoing task so inject-response doesn't hang forever
      const removedTask = removeOutgoingTask(mesh);
      if (removedTask?.injectResponse) {
        const errorMsg = `[mesh error from ${id}]\n\n${error}`;
        tryInjectResponse(-1, '', id, errorMsg);
      }
    }
  });
  // NOTE: duplicate guardrail:kill handler removed — consolidated into single handler above
  dispatcher.on('mesh:killed', ({ meshName, killed, agents }: { meshName: string; killed: number; agents: string[] }) => {
    log.info('dispatcher', `Mesh killed via control signal`, { meshName, killed, agents });
    setTimeout(writeStatusFile, 50);
    // Clean up outgoing task on mesh kill too
    const removedTask = removeOutgoingTask(meshName);
    if (removedTask?.injectResponse) {
      const killMsg = `[mesh killed: ${meshName}]\n\nKilled ${killed} workers: ${agents.join(', ')}`;
      tryInjectResponse(-1, '', meshName, killMsg);
    }
    pushWwwStatus(meshName, `Mesh killed (${killed} workers: ${agents.join(', ')})`).catch(err => {
      log.error('injector', 'pushWwwStatus error (mesh killed)', { error: (err as Error).message });
    });
  });
  dispatcher.on('mesh:halted-message', () => {
    setTimeout(writeStatusFile, 50);
  });

  // Heartbeat: refresh status.json every 10s so the tmux hook's staleness check
  // (30s threshold) doesn't suppress worker indicators during long-running tasks
  const STATUS_HEARTBEAT_MS = 10_000;
  const statusHeartbeat = setInterval(writeStatusFile, STATUS_HEARTBEAT_MS);

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

  // Attach to tmux, capturing child process ref for SIGTERM handling
  let attachProcess: ReturnType<typeof spawn> | null = null;
  const attachPromise = new Promise<void>((resolve) => {
    attachProcess = spawn('tmux', ['attach', '-t', sessionName], {
      stdio: 'inherit'
    });
    attachProcess.on('exit', () => resolve());
    attachProcess.on('error', () => resolve());
  });

  // SIGTERM handler: kill attach process to trigger normal cleanup (tmux stays alive)
  process.on('SIGTERM', () => {
    log.info('start', 'SIGTERM received, shutting down services (tmux stays alive)');
    attachProcess?.kill('SIGTERM');
  });

  // Small delay to let attach take over terminal
  await new Promise(r => setTimeout(r, 100));

  // Send Claude command only on fresh start (skip in reattach mode)
  if (!options?.reattach || !sessionExists) {
    const claudePath = findClaudePath();
    const continueFlag = options?.continue ? ' --continue' : '';
    const modelFlag = options?.model ? ` --model ${options.model}` : '';

    // Permission flags: god mode bypasses all permissions, default is normal userland (interactive approval)
    const permissionFlags = options?.godMode
      ? ' --dangerously-skip-permissions'
      : '';

    // TX_CORE_SESSION=1 enables hook to mark messages as seen after display
    tmux.send(`clear && TX_CORE_SESSION=1 ${claudePath}${permissionFlags}${continueFlag}${modelFlag} --system-prompt "$(cat '${corePromptPath}')"`);
    tmux.sendEnter();
  }

  // Wait for detach
  await attachPromise;

  // Cleanup
  console.log('\n[core] Detached from session.');

  // Stop self-healing components
  clearInterval(statusHeartbeat);
  if (injectionPollTimer) clearInterval(injectionPollTimer);
  if (systemErrorPollTimer) clearInterval(systemErrorPollTimer);
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

  // Clean shutdown - reset status.json so status bar shows IDLE
  try {
    const statusPath = path.join(dataDir, 'status.json');
    const cleanStatus = {
      meshes: {},
      workers: [],
      pendingAsks: 0,
      pendingQueue: {},
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(statusPath, JSON.stringify(cleanStatus, null, 2));
    log.info('start', 'status.json reset on shutdown');
  } catch {
    // Non-fatal
  }

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

  // Clean shutdown - reset status.json
  const dataDir = path.join(cwd, '.ai', 'tx', 'data');
  try {
    const statusPath = path.join(dataDir, 'status.json');
    const cleanStatus = {
      meshes: {},
      workers: [],
      pendingAsks: 0,
      pendingQueue: {},
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(statusPath, JSON.stringify(cleanStatus, null, 2));
  } catch {
    // Non-fatal
  }

  // Clean shutdown - remove PID file
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

/**
 * tx restart - Stop services gracefully, reattach to existing tmux/Claude session
 *
 * Responsibilities:
 * - Send SIGTERM to running tx process via PID file
 * - Wait for clean exit (poll, force kill as fallback)
 * - Start fresh services with reattach mode
 */
export async function restart(workDir?: string, options?: StartOptions): Promise<void> {
  const cwd = workDir || process.env.TX_CWD || process.cwd();
  const dataDir = path.join(cwd, '.ai', 'tx', 'data');
  const pidFile = path.join(dataDir, '.pid');

  // 1. Stop running process gracefully
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0); // Check alive
      console.log(`[restart] Sending SIGTERM to TX process (PID ${pid})...`);
      process.kill(pid, 'SIGTERM');

      // Wait for process to exit (poll up to 10s)
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise(r => setTimeout(r, 200));
      }

      // Force kill if still alive
      try {
        process.kill(pid, 0);
        console.error(`[restart] Old process didn't exit. Force killing...`);
        process.kill(pid, 'SIGKILL');
        await new Promise(r => setTimeout(r, 500));
      } catch { /* gone */ }
    } catch {
      console.log(`[restart] No running TX process found (stale PID file)`);
    }
    // Clean up PID file if still present
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } else {
    console.log(`[restart] No PID file found, starting fresh`);
  }

  // 2. Start with reattach mode
  await start(workDir, { ...options, reattach: true });
}


// Note: msg.type is vestigial ('message' for all new messages). Routing context derives from payload fields.
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


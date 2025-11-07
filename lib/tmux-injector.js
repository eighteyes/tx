const { execSync } = require('child_process');
const path = require('path');
const { Logger } = require('./logger');

class TmuxInjector {
  // Per-session injection queues: Map<sessionName, { queue: [], processing: boolean }>
  static injectionQueues = new Map();

  /**
   * Inject a file path into a tmux session (Claude Code @ attachment)
   * Now queues the injection and waits for session to be idle
   * @param {string} session - Session name
   * @param {string} filepath - Path to file
   * @param {boolean} isPrompt - If true, prepends "Read and follow instructions:" to injection
   */
  static injectFile(session, filepath, isPrompt = false) {
    // Add to injection queue with isPrompt flag
    TmuxInjector._enqueueInjection(session, 'file', { filepath, isPrompt });
    return true;
  }

  /**
   * Actually perform the file injection (internal method)
   * @param {string} session - Session name
   * @param {object} data - Injection data { filepath, isPrompt }
   */
  static _doInjectFile(session, data) {
    try {
      const { filepath, isPrompt } = data;
      const absolutePath = path.resolve(filepath);

      // Send @ key to open file browser
      // execSync(`tmux send-keys -t ${session} @`, { stdio: 'pipe' });
      // TmuxInjector._sleep(500);

      // Use tmux paste buffer for file paths to avoid truncation
      // This handles long paths and special characters correctly
      const bufferName = '_filepath_buffer';

      // Prepend instruction text ONLY for prompts
      const injectionText = isPrompt
        ? `Read and follow instructions: @${absolutePath.replace(/'/g, "'\\''")}`
        : `@${absolutePath.replace(/'/g, "'\\''")}`;

      execSync(`tmux set-buffer -b ${bufferName} '${injectionText}'`, { stdio: 'pipe' });
      execSync(`tmux paste-buffer -t ${session} -b ${bufferName}`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Send Enter
      execSync(`tmux send-keys -t ${session} Enter`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Log file injection with full path
      Logger.log('tmux-injector', `File injected${isPrompt ? ' (as prompt)' : ''}: ${absolutePath}`, {
        session,
        filepath: absolutePath,
        isPrompt
      });

      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to inject file: ${error.message}`, {
        session,
        filepath: data.filepath,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Add injection to queue and process if idle
   */
  static _enqueueInjection(session, type, data) {
    if (!TmuxInjector.injectionQueues.has(session)) {
      TmuxInjector.injectionQueues.set(session, {
        queue: [],
        processing: false,
        sequenceNumber: 0
      });
    }

    const queueState = TmuxInjector.injectionQueues.get(session);
    const injection = {
      type,
      data,
      sequenceNumber: queueState.sequenceNumber++,
      timestamp: Date.now()
    };

    queueState.queue.push(injection);
    Logger.log('tmux-injector', `Queued ${type} injection for ${session} [seq: ${injection.sequenceNumber}] (queue length: ${queueState.queue.length})`);

    // Try to process queue
    TmuxInjector._processInjectionQueue(session);
  }

  /**
   * Process next injection in queue (with idle waiting)
   */
  static async _processInjectionQueue(session) {
    const queueState = TmuxInjector.injectionQueues.get(session);

    if (!queueState) {
      return;
    }

    // If already processing, don't start another
    if (queueState.processing) {
      return;
    }

    // If queue is empty, nothing to do
    if (queueState.queue.length === 0) {
      return;
    }

    // Check if session exists
    if (!TmuxInjector.sessionExists(session)) {
      Logger.warn('tmux-injector', `Session ${session} not found, injections will wait`);
      return;
    }

    // Mark as processing
    queueState.processing = true;

    // Get next injection (FIFO)
    const injection = queueState.queue.shift();

    Logger.log('tmux-injector', `Processing ${injection.type} injection for ${session} (${queueState.queue.length} remaining)`);

    // Perform the injection
    let success = false;
    if (injection.type === 'file') {
      success = TmuxInjector._doInjectFile(session, injection.data);
    } else if (injection.type === 'command') {
      success = TmuxInjector._doInjectCommand(session, injection.data);
    } else if (injection.type === 'text') {
      success = TmuxInjector._doInjectText(session, injection.data);
    }

    // Wait for session to be idle before processing next injection
    setTimeout(async () => {
      try {
        // Wait for idle (2 seconds of no output, max 60 second wait)
        const isIdle = await TmuxInjector.waitForIdle(session, 2000, 60000);

        if (isIdle) {
          Logger.log('tmux-injector', `Session ${session} is idle after injection`);
        } else {
          Logger.warn('tmux-injector', `Session ${session} did not become idle within timeout`);
        }
      } catch (error) {
        Logger.error('tmux-injector', `Error waiting for idle: ${error.message}`);
      } finally {
        // Mark as not processing
        queueState.processing = false;

        // Process next injection if queue has more
        if (queueState.queue.length > 0) {
          TmuxInjector._processInjectionQueue(session);
        }
      }
    }, 100); // Small delay to let injection complete
  }

  /**
   * Inject a command into a tmux session (Claude Code / prefix)
   * Now queues the injection
   */
  static injectCommand(session, command) {
    TmuxInjector._enqueueInjection(session, 'command', command);
    return true;
  }

  /**
   * Actually perform the command injection (internal method)
   */
  static _doInjectCommand(session, command) {
    try {
      // Send / to open command palette
      execSync(`tmux send-keys -t ${session} /`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Send command (escape single quotes)
      const escapedCmd = command.replace(/'/g, "'\\''");
      execSync(`tmux send-keys -t ${session} '${escapedCmd}'`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Send Enter
      execSync(`tmux send-keys -t ${session} Enter`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Log important commands only
      Logger.log('tmux-injector', `Command: ${command}`, { session });

      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to inject command: ${error.message}`, {
        session,
        command,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Inject raw text directly (for large prompts)
   * Now queues the injection
   */
  static injectText(session, text) {
    TmuxInjector._enqueueInjection(session, 'text', text);
    return true;
  }

  /**
   * Actually perform the text injection (internal method)
   */
  static _doInjectText(session, text) {
    try {
      const chunkSize = 2000;
      const chunks = [];

      for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
      }

      chunks.forEach((chunk, index) => {
        const escapedChunk = chunk
          .replace(/'/g, "'\\''")
          .replace(/\$/g, '\\$')
          .replace(/`/g, '\\`');

        execSync(`tmux send-keys -t ${session} '${escapedChunk}'`, { stdio: 'pipe' });
        TmuxInjector._sleep(500);

        if (index < chunks.length - 1) {
          // Send newline between chunks
          execSync(`tmux send-keys -t ${session} Enter`, { stdio: 'pipe' });
          TmuxInjector._sleep(500);
        }
      });

      // Always send Enter at the end to execute the text
      execSync(`tmux send-keys -t ${session} Enter`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Create truncated preview of the text
      const maxPreviewLength = 100;
      const preview = text.length <= maxPreviewLength
        ? text.replace(/\n/g, '\\n')  // Replace newlines for compact display
        : text.slice(0, maxPreviewLength).replace(/\n/g, '\\n') + '...';

      Logger.log('tmux-injector', `Text injected: "${preview}"`, {
        session,
        textLength: text.length,
        chunks: chunks.length
      });

      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to inject text: ${error.message}`, {
        session,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Send raw tmux command
   */
  static send(session, keys) {
    try {
      execSync(`tmux send-keys -t ${session} '${keys}'`, { stdio: 'pipe' });
      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to send keys: ${error.message}`, {
        session,
        keys
      });
      return false;
    }
  }

  /**
   * Sleep helper (non-blocking)
   */
  static _sleep(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Busy wait (or use Atomics.wait for better performance)
    }
  }

  /**
   * Check if session exists
   */
  static sessionExists(session) {
    try {
      execSync(`tmux list-sessions -F '#{session_name}' | grep -q '^${session}$'`, {
        stdio: 'pipe'
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create new tmux session and optionally load config
   * @param {string} session - Session name
   * @param {string} command - Command to run (default: bash)
   * @param {boolean} loadConfig - Whether to load .tmux.conf
   */
  static createSession(session, command = null, loadConfig = true) {
    try {
      // Build tmux command
      let tmuxCmd = 'tmux new-session -d -s ' + session;

      // Add command if provided
      if (command) {
        tmuxCmd += ` '${command}'`;
      }

      execSync(tmuxCmd, { stdio: 'pipe' });

      Logger.log('tmux-injector', 'Session created', {
        session
      });

      // Load config if requested and .tmux.conf exists
      if (loadConfig) {
        TmuxInjector.loadConfig(session);
      }

      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to create session: ${error.message}`, {
        session,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Load .tmux.conf configuration for a session
   */
  static loadConfig(session, configPath = '.tmux.conf') {
    try {
      const fs = require('fs-extra');

      // Check if config exists (relative to current working directory)
      if (!fs.existsSync(configPath)) {
        Logger.warn('tmux-injector', `Config file not found: ${configPath}`);
        return false;
      }

      // Source the config file in the session using relative path
      execSync(`tmux source-file '${configPath}'`, { stdio: 'pipe' });

      Logger.log('tmux-injector', 'Config loaded', {
        session,
        configPath
      });

      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to load config: ${error.message}`, {
        session,
        configPath,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Kill a tmux session
   */
  static killSession(session) {
    try {
      execSync(`tmux kill-session -t ${session}`, { stdio: 'pipe' });
      Logger.log('tmux-injector', 'Session killed', { session });
      return true;
    } catch (error) {
      Logger.warn('tmux-injector', `Session not found or already killed: ${session}`);
      return false;
    }
  }

  /**
   * Wait for Claude Code to be ready by checking for bypass permissions message
   * Looks for "⏵⏵ bypass permissions on" which signals Claude has started
   *
   * @returns {object} { ready: boolean, gate: string|null }
   *   - ready: true if Claude is ready, false otherwise
   *   - gate: null if ready, or 'initial-config' / 'bypass-permissions' if blocked
   */
  static async claudeReadyCheck(session, timeout = 30000, pollInterval = 500) {
    const startTime = Date.now();

    Logger.log('tmux-injector', 'Waiting for Claude to be ready...', { session });

    while (Date.now() - startTime < timeout) {
      try {
        // Capture pane output
        const output = execSync(`tmux capture-pane -t ${session} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Gate 1: Check for initial configuration screen
        if (output.includes('Dark mode') || output.includes('Claude account with subscription')) {
          Logger.warn('tmux-injector', 'Claude initial configuration required', { session });
          return { ready: false, gate: 'initial-config' };
        }

        // Gate 2: Check for bypass permissions warning
        if (output.includes('WARNING: Claude Code running in Bypass Permissions mode')) {
          Logger.warn('tmux-injector', 'Claude bypass permissions acceptance required', { session });
          return { ready: false, gate: 'bypass-permissions' };
        }

        // Check for Claude ready indicator
        // Look for bypass message and the separator line pattern
        if (output.includes('⏵⏵ bypass permissions on') &&
            output.match(/─{10,}/)) {
          Logger.log('tmux-injector', 'Claude is ready', {
            session,
            waitTime: Date.now() - startTime
          });
          return { ready: true, gate: null };
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        Logger.error('tmux-injector', `Error checking Claude readiness: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    Logger.error('tmux-injector', 'Claude readiness timeout', {
      session,
      timeout
    });
    return { ready: false, gate: null };
  }

  /**
   * Wait for session to be idle (no output changes)
   * Checks if pane content hasn't changed for the specified idle time
   */
  static async waitForIdle(session, idleTime = 1000, timeout = 10000, pollInterval = 200) {
    const startTime = Date.now();
    let lastOutput = '';
    let lastChangeTime = Date.now();

    Logger.log('tmux-injector', 'Waiting for session to be idle...', { session, idleTime });

    while (Date.now() - startTime < timeout) {
      try {
        // Capture current pane output
        const output = execSync(`tmux capture-pane -t ${session} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Check if output has changed
        if (output !== lastOutput) {
          lastOutput = output;
          lastChangeTime = Date.now();
        }

        // Check if we've been idle long enough
        const idleDuration = Date.now() - lastChangeTime;
        if (idleDuration >= idleTime) {
          Logger.log('tmux-injector', 'Session is idle', {
            session,
            idleDuration,
            totalWaitTime: Date.now() - startTime
          });
          return true;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        Logger.error('tmux-injector', `Error checking idle state: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    Logger.warn('tmux-injector', 'Idle wait timeout', {
      session,
      timeout
    });
    return false;
  }

  /**
   * Check if user is actively typing in session
   * Returns true if pane content has changed recently
   * @param {string} session - Session name
   * @param {number} recentThreshold - Time in ms to consider "recent" (default 3000ms)
   * @returns {Promise<boolean>} True if user appears to be typing
   */
  static async isUserTyping(session, recentThreshold = 3000) {
    try {
      // Capture pane content twice with small delay
      const output1 = execSync(`tmux capture-pane -t ${session} -p`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      });

      // Wait a bit to see if content changes
      await new Promise(resolve => setTimeout(resolve, 500));

      const output2 = execSync(`tmux capture-pane -t ${session} -p`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      });

      // If content changed in last 500ms, user is likely typing
      if (output1 !== output2) {
        Logger.log('tmux-injector', `User typing detected: ${session}`);
        return true;
      }

      return false;
    } catch (error) {
      Logger.warn('tmux-injector', `Error checking user typing: ${error.message}`);
      // If we can't check, assume user might be typing (safer to wait)
      return true;
    }
  }

  /**
   * List active sessions
   */
  static listSessions() {
    try {
      const output = execSync(`tmux list-sessions -F '#{session_name}'`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      return output.trim().split('\n').filter(s => s.length > 0);
    } catch (error) {
      return [];
    }
  }
}

module.exports = { TmuxInjector };

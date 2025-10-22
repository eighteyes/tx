const { execSync } = require('child_process');
const path = require('path');
const { Logger } = require('./logger');

class TmuxInjector {
  /**
   * Inject a file path into a tmux session (Claude Code @ attachment)
   * Simulates: @ → sleep 0.5 → filepath → sleep 0.5 → Enter
   */
  static injectFile(session, filepath) {
    try {
      const absolutePath = path.resolve(filepath);

      // Send @ key to open file browser
      execSync(`tmux send-keys -t ${session} @`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Send filepath
      execSync(`tmux send-keys -t ${session} '${absolutePath}'`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Send Enter
      execSync(`tmux send-keys -t ${session} Enter`, { stdio: 'pipe' });
      TmuxInjector._sleep(500);

      // Log file injection with full path
      Logger.log('tmux-injector', `File injected: ${absolutePath}`, {
        session,
        filepath: absolutePath
      });

      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to inject file: ${error.message}`, {
        session,
        filepath,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Inject a command into a tmux session (Claude Code / prefix)
   * Simulates: / → sleep 0.5 → command → sleep 0.5 → Enter
   */
  static injectCommand(session, command) {
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
   * Splits into 2000 char chunks to avoid tmux limits
   */
  static injectText(session, text) {
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
   * @param {string} mesh - Mesh name (sets TX_MESH environment variable)
   * @param {string} agent - Agent name (sets TX_AGENT environment variable)
   */
  static createSession(session, command = null, loadConfig = true, mesh = null, agent = null) {
    try {
      // Build tmux command with environment variables
      let tmuxCmd = 'tmux new-session -d -s ' + session;

      // Add environment variables if provided
      if (mesh) {
        tmuxCmd += ` -e TX_MESH=${mesh}`;
      }
      if (agent) {
        tmuxCmd += ` -e TX_AGENT=${agent}`;
      }

      // Add command if provided
      if (command) {
        tmuxCmd += ` '${command}'`;
      }

      execSync(tmuxCmd, { stdio: 'pipe' });

      Logger.log('tmux-injector', 'Session created', {
        session,
        mesh: mesh || null,
        agent: agent || null
      });

      // Load config if requested and .tmux.conf exists
      if (loadConfig) {
        TmuxInjector.loadConfig(session);
      }

      return true;
    } catch (error) {
      Logger.error('tmux-injector', `Failed to create session: ${error.message}`, {
        session,
        mesh: mesh || null,
        agent: agent || null,
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

        // Check for Claude ready indicator
        // Look for bypass message and the separator line pattern
        if (output.includes('⏵⏵ bypass permissions on') &&
            output.match(/─{10,}/)) {
          Logger.log('tmux-injector', 'Claude is ready', {
            session,
            waitTime: Date.now() - startTime
          });
          return true;
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
    return false;
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

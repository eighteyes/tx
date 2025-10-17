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

      Logger.log('tmux-injector', 'File injected', {
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

      Logger.log('tmux-injector', 'Command injected', {
        session,
        command
      });

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
        TmuxInjector._sleep(100);

        if (index < chunks.length - 1) {
          // Send newline between chunks
          execSync(`tmux send-keys -t ${session} Enter`, { stdio: 'pipe' });
          TmuxInjector._sleep(100);
        }
      });

      Logger.log('tmux-injector', 'Text injected', {
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
   * Create new tmux session
   */
  static createSession(session, command = null) {
    try {
      if (command) {
        execSync(`tmux new-session -d -s ${session} '${command}'`, { stdio: 'pipe' });
      } else {
        execSync(`tmux new-session -d -s ${session}`, { stdio: 'pipe' });
      }

      Logger.log('tmux-injector', 'Session created', { session });
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

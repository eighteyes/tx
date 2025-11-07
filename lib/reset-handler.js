const path = require('path');
const fs = require('fs-extra');
const { Logger } = require('./logger');
const { TmuxInjector } = require('./tmux-injector');

/**
 * ResetHandler - Reusable reset logic for clearing agent sessions
 *
 * Provides utilities for resetting agent sessions by:
 * 1. Clearing the session (/clear command)
 * 2. Finding the most recent prompt message
 * 3. Re-injecting the prompt to restore agent context
 */
class ResetHandler {
  /**
   * Reset a single agent session
   *
   * @param {string} sessionName - Tmux session name
   * @param {string} agentName - Agent name for finding prompt
   * @param {object} options - Optional configuration
   * @param {boolean} options.silent - Suppress console output (default: false)
   * @returns {Promise<boolean>} Success status
   */
  static async resetSession(sessionName, agentName, options = {}) {
    const silent = options.silent || false;

    try {
      // Step 1: Check if session exists
      if (!TmuxInjector.sessionExists(sessionName)) {
        const errorMsg = `Session not found: ${sessionName}`;
        if (!silent) {
          Logger.warn('reset-handler', errorMsg, { sessionName, agentName });
        }
        return false;
      }

      // Step 2: Inject /clear command
      if (!silent) {
        Logger.log('reset-handler', 'Clearing session', { sessionName, agentName });
      }
      TmuxInjector.injectCommand(sessionName, 'clear');

      // Wait for clear to complete
      await TmuxInjector.waitForIdle(sessionName, 2000, 10000);

      // Step 3: Find most recent prompt message
      const promptPath = ResetHandler.findPromptMessage(agentName);

      if (!promptPath) {
        const errorMsg = `No prompt message found for agent: ${agentName}`;
        if (!silent) {
          Logger.warn('reset-handler', errorMsg, { sessionName, agentName });
        }
        return false;
      }

      // Step 4: Re-inject prompt
      if (!silent) {
        Logger.log('reset-handler', 'Re-injecting prompt', {
          sessionName,
          agentName,
          promptPath
        });
      }
      TmuxInjector.injectFile(sessionName, promptPath, true);

      // Wait for injection to complete
      await TmuxInjector.waitForIdle(sessionName, 2000, 10000);

      if (!silent) {
        Logger.log('reset-handler', 'Session reset complete', {
          sessionName,
          agentName
        });
      }

      return true;

    } catch (error) {
      const errorMsg = `Failed to reset session: ${error.message}`;
      if (!silent) {
        Logger.error('reset-handler', errorMsg, {
          sessionName,
          agentName,
          error: error.stack
        });
      }
      return false;
    }
  }

  /**
   * Find most recent prompt message for agent
   *
   * @param {string} agentName - Agent name
   * @returns {string|null} Prompt file path or null if not found
   */
  static findPromptMessage(agentName) {
    const msgsDir = '.ai/tx/msgs';

    if (!fs.existsSync(msgsDir)) {
      Logger.warn('reset-handler', `Messages directory not found: ${msgsDir}`);
      return null;
    }

    try {
      // Find most recent prompt message for this agent
      // Pattern: *-prompt-system>{agent}-*.md
      const files = fs.readdirSync(msgsDir);
      const promptMessages = files
        .filter(f => f.includes(`-prompt-system>${agentName}-`))
        .sort()
        .reverse(); // Most recent first

      if (promptMessages.length === 0) {
        Logger.warn('reset-handler', `No prompt messages found for agent`, {
          agentName,
          pattern: `*-prompt-system>${agentName}-*.md`,
          directory: msgsDir
        });
        return null;
      }

      const lastPromptFile = promptMessages[0];
      const promptPath = path.resolve(msgsDir, lastPromptFile);

      Logger.log('reset-handler', 'Found prompt message', {
        agentName,
        promptFile: lastPromptFile,
        promptPath
      });

      return promptPath;

    } catch (error) {
      Logger.error('reset-handler', `Error finding prompt message: ${error.message}`, {
        agentName,
        error: error.stack
      });
      return null;
    }
  }

  /**
   * Get session name from mesh and agent names
   * Uses same logic as spawn command
   *
   * @param {string} mesh - Mesh name or mesh instance ID
   * @param {string} agentName - Agent name
   * @returns {string} Session name
   */
  static getSessionName(mesh, agentName) {
    // Handle core/core -> core
    if (mesh === 'core' && agentName === 'core') {
      return 'core';
    }

    // Handle mesh/mesh -> mesh (persistent meshes)
    if (mesh === agentName) {
      return mesh;
    }

    // Handle standard pattern: {mesh}-{agent}
    return `${mesh}-${agentName}`;
  }
}

module.exports = { ResetHandler };

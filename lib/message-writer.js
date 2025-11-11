const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { RearmatterSchema } = require('./rearmatter-schema');
const { AgentPath } = require('./utils/agent-path');
const { StateManager } = require('./state-manager');

/**
 * MessageWriter - Centralized event log message writing
 *
 * Writes messages to both:
 * 1. NEW: Central event log at .ai/tx/msgs/
 * 2. OLD: Stay-in-place at .ai/tx/mesh/{mesh}/agents/{agent}/msgs/
 *
 * Dual-write mode ensures backward compatibility during migration.
 */
class MessageWriter {
  /**
   * Write a message to the event log (and optionally dual-write to old location)
   *
   * @param {string} from - Source agent (e.g., 'core/core' or 'research-807055/interviewer')
   * @param {string} to - Destination agent (e.g., 'core/core' or 'research-807055/interviewer')
   * @param {string} type - Message type (task, ask, ask-response, task-complete, etc.)
   * @param {string} msgId - Unique message ID
   * @param {string} content - Message body content
   * @param {object} frontmatter - Additional frontmatter metadata
   * @param {object} options - Options: { dualWrite: boolean, oldPath: string }
   * @returns {string} Path to the event log message file
   */
  static async write(from, to, type, msgId, content, frontmatter = {}, options = {}) {
    const timestamp = new Date().toISOString();
    const filename = this.buildFilename(timestamp, from, to, type, msgId);
    const eventLogPath = path.join('.ai/tx/msgs', filename);

    // Ensure event log directory exists
    await fs.ensureDir('.ai/tx/msgs');

    // Detect and validate rearmatter if present
    const { content: mainContent, rearmatter: rearmatterYaml } = RearmatterSchema.extractFromMessage(content);

    if (rearmatterYaml) {
      // Validate rearmatter (non-strict mode - warnings only)
      const validation = RearmatterSchema.parse(rearmatterYaml, { strict: false });

      if (!validation.valid) {
        Logger.warn('message-writer', 'Invalid rearmatter detected', {
          from,
          to,
          msgId,
          errors: validation.errors,
          warnings: validation.warnings
        });
      } else if (validation.warnings.length > 0) {
        Logger.warn('message-writer', 'Rearmatter validation warnings', {
          from,
          to,
          msgId,
          warnings: validation.warnings
        });
      } else {
        Logger.log('message-writer', 'Valid rearmatter detected', {
          from,
          to,
          msgId,
          requiresSections: validation.requiresSections
        });
      }
    }

    // Build complete frontmatter
    const completeFrontmatter = {
      to,
      from,
      type,
      'msg-id': msgId,
      timestamp,
      ...frontmatter
    };

    // Build message content (use original content to preserve rearmatter)
    const message = this.formatMessage(completeFrontmatter, content);

    // Write to central event log
    await fs.writeFile(eventLogPath, message);

    Logger.log('message-writer', 'Message written to event log', {
      from,
      to,
      type,
      msgId,
      filepath: eventLogPath,
      hasRearmatter: !!rearmatterYaml
    });

    // Update sender's activity timestamp
    try {
      StateManager.updateActivity(from);
    } catch (error) {
      // Agent might not be tracked yet, ignore
      Logger.warn('message-writer', `Failed to update activity for ${from}`, {
        error: error.message
      });
    }

    // Detect state transitions based on message type
    try {
      // BLOCKED: Agent sending ask-human message
      if (type === 'ask-human') {
        StateManager.transitionState(from, StateManager.STATES.BLOCKED);
        Logger.log('message-writer', `Agent ${from} transitioned to BLOCKED (ask-human sent)`);
      }

      // COMPLETING: Agent sending task-complete message
      if (type === 'task-complete') {
        StateManager.transitionState(from, StateManager.STATES.COMPLETING);
        Logger.log('message-writer', `Agent ${from} transitioned to COMPLETING (task-complete sent)`);
      }
    } catch (error) {
      // State transition might fail if invalid, just log
      Logger.warn('message-writer', `State transition failed for ${from}`, {
        type,
        error: error.message
      });
    }

    // DUAL-WRITE: Also write to old location for backward compatibility
    if (options.dualWrite && options.oldPath) {
      try {
        await fs.ensureDir(path.dirname(options.oldPath));
        await fs.writeFile(options.oldPath, message);
        Logger.log('message-writer', 'Dual-write to old location', {
          oldPath: options.oldPath
        });
      } catch (error) {
        Logger.warn('message-writer', `Dual-write failed: ${error.message}`, {
          oldPath: options.oldPath
        });
      }
    }

    return eventLogPath;
  }

  /**
   * Build filename from message components
   * Format: {MMDDHHMMSS}-{type}-{from-agent}>{to-agent}-{msg-id}.md
   *
   * Uses only agent names (part after /) to avoid ambiguity with dashes
   * Example: 1103191949-task-core>asker-a1b2c3.md
   * Example: 1103191949-task-interviewer>core-qfj7x.md
   */
  static buildFilename(timestamp, from, to, type, msgId) {
    // Format timestamp as MMDDHHMMSS
    const date = new Date(timestamp);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ts = `${mm}${dd}${hh}${min}${ss}`;

    // Extract only the agent name (part after /)
    const fromAgent = AgentPath.extractName(from);
    const toAgent = AgentPath.extractName(to);

    return `${ts}-${type}-${fromAgent}>${toAgent}-${msgId}.md`;
  }

  /**
   * Format message with frontmatter and content
   */
  static formatMessage(frontmatter, content) {
    const yaml = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    return `---\n${yaml}\n---\n\n${content}`;
  }

  /**
   * Parse event log filename to extract components
   * Format: {MMDDHHMMSS}-{type}-{from-agent}>{to-agent}-{msgId}.md
   *
   * Note: Filenames contain only agent names (part after /), not full mesh/agent paths
   * Examples:
   * - 1103191949-task-core>asker-a1b2c3.md
   * - 1103191949-ask-interviewer>core-xyz789.md
   *
   * @param {string} filename - Event log filename
   * @returns {object} Parsed components: { timestamp, from, to, type, msgId }
   */
  static parseFilename(filename) {
    // Remove .md extension
    const base = filename.replace('.md', '');

    // Extract timestamp (first 10 digits) and the rest
    const match = base.match(/^(\d{10})-([^-]+)-([^>]+)>([^-]+)-(.+)$/);
    if (!match) {
      throw new Error(`Invalid event log filename format: ${filename}`);
    }

    const [, ts, type, from, to, msgId] = match;

    // Parse timestamp MMDDHHMMSS
    const mm = ts.substring(0, 2);
    const dd = ts.substring(2, 4);
    const hh = ts.substring(4, 6);
    const min = ts.substring(6, 8);
    const ss = ts.substring(8, 10);

    // Build ISO timestamp (use current year as we don't store it)
    const year = new Date().getFullYear();
    const timestamp = `${year}-${mm}-${dd}T${hh}:${min}:${ss}.000Z`;

    return {
      timestamp,
      from,
      to,
      type,
      msgId
    };
  }
}

module.exports = { MessageWriter };

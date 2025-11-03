const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');

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

    // Build complete frontmatter
    const completeFrontmatter = {
      to,
      from,
      type,
      'msg-id': msgId,
      timestamp,
      ...frontmatter
    };

    // Build message content
    const message = this.formatMessage(completeFrontmatter, content);

    // Write to central event log
    await fs.writeFile(eventLogPath, message);

    Logger.log('message-writer', 'Message written to event log', {
      from,
      to,
      type,
      msgId,
      filepath: eventLogPath
    });

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
   * Format: {MMDDHHMMSS}-{from-agent}-{to-agent}-{type}-{msg-id}.md
   *
   * Example: 1102083000-core-core-research-807055-interviewer-task-4f7a.md
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

    // Clean agent names (replace slashes with dashes)
    const fromClean = from.replace(/\//g, '-');
    const toClean = to.replace(/\//g, '-');

    return `${ts}-${fromClean}-${toClean}-${type}-${msgId}.md`;
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
   *
   * @param {string} filename - Event log filename
   * @returns {object} Parsed components: { timestamp, from, to, type, msgId }
   */
  static parseFilename(filename) {
    // Remove .md extension
    const base = filename.replace('.md', '');

    // Split by dashes
    const parts = base.split('-');

    // First part is timestamp: MMDDHHMMSS (10 digits)
    if (parts.length < 5) {
      throw new Error(`Invalid event log filename format: ${filename}`);
    }

    // Parse timestamp MMDDHHMMSS
    const ts = parts[0];
    if (ts.length !== 10) {
      throw new Error(`Invalid timestamp format in filename: ${filename}`);
    }

    const mm = ts.substring(0, 2);
    const dd = ts.substring(2, 4);
    const hh = ts.substring(4, 6);
    const min = ts.substring(6, 8);
    const ss = ts.substring(8, 10);

    // Build ISO timestamp (use current year as we don't store it)
    const year = new Date().getFullYear();
    const timestamp = `${year}-${mm}-${dd}T${hh}:${min}:${ss}.000Z`;

    // Find type and msgId (last 2 parts)
    const msgId = parts[parts.length - 1];
    const type = parts[parts.length - 2];

    // Everything between timestamp and type is from/to
    const fromToType = parts.slice(1, -2);

    // Simple heuristic: split in half (this works for most cases)
    // For more complex parsing, we'd need to track mesh/agent naming conventions
    const midpoint = Math.floor(fromToType.length / 2);
    const from = fromToType.slice(0, midpoint).join('-');
    const to = fromToType.slice(midpoint).join('-');

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

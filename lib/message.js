const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { randomUUID } = require('crypto');
const { SimpleWatcher } = require('./watcher');
const { AgentPath } = require('./utils/agent-path');

/**
 * Generate timestamp-based filename suffix
 * Format: MMDDHHMMSS
 */
function generateTimestamp() {
  const now = new Date();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const SS = String(now.getSeconds()).padStart(2, '0');
  return `${MM}${DD}${HH}${mm}${SS}`;
}

/**
 * Sanitize filename - remove special characters
 */
function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 30);
}

class Message {
  /**
   * Send a message to a mesh/agent
   * Creates a file with frontmatter at: .ai/tx/msgs/{mmddhhmmss}-{type}-{from}>{to}-{msgId}.md
   */
  static send(toAgent, task, context = '', metadata = {}) {
    const timestamp = generateTimestamp();

    // Generate message ID
    const messageId = metadata['msg-id'] || Math.random().toString(36).slice(2, 8);

    // Determine from/to agent names (extract only agent name, part after /)
    const fromAgent = metadata.from ? AgentPath.extractName(metadata.from) : 'user';
    const toAgentOnly = AgentPath.extractName(toAgent);

    // Create frontmatter
    const frontmatter = {
      from: metadata.from || 'user',
      to: toAgent,
      type: metadata.type || 'task',
      status: metadata.status || 'start',
      'msg-id': messageId,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    // Build filename: {mmddhhmmss}-{type}-{from}>{to}-{msgId}.md
    // Uses only agent names (part after /) to avoid ambiguity
    // Examples: core, ping, interviewer
    const type = frontmatter.type;
    const filename = `${timestamp}-${type}-${fromAgent}>${toAgentOnly}-${messageId}.md`;

    // Centralized directory
    const msgsDir = `.ai/tx/msgs`;
    const filepath = path.join(msgsDir, filename);

    // Ensure directory exists
    fs.ensureDirSync(msgsDir);

    // Build frontmatter string
    const frontmatterStr = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    // Build full message content
    const content = `---
${frontmatterStr}
---

# ${task}

${context}`;

    // Write file
    fs.writeFileSync(filepath, content);

    Logger.log('message', 'Message sent', {
      to: toAgent,
      messageId,
      filepath,
      task
    });

    return {
      id: messageId,
      filepath,
      filename
    };
  }

  /**
   * Validate frontmatter metadata
   * Validates schema only - status validation is done by Routing.validateRoute()
   * Throws error if validation fails
   */
  static validateFrontmatter(metadata) {
    const required = ['from', 'to', 'type', 'status', 'timestamp'];
    const validTypes = ['task', 'task-complete', 'ask', 'ask-response', 'update', 'prompt', 'git-worktree', 'git-merge', 'git-conflict'];
    const msgIdRequiredTypes = ['task', 'ask'];

    // Check required fields
    for (const field of required) {
      if (!metadata[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate type enum
    if (!validTypes.includes(metadata.type)) {
      throw new Error(`Invalid type: ${metadata.type}. Must be one of: ${validTypes.join(', ')}`);
    }

    // NOTE: Status validation is intentionally NOT done here.
    // Status values are mesh-specific and defined in routing tables.
    // Use Routing.validateRoute() for status validation against mesh config.

    // msg-id is required for task and ask types
    if (msgIdRequiredTypes.includes(metadata.type) && !metadata['msg-id']) {
      throw new Error(`Missing required field: msg-id (required for ${metadata.type} messages)`);
    }

    // Validate 'to' format (should be mesh/agent, agent, or mesh)
    const toField = metadata.to;
    if (!toField.match(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/i)) {
      throw new Error(`Invalid 'to' format: ${toField}. Must be mesh/agent, agent, or mesh`);
    }

    // Validate 'from' format (should be mesh/agent, agent name, or 'user')
    const fromField = metadata.from;
    if (fromField !== 'user' && !fromField.match(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/i)) {
      throw new Error(`Invalid 'from' format: ${fromField}. Must be mesh/agent, agent, or 'user'`);
    }

    return true;
  }

  /**
   * Parse a message file
   * Returns { metadata, content }
   */
  static parseMessage(filepath) {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Message file not found: ${filepath}`);
    }

    const content = fs.readFileSync(filepath, 'utf-8');
    const parts = content.split('---');

    if (parts.length < 3) {
      throw new Error(`Invalid message format (missing frontmatter): ${filepath}`);
    }

    // Parse frontmatter
    const frontmatterStr = parts[1].trim();
    const metadata = {};

    frontmatterStr.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        metadata[key.trim()] = valueParts.join(':').trim();
      }
    });

    // Validate frontmatter (warn on failure but don't block delivery)
    try {
      Message.validateFrontmatter(metadata);
    } catch (error) {
      Logger.warn('message', `⚠️ Frontmatter validation failed (message will still be delivered): ${error.message}`, {
        filepath,
        metadata
      });
      // Don't throw - allow message delivery to proceed
    }

    // Extract body (everything after second ---)
    const body = parts.slice(2).join('---').trim();

    return {
      metadata,
      content: body,
      filepath,
      filename: path.basename(filepath)
    };
  }

  /**
   * Get all messages in centralized msgs directory
   * @param {string} filterAgent - Optional: filter by target agent name
   * @deprecated The meshDir parameter is deprecated - all messages are now centralized in .ai/tx/msgs/
   */
  static getMessages(filterAgent = null) {
    const msgsDir = `.ai/tx/msgs`;
    if (!fs.existsSync(msgsDir)) {
      return [];
    }

    let messages = fs
      .readdirSync(msgsDir)
      .filter(f => f.endsWith('.md') && !f.endsWith('-done.md'))
      .sort();

    // Filter by target agent if specified
    if (filterAgent) {
      // Pattern: {timestamp}-{type}-{from}>{to}-{msgId}.md
      const agentPattern = new RegExp(`>${filterAgent}-`);
      messages = messages.filter(f => agentPattern.test(f));
    }

    return messages;
  }

  /**
   * Mark a message as done (rename to *-done.md)
   * @deprecated Use SimpleQueue.completeMessage() instead
   */
  static moveMessage(filename, fromQueue = null, toQueue = null) {
    // For backwards compatibility, mark as done in centralized directory
    const msgsDir = `.ai/tx/msgs`;
    const msgPath = path.join(msgsDir, filename);
    const donePath = path.join(msgsDir, filename.replace('.md', '-done.md'));

    if (!fs.existsSync(msgPath)) {
      throw new Error(`Source message not found: ${msgPath}`);
    }

    SimpleWatcher.ignoreNextOperation(donePath);
    fs.renameSync(msgPath, donePath);

    Logger.log('message', `Message moved: ${fromQueue} → ${toQueue}`, {
      filename,
      from: fromQueue,
      to: toQueue
    });
  }

  /**
   * Remove a message
   */
  static removeMessage(filepath) {
    if (fs.existsSync(filepath)) {
      fs.removeSync(filepath);
      Logger.log('message', 'Message removed', { filepath });
    }
  }
}

module.exports = { Message };

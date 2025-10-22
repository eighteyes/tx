const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { randomUUID } = require('crypto');
const { SimpleWatcher } = require('./watcher');

/**
 * Generate timestamp-based filename suffix
 * Format: YYMMDDHHMM
 */
function generateTimestamp() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}${hh}${min}`;
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
   * Send a message to a mesh
   * Creates a file with frontmatter at: .ai/tx/mesh/{mesh}/msgs/{timestamp}-{name}.md
   */
  static send(mesh, task, context = '', metadata = {}) {
    const timestamp = generateTimestamp();
    const sanitizedTask = sanitizeName(task);
    const filename = `${timestamp}-${sanitizedTask}.md`;

    const meshDir = `.ai/tx/mesh/${mesh}`;
    const msgsDir = path.join(meshDir, 'msgs');
    const filepath = path.join(msgsDir, filename);

    // Ensure directory exists
    fs.ensureDirSync(msgsDir);

    // Generate message ID
    const messageId = `${mesh}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

    // Create frontmatter
    const frontmatter = {
      from: 'user',
      to: mesh,
      type: 'task',
      status: 'start',
      'msg-id': messageId,
      timestamp: new Date().toISOString(),
      ...metadata
    };

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
      mesh,
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
   * Throws error if validation fails
   */
  static validateFrontmatter(metadata) {
    const required = ['from', 'to', 'type', 'status', 'timestamp'];
    const validTypes = ['task', 'task-complete', 'ask', 'ask-response', 'update'];
    const validStatuses = ['start', 'in-progress', 'rejected', 'approved', 'complete'];
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

    // Validate status enum (per spec: start, in-progress, rejected, approved, complete)
    if (!validStatuses.includes(metadata.status)) {
      throw new Error(`Invalid status: ${metadata.status}. Must be one of: ${validStatuses.join(', ')}`);
    }

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
   * Get all messages in msgs directory
   * @deprecated The queue parameter is deprecated - all messages are now in msgs/
   */
  static getMessages(meshDir, queue = null) {
    const msgsDir = path.join(meshDir, 'msgs');
    if (!fs.existsSync(msgsDir)) {
      return [];
    }

    return fs
      .readdirSync(msgsDir)
      .filter(f => f.endsWith('.md') && !f.endsWith('-done.md'))
      .sort();
  }

  /**
   * Mark a message as done (rename to *-done.md)
   * @deprecated Use SimpleQueue.completeMessage() instead
   */
  static moveMessage(meshDir, filename, fromQueue = null, toQueue = null) {
    // For backwards compatibility, mark as done
    const msgPath = path.join(meshDir, 'msgs', filename);
    const donePath = path.join(meshDir, 'msgs', filename.replace('.md', '-done.md'));

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

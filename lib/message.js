const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');

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
   * Send a message to a mesh inbox
   * Creates a file with frontmatter at: .ai/tx/mesh/{mesh}/msgs/inbox/{timestamp}-{name}.md
   */
  static send(mesh, task, context = '', metadata = {}) {
    const timestamp = generateTimestamp();
    const sanitizedTask = sanitizeName(task);
    const filename = `${timestamp}-${sanitizedTask}.md`;

    const meshDir = `.ai/tx/mesh/${mesh}`;
    const inboxDir = path.join(meshDir, 'msgs', 'inbox');
    const filepath = path.join(inboxDir, filename);

    // Ensure directory exists
    fs.ensureDirSync(inboxDir);

    // Generate message ID
    const messageId = `${mesh}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

    // Create frontmatter
    const frontmatter = {
      from: 'user',
      to: mesh,
      type: 'task',
      status: 'pending',
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
    const required = ['from', 'to', 'type', 'status', 'msg-id', 'timestamp'];
    const validTypes = ['task', 'task-complete', 'ask', 'ask-response', 'update'];
    const validStatuses = ['pending', 'in-progress', 'completed', 'rejected', 'approved', 'start'];

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

    // Validate status enum
    if (!validStatuses.includes(metadata.status)) {
      throw new Error(`Invalid status: ${metadata.status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Validate 'to' format (should be mesh/agent, agent, or mesh)
    const toField = metadata.to;
    if (!toField.match(/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/i)) {
      throw new Error(`Invalid 'to' format: ${toField}. Must be mesh/agent, agent, or mesh`);
    }

    // Validate 'from' format (should be mesh/agent or similar)
    const fromField = metadata.from;
    if (fromField !== 'user' && !fromField.match(/^[a-z0-9_-]+\/[a-z0-9_-]+$/i)) {
      throw new Error(`Invalid 'from' format: ${fromField}. Must be mesh/agent or 'user'`);
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

    // Validate frontmatter
    try {
      Message.validateFrontmatter(metadata);
    } catch (error) {
      Logger.error('message', `Frontmatter validation failed: ${error.message}`, {
        filepath,
        metadata
      });
      throw error;
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
   * Get all messages in a directory
   */
  static getMessages(meshDir, queue = 'inbox') {
    const queueDir = path.join(meshDir, 'msgs', queue);
    if (!fs.existsSync(queueDir)) {
      return [];
    }

    return fs
      .readdirSync(queueDir)
      .filter(f => f.endsWith('.md'))
      .sort();
  }

  /**
   * Move a message between queues
   */
  static moveMessage(meshDir, filename, fromQueue, toQueue) {
    const fromPath = path.join(meshDir, 'msgs', fromQueue, filename);
    const toPath = path.join(meshDir, 'msgs', toQueue, filename);

    if (!fs.existsSync(fromPath)) {
      throw new Error(`Source message not found: ${fromPath}`);
    }

    fs.ensureDirSync(path.dirname(toPath));
    fs.moveSync(fromPath, toPath, { overwrite: true });

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

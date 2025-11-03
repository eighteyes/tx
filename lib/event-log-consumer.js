const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { TmuxInjector } = require('./tmux-injector');

/**
 * EventLogConsumer - Consumes messages from centralized event log
 *
 * Each agent has a consumer that:
 * 1. Watches .ai/tx/msgs/ for new messages
 * 2. Filters messages addressed to this agent
 * 3. Tracks offset (last processed timestamp)
 * 4. Injects messages into agent's tmux session
 *
 * Offset tracking ensures:
 * - No duplicate message delivery
 * - Can restart consumer without reprocessing old messages
 * - Chronological ordering maintained
 */
class EventLogConsumer {
  /**
   * @param {string} agentId - Agent identifier in format "mesh/agent" or "mesh-instance/agent"
   */
  constructor(agentId) {
    this.agentId = agentId; // e.g., "core/core" or "research-807055/interviewer"
    this.offsetFile = `.ai/tx/state/offsets/${agentId.replace(/\//g, '-')}.json`;
    this.lastProcessed = null;
    this.watcher = null;
    this.running = false;
  }

  /**
   * Start consuming messages from event log
   */
  async start() {
    if (this.running) {
      Logger.warn('event-log-consumer', `Consumer already running for ${this.agentId}`);
      return;
    }

    Logger.log('event-log-consumer', `Starting consumer for ${this.agentId}`);

    // Load offset
    this.lastProcessed = await this.loadOffset();

    const logDir = '.ai/tx/msgs';
    await fs.ensureDir(logDir);

    // Process existing messages that we haven't seen yet
    const existingMessages = await this.getNewMessages(logDir);
    for (const msg of existingMessages) {
      await this.processMessage(msg);
    }

    // Watch for new messages
    this.watcher = chokidar.watch(`${logDir}/*.md`, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    this.watcher.on('add', async (filepath) => {
      try {
        const msg = await this.parseMessage(filepath);
        if (this.isForMe(msg) && !this.isProcessed(msg)) {
          await this.processMessage(msg);
        }
      } catch (error) {
        Logger.error('event-log-consumer', `Error processing message: ${error.message}`, {
          filepath,
          agentId: this.agentId
        });
      }
    });

    this.watcher.on('error', (error) => {
      Logger.error('event-log-consumer', `Watcher error: ${error.message}`, {
        agentId: this.agentId
      });
    });

    this.running = true;
    Logger.log('event-log-consumer', `Consumer started for ${this.agentId}`);
  }

  /**
   * Get new messages from event log that haven't been processed yet
   */
  async getNewMessages(logDir) {
    const files = await fs.readdir(logDir);
    const messages = [];

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filepath = path.join(logDir, file);
      try {
        const msg = await this.parseMessage(filepath);
        if (this.isForMe(msg) && !this.isProcessed(msg)) {
          messages.push(msg);
        }
      } catch (error) {
        Logger.warn('event-log-consumer', `Failed to parse message: ${error.message}`, {
          filepath
        });
      }
    }

    // Sort by timestamp to ensure chronological order
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Check if message is addressed to this agent
   */
  isForMe(msg) {
    // Normalize both formats (replace / with -)
    const msgToNormalized = msg.to.replace(/\//g, '-');
    const agentIdNormalized = this.agentId.replace(/\//g, '-');

    // Direct match
    if (msgToNormalized === agentIdNormalized) {
      return true;
    }

    // Handle both "core/core" and "core" formats
    if (msg.to === this.agentId) {
      return true;
    }

    // Handle case where message uses short form and agent uses long form
    const [mesh, agent] = this.agentId.split('/');
    if (msg.to === agent || msg.to === mesh) {
      return true;
    }

    return false;
  }

  /**
   * Check if message has already been processed
   */
  isProcessed(msg) {
    if (!this.lastProcessed) {
      return false;
    }
    return msg.timestamp <= this.lastProcessed;
  }

  /**
   * Process a message (inject into agent session)
   */
  async processMessage(msg) {
    Logger.log('event-log-consumer', `Processing message for ${this.agentId}`, {
      from: msg.from,
      type: msg.type,
      msgId: msg.msgId,
      filepath: msg.filepath
    });

    // Determine session name from agent ID
    const sessionName = this.getSessionName();

    // Check if session exists
    if (!TmuxInjector.sessionExists(sessionName)) {
      Logger.warn('event-log-consumer', `Session not found: ${sessionName}`, {
        agentId: this.agentId,
        filepath: msg.filepath
      });
      return;
    }

    // Inject message file into session
    try {
      TmuxInjector.injectFile(sessionName, msg.filepath);
      Logger.log('event-log-consumer', `Injected message into ${sessionName}`, {
        from: msg.from,
        type: msg.type
      });
    } catch (error) {
      Logger.error('event-log-consumer', `Failed to inject message: ${error.message}`, {
        sessionName,
        filepath: msg.filepath
      });
      return;
    }

    // Update offset
    this.lastProcessed = msg.timestamp;
    await this.saveOffset();
  }

  /**
   * Get tmux session name from agent ID
   */
  getSessionName() {
    const [mesh, agent] = this.agentId.split('/');

    // Handle core/core -> core
    if (mesh === 'core' && agent === 'core') {
      return 'core';
    }

    // Handle mesh/mesh -> mesh (persistent meshes)
    if (mesh === agent) {
      return mesh;
    }

    // Handle standard pattern: {mesh}-{agent}
    // This will match sessions like "research-807055-interviewer"
    return `${mesh}-${agent}`;
  }

  /**
   * Load offset from disk
   */
  async loadOffset() {
    try {
      const data = await fs.readJson(this.offsetFile);
      return new Date(data.lastProcessedTimestamp);
    } catch {
      // No offset file = start from beginning
      return null;
    }
  }

  /**
   * Save offset to disk
   */
  async saveOffset() {
    await fs.ensureDir(path.dirname(this.offsetFile));
    await fs.writeJson(this.offsetFile, {
      agentId: this.agentId,
      lastProcessedTimestamp: this.lastProcessed.toISOString(),
      updatedAt: new Date().toISOString()
    }, { spaces: 2 });
  }

  /**
   * Parse message file from event log
   */
  async parseMessage(filepath) {
    const content = await fs.readFile(filepath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!match) {
      throw new Error(`Invalid message format: ${filepath}`);
    }

    const frontmatter = this.parseFrontmatter(match[1]);
    const body = match[2];

    // Parse timestamp from filename
    const filename = path.basename(filepath);
    const timestamp = this.parseTimestampFromFilename(filename);

    return {
      filepath,
      timestamp,
      to: frontmatter.to,
      from: frontmatter.from,
      type: frontmatter.type,
      msgId: frontmatter['msg-id'],
      metadata: frontmatter,
      content: body
    };
  }

  /**
   * Parse timestamp from event log filename
   * Format: MMDDHHMMSS-{type}-{from}>{to}-{msgId}.md
   */
  parseTimestampFromFilename(filename) {
    // Extract first 10 digits (MMDDHHMMSS)
    const match = filename.match(/^(\d{10})-/);
    if (!match) {
      throw new Error(`Invalid filename format: ${filename}`);
    }

    const ts = match[1];
    const mm = ts.substring(0, 2);
    const dd = ts.substring(2, 4);
    const hh = ts.substring(4, 6);
    const min = ts.substring(6, 8);
    const ss = ts.substring(8, 10);

    // Build ISO timestamp (use current year as we don't store it)
    const year = new Date().getFullYear();
    const isoString = `${year}-${mm}-${dd}T${hh}:${min}:${ss}.000Z`;
    return new Date(isoString);
  }

  /**
   * Parse YAML frontmatter
   */
  parseFrontmatter(yaml) {
    const lines = yaml.split('\n');
    const data = {};

    lines.forEach(line => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        data[match[1].trim()] = match[2].trim();
      }
    });

    return data;
  }

  /**
   * Stop consumer
   */
  async stop() {
    if (!this.running) {
      return;
    }

    Logger.log('event-log-consumer', `Stopping consumer for ${this.agentId}`);

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.running = false;
    Logger.log('event-log-consumer', `Consumer stopped for ${this.agentId}`);
  }
}

module.exports = { EventLogConsumer };

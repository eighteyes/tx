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

    // Check if self-modify mode is active
    if (msg.metadata['self-modify'] === 'true') {
      // Automatically clear context when self-modify is enabled
      await this.clearContext(sessionName);

      await this.handleSelfModify(sessionName, msg);
      this.lastProcessed = msg.timestamp;
      await this.saveOffset();
      return;
    }

    // Handle clear-context directive (for non-self-modify cases)
    if (msg.metadata['clear-context'] === 'true') {
      await this.clearContext(sessionName);
    }

    // Handle lens application
    if (msg.metadata.lens) {
      await this.applyLens(sessionName, msg);
      this.lastProcessed = msg.timestamp;
      await this.saveOffset();
      return;
    }

    // Inject message file into session
    try {
      // Pass isPrompt=true for prompt-type messages
      const isPrompt = msg.type === 'prompt';
      TmuxInjector.injectFile(sessionName, msg.filepath, isPrompt);
      Logger.log('event-log-consumer', `Injected message into ${sessionName}`, {
        from: msg.from,
        type: msg.type,
        isPrompt
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
   * Clear agent context with /clear command
   */
  async clearContext(sessionName) {
    Logger.log('event-log-consumer', `Clearing context for ${sessionName}`);

    try {
      // Inject /clear command
      TmuxInjector.injectCommand(sessionName, 'clear');
      await this.sleep(1000);

      Logger.log('event-log-consumer', `Context cleared for ${sessionName}`);
    } catch (error) {
      Logger.error('event-log-consumer', `Failed to clear context: ${error.message}`, {
        sessionName
      });
    }
  }

  /**
   * Handle self-modify messages with instructions
   */
  async handleSelfModify(sessionName, msg) {
    Logger.log('event-log-consumer', `Handling self-modify for ${sessionName}`);

    try {
      // Load mesh config to get frontmatter settings
      const meshConfig = await this.loadMeshConfig(msg.to);

      // Build modified message with self-modify instructions
      const modifiedContent = await this.injectSelfModifyInstructions(msg, meshConfig);

      // Write to temp file
      const tempPath = path.join('.ai/tx/temp', `${msg.msgId}-modified.md`);
      await fs.ensureDir('.ai/tx/temp');
      await fs.writeFile(tempPath, modifiedContent);

      // Inject the modified message
      TmuxInjector.injectFile(sessionName, tempPath);

      Logger.log('event-log-consumer', `Self-modify instructions injected for ${sessionName}`);
    } catch (error) {
      Logger.error('event-log-consumer', `Failed to handle self-modify: ${error.message}`, {
        sessionName,
        msgId: msg.msgId
      });
    }
  }

  /**
   * Apply lens perspective to message
   */
  async applyLens(sessionName, msg) {
    Logger.log('event-log-consumer', `Applying lens '${msg.metadata.lens}' for ${sessionName}`);

    try {
      // Load lens role
      const lensRole = await this.getLensRole(msg.metadata.lens);

      // Prepend lens role to message
      const lensedContent = `---\n${msg.content.split('---\n')[1]}\n\n**LENS PERSPECTIVE:** ${lensRole}\n\n---\n\n${msg.content.split('---\n\n')[1]}`;

      // Write to temp file
      const tempPath = path.join('.ai/tx/temp', `${msg.msgId}-lensed.md`);
      await fs.ensureDir('.ai/tx/temp');
      await fs.writeFile(tempPath, lensedContent);

      // Inject the modified message
      TmuxInjector.injectFile(sessionName, tempPath);

      Logger.log('event-log-consumer', `Lens applied for ${sessionName}`);
    } catch (error) {
      Logger.error('event-log-consumer', `Failed to apply lens: ${error.message}`, {
        sessionName,
        lens: msg.metadata.lens
      });
    }
  }

  /**
   * Load mesh configuration
   */
  async loadMeshConfig(agentPath) {
    const [mesh] = agentPath.split('/');
    const configPath = path.join('meshes/mesh-configs', `${mesh}.json`);

    try {
      return await fs.readJson(configPath);
    } catch (error) {
      Logger.warn('event-log-consumer', `No mesh config found for ${mesh}, using defaults`);
      return { frontmatter: {} };
    }
  }

  /**
   * Inject self-modify instructions into message
   */
  async injectSelfModifyInstructions(msg, meshConfig) {
    const templatePath = path.join('lib/templates/self-modify.md');
    let template = await fs.readFile(templatePath, 'utf-8');

    // Handle lens configuration
    const frontmatter = meshConfig.frontmatter || {};
    const lensConfig = frontmatter.lens;
    let lensesList = '';

    if (lensConfig) {
      const lensIndex = await this.loadLensIndex();
      const filteredLenses = this.filterLenses(lensIndex, lensConfig);
      lensesList = this.formatLensesList(filteredLenses);
    } else {
      lensesList = 'Lenses not enabled for this mesh. Set `frontmatter.lens` in mesh config to enable.';
    }

    // Replace template variables
    template = template
      .replace(/{{agent-path}}/g, msg.to)
      .replace(/{{max-iterations}}/g, frontmatter['max-iterations'] || 10)
      .replace(/{{iteration}}/g, msg.metadata.iteration || 1)
      .replace(/{{next-iteration}}/g, (parseInt(msg.metadata.iteration) || 1) + 1)
      .replace(/{{previous-confidence}}/g, msg.metadata.confidence || 0)
      .replace(/{{available-lenses}}/g, lensesList);

    // Combine original message with instructions
    return `${msg.content}\n\n---\n\n${template}`;
  }

  /**
   * Load lens index
   */
  async loadLensIndex() {
    const lensIndexPath = path.join('meshes/prompts/lenses/index.json');

    try {
      return await fs.readJson(lensIndexPath);
    } catch (error) {
      Logger.warn('event-log-consumer', `Failed to load lens index: ${error.message}`);
      return { lenses: {} };
    }
  }

  /**
   * Filter lenses based on configuration
   *
   * Supports multiple modes:
   * - true: All lenses available
   * - 'tag' or ['tag1', 'tag2']: Filter by tags
   * - ['lens1', 'lens2']: Explicit lens list
   */
  filterLenses(lensIndex, lensConfig) {
    if (!lensIndex.lenses) {
      return { lenses: {} };
    }

    // Mode 1: lens: true - All lenses
    if (lensConfig === true) {
      return lensIndex;
    }

    // Mode 2: lens: 'tag' or lens: ['tag1', 'tag2'] - Filter by tags
    if (typeof lensConfig === 'string' || Array.isArray(lensConfig)) {
      const tags = Array.isArray(lensConfig) ? lensConfig : [lensConfig];

      // Check if this is tag filtering or explicit lens list
      // If any tag doesn't exist as a lens name, assume it's tag filtering
      const isTagFiltering = tags.some(tag => !lensIndex.lenses[tag]);

      if (isTagFiltering) {
        // Tag filtering mode
        const filtered = {};
        Object.entries(lensIndex.lenses).forEach(([name, lens]) => {
          // Include lens if it has ANY of the specified tags
          if (lens.tags && tags.some(tag => lens.tags.includes(tag))) {
            filtered[name] = lens;
          }
        });
        return { lenses: filtered };
      } else {
        // Explicit lens list mode
        const filtered = {};
        tags.forEach(lensName => {
          if (lensIndex.lenses[lensName]) {
            filtered[lensName] = lensIndex.lenses[lensName];
          }
        });
        return { lenses: filtered };
      }
    }

    // Default: no lenses
    return { lenses: {} };
  }

  /**
   * Format lenses list for template injection
   */
  formatLensesList(lensIndex) {
    if (!lensIndex.lenses || Object.keys(lensIndex.lenses).length === 0) {
      return 'No lenses available';
    }

    const lensesList = Object.entries(lensIndex.lenses)
      .map(([name, lens]) => `- **${name}** (${lens.tags.join(', ')})`)
      .join('\n');

    return lensesList;
  }

  /**
   * Get lens role from index
   */
  async getLensRole(lensName) {
    const lensIndex = await this.loadLensIndex();
    const lens = lensIndex.lenses[lensName];

    if (!lens) {
      Logger.warn('event-log-consumer', `Lens '${lensName}' not found in index`);
      return `Apply the '${lensName}' perspective`;
    }

    return lens.role;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

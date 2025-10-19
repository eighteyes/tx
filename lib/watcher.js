const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');

class Watcher {
  static watcher = null;
  static watching = false;
  static ignoredPaths = new Set();

  /**
   * Start watching for message files
   * Watches: .ai/tx/mesh/[mesh-name]/msgs/[queue]/*.md
   */
  static start() {
    if (Watcher.watching) {
      Logger.warn('watcher', 'Watcher already running');
      return;
    }

    try {
      const watchPattern = '.ai/tx/mesh/**/msgs/**/*.md';

      Watcher.watcher = chokidar.watch(watchPattern, {
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 100
        }
      });

      // File added
      Watcher.watcher.on('add', (filepath) => {
        Watcher._handleFileAdd(filepath);
      });

      // File changed
      Watcher.watcher.on('change', (filepath) => {
        Watcher._handleFileChange(filepath);
      });

      // File removed
      Watcher.watcher.on('unlink', (filepath) => {
        Watcher._handleFileRemove(filepath);
      });

      Watcher.watcher.on('error', (error) => {
        Logger.error('watcher', `Watcher error: ${error.message}`);
      });

      Watcher.watching = true;

      Logger.log('watcher', 'File watcher started');
      EventBus.emit('watcher:started', {});
    } catch (error) {
      Logger.error('watcher', `Failed to start watcher: ${error.message}`, {
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Stop watching
   */
  static async stop() {
    if (Watcher.watcher) {
      await Watcher.watcher.close();
      Watcher.watcher = null;
      Watcher.watching = false;

      Logger.log('watcher', 'File watcher stopped');
      EventBus.emit('watcher:stopped', {});
    }
  }

  /**
   * Handle file addition
   */
  static _handleFileAdd(filepath) {
    const queue = Watcher._parseQueueFromPath(filepath);
    const mesh = Watcher._parseMeshFromPath(filepath);
    const filename = path.basename(filepath);
    const agent = Watcher._parseAgentFromPath(filepath);
    const isAgentInbox = agent !== null;

    if (!queue || !mesh) {
      return;
    }

    // Check if this is a system operation (should be ignored)
    const isSystemOp = Watcher.ignoredPaths.has(filepath);
    if (isSystemOp) {
      Watcher.ignoredPaths.delete(filepath);
    }

    // ERROR: Claude should ONLY write to outbox, never inbox/next/etc
    // But ignore system operations (queue moves, routing, etc.)
    if (queue !== 'outbox' && !isSystemOp) {
      Logger.error('watcher', `INVALID: File added to non-outbox folder (Claude should only write to outbox)`, {
        filepath,
        violation: 'non-outbox-write'
      });
    }

    // Parse frontmatter to get message details
    const frontmatter = Watcher._parseFrontmatter(filepath);
    const msgInfo = frontmatter
      ? `${frontmatter.from || '?'}→${frontmatter.to || '?'} | ${frontmatter.type || '?'} | ${frontmatter.status || '?'} | ${frontmatter.headline || ''}`
      : '';

    Logger.log('watcher', `File added: ${queue}${isAgentInbox ? ` (agent: ${agent})` : ''}`, {
      filepath,
      msg: msgInfo
    });

    // Check if this is an ask message (special handling)
    if (filename.includes('-ask-') && queue === 'inbox' && isAgentInbox) {
      EventBus.emit('file:ask:new', {
        mesh,
        agent,
        file: filename,
        filepath,
        queue
      });
      return;
    }

    // Check if this is an ask response
    if (filename.includes('-ask-response-') && queue === 'inbox' && isAgentInbox) {
      EventBus.emit('file:ask-response:new', {
        mesh,
        agent,
        file: filename,
        filepath,
        queue
      });
      return;
    }

    // Emit different events for agent inbox vs mesh inbox
    if (isAgentInbox) {
      // File in agent inbox (.../agents/[agent]/msgs/[queue]/...)
      const eventName = `file:agent-${queue}:new`;
      EventBus.emit(eventName, {
        mesh,
        agent,
        file: filename,
        filepath,
        queue
      });
    } else {
      // File in mesh inbox (.../msgs/[queue]/...)
      const eventName = `file:${queue}:new`;
      EventBus.emit(eventName, {
        mesh,
        file: filename,
        filepath,
        queue
      });
    }
  }

  /**
   * Handle file change
   */
  static _handleFileChange(filepath) {
    const queue = Watcher._parseQueueFromPath(filepath);
    const mesh = Watcher._parseMeshFromPath(filepath);
    const agent = Watcher._parseAgentFromPath(filepath);
    const isAgentInbox = agent !== null;

    if (!queue || !mesh) {
      return;
    }

    // Parse frontmatter to get message details
    const frontmatter = Watcher._parseFrontmatter(filepath);
    const msgInfo = frontmatter
      ? `${frontmatter.from || '?'}→${frontmatter.to || '?'} | ${frontmatter.type || '?'} | ${frontmatter.status || '?'} | ${frontmatter.headline || ''}`
      : '';

    Logger.log('watcher', `File changed: ${queue}${isAgentInbox ? ` (agent: ${agent})` : ''}`, {
      filepath,
      msg: msgInfo
    });

    if (isAgentInbox) {
      const eventName = `file:agent-${queue}:changed`;
      EventBus.emit(eventName, {
        mesh,
        agent,
        file: path.basename(filepath),
        filepath,
        queue
      });
    } else {
      const eventName = `file:${queue}:changed`;
      EventBus.emit(eventName, {
        mesh,
        file: path.basename(filepath),
        filepath,
        queue
      });
    }
  }

  /**
   * Handle file removal
   */
  static _handleFileRemove(filepath) {
    const queue = Watcher._parseQueueFromPath(filepath);
    const mesh = Watcher._parseMeshFromPath(filepath);
    const agent = Watcher._parseAgentFromPath(filepath);
    const isAgentInbox = agent !== null;

    if (!queue || !mesh) {
      return;
    }

    Logger.log('watcher', `File removed: ${queue}${isAgentInbox ? ` (agent: ${agent})` : ''}`, {
      filepath
    });

    if (isAgentInbox) {
      const eventName = `file:agent-${queue}:removed`;
      EventBus.emit(eventName, {
        mesh,
        agent,
        file: path.basename(filepath),
        filepath,
        queue
      });
    } else {
      const eventName = `file:${queue}:removed`;
      EventBus.emit(eventName, {
        mesh,
        file: path.basename(filepath),
        filepath,
        queue
      });
    }
  }

  /**
   * Parse frontmatter from message file
   * Returns object with from, to, type, status, headline, etc.
   */
  static _parseFrontmatter(filepath) {
    try {
      if (!fs.existsSync(filepath)) {
        return null;
      }

      const content = fs.readFileSync(filepath, 'utf-8');

      // Extract YAML frontmatter between --- ... ---
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) {
        return null;
      }

      const yamlContent = match[1];
      const frontmatter = {};

      // Parse simple YAML (key: value pairs)
      yamlContent.split('\n').forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const value = parts.slice(1).join(':').trim();
          frontmatter[key] = value;
        }
      });

      return frontmatter;
    } catch (error) {
      // Silently fail - frontmatter parsing is optional
      return null;
    }
  }

  /**
   * Parse queue name from filepath
   * E.g., .ai/tx/mesh/test/msgs/inbox/file.md → "inbox"
   */
  static _parseQueueFromPath(filepath) {
    const match = filepath.match(/\/msgs\/([^/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * Parse mesh name from filepath
   * E.g., .ai/tx/mesh/test/msgs/inbox/file.md → "test"
   */
  static _parseMeshFromPath(filepath) {
    const match = filepath.match(/\.ai\/tx\/mesh\/([^/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * Parse agent name from filepath
   * E.g., .ai/tx/mesh/test/agents/agent1/msgs/inbox/file.md → "agent1"
   */
  static _parseAgentFromPath(filepath) {
    const match = filepath.match(/\/agents\/([^/]+)\/msgs\//);
    return match ? match[1] : null;
  }

  /**
   * Check if watcher is running
   */
  static isRunning() {
    return Watcher.watching;
  }

  /**
   * Wait for watcher to be ready
   */
  static async ready() {
    if (!Watcher.watcher) {
      throw new Error('Watcher not started');
    }

    return new Promise((resolve) => {
      Watcher.watcher.once('ready', resolve);
    });
  }

  /**
   * Get watcher status
   */
  static getWatcherStatus() {
    return {
      isRunning: Watcher.watching,
      hasWatcher: Watcher.watcher !== null
    };
  }

  /**
   * Ignore next operation on a specific filepath
   * Used by system operations (queue moves, routing, etc.)
   * to prevent false "INVALID" warnings
   */
  static ignoreNextOperation(filepath) {
    Watcher.ignoredPaths.add(filepath);
  }
}

module.exports = { Watcher };

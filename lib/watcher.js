const chokidar = require('chokidar');
const path = require('path');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');

class Watcher {
  static watcher = null;
  static watching = false;

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

    if (!queue || !mesh) {
      return;
    }

    Logger.log('watcher', `File added: ${queue}`, {
      filepath,
      mesh,
      queue,
      filename
    });

    // Check if this is an ask message (special handling)
    if (filename.includes('-ask-') && queue === 'inbox') {
      const agent = Watcher._parseAgentFromPath(filepath);
      if (agent) {
        EventBus.emit('file:ask:new', {
          mesh,
          agent,
          file: filename,
          filepath,
          queue
        });
        return;
      }
    }

    // Check if this is an ask response
    if (filename.includes('-ask-response-') && queue === 'inbox') {
      const agent = Watcher._parseAgentFromPath(filepath);
      if (agent) {
        EventBus.emit('file:ask-response:new', {
          mesh,
          agent,
          file: filename,
          filepath,
          queue
        });
        return;
      }
    }

    // Emit specific event based on queue
    const eventName = `file:${queue}:new`;
    EventBus.emit(eventName, {
      mesh,
      file: filename,
      filepath,
      queue
    });
  }

  /**
   * Handle file change
   */
  static _handleFileChange(filepath) {
    const queue = Watcher._parseQueueFromPath(filepath);
    const mesh = Watcher._parseMeshFromPath(filepath);

    if (!queue || !mesh) {
      return;
    }

    Logger.log('watcher', `File changed: ${queue}`, {
      filepath,
      mesh,
      queue
    });

    const eventName = `file:${queue}:changed`;
    EventBus.emit(eventName, {
      mesh,
      file: path.basename(filepath),
      filepath,
      queue
    });
  }

  /**
   * Handle file removal
   */
  static _handleFileRemove(filepath) {
    const queue = Watcher._parseQueueFromPath(filepath);
    const mesh = Watcher._parseMeshFromPath(filepath);

    if (!queue || !mesh) {
      return;
    }

    Logger.log('watcher', `File removed: ${queue}`, {
      filepath,
      mesh,
      queue
    });

    const eventName = `file:${queue}:removed`;
    EventBus.emit(eventName, {
      mesh,
      file: path.basename(filepath),
      filepath,
      queue
    });
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
}

module.exports = { Watcher };

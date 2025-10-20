const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');

// Using Chokidar v4 with improved atomic write detection and ready state handling

class Watcher {
  static watcher = null;
  static watching = false;
  static ignoredPaths = new Set();
  static recentEvents = new Map(); // Track recent events for deduplication
  static EVENT_DEBOUNCE_MS = 500; // Ignore duplicate events within 500ms

  /**
   * Start watching for message files
   * V4: Watch directories directly (globs removed in v4)
   * Watches ONLY active message queues:
   *   - .ai/tx/mesh/[mesh-name]/msgs/{inbox,next,active,outbox}
   *   - .ai/tx/mesh/[mesh-name]/agents/[agent]/msgs/{inbox,next,active,outbox}
   */
  static start() {
    if (Watcher.watching) {
      Logger.warn('watcher', 'Watcher already running, ignoring duplicate start');
      return;
    }

    if (Watcher.watcher !== null) {
      Logger.warn('watcher', 'Watcher instance exists but not marked as watching, cleaning up');
      Watcher.watcher = null;
    }

    try {
      // V4: Watch base mesh directory recursively (no globs in v4)
      const basePath = '.ai/tx/mesh';

      Logger.log('watcher', 'Starting watcher (v4 - directory mode)', {
        basePath,
        mode: 'recursive with filter',
        ignoreInitial: false,
        stabilityThreshold: 100
      });

      Watcher.watcher = chokidar.watch(basePath, {
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 100
        },
        // V4: Watch directories recursively
        depth: 10,
        // V4: Filter to only watch .md files in message directories
        ignored: (filepath, stats) => {
          // Always ignore prompts and workspace directories
          if (filepath.includes('/prompts/') || filepath.includes('/workspace/')) {
            return true;
          }

          // NEVER ignore directories (allows recursive scanning)
          if (!stats || stats.isDirectory()) return false;

          // For files: only watch .md files in message queue directories
          if (!filepath.endsWith('.md')) return true;

          // Only watch files in message queue directories (inbox, next, active, outbox, complete)
          const isInMessageQueue = /\/msgs\/(inbox|next|active|outbox|complete)\/[^/]+\.md$/.test(filepath);
          return !isInMessageQueue;
        },
        // V4: Use native FSEvents (faster, more efficient than polling)
        usePolling: false,
        // V4: Better atomic write detection
        atomic: true
      });

      Logger.log('watcher', 'Watcher instance created, registering event handlers');

      // File added
      Watcher.watcher.on('add', (filepath) => {
        if (Watcher.watching) {
          Logger.log('watcher', 'RAW EVENT: file added', { filepath });
          Watcher._handleFileAdd(filepath);
        }
      });

      // File changed
      Watcher.watcher.on('change', (filepath) => {
        if (Watcher.watching) {
          Logger.log('watcher', 'RAW EVENT: file changed', { filepath });
          Watcher._handleFileChange(filepath);
        }
      });

      // File removed
      Watcher.watcher.on('unlink', (filepath) => {
        if (Watcher.watching) {
          Logger.log('watcher', 'RAW EVENT: file removed', { filepath });
          Watcher._handleFileRemove(filepath);
        }
      });

      Watcher.watcher.on('error', (error) => {
        Logger.error('watcher', `Watcher error: ${error.message}`, {
          error: error.stack
        });
      });

      Watcher.watcher.on('ready', () => {
        Logger.log('watcher', 'Watcher ready - initial scan complete');

        // Debug: List what's being watched
        const watched = Watcher.watcher.getWatched();
        const watchedPaths = Object.keys(watched);
        Logger.log('watcher', `Watcher tracking ${watchedPaths.length} directories`, {
          watchedDirs: watchedPaths.slice(0, 10) // First 10 for debugging
        });
      });

      Watcher.watching = true;

      Logger.log('watcher', 'File watcher started successfully');
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
    if (!Watcher.watching) {
      Logger.log('watcher', 'Stop called but watcher not running');
      return;
    }

    try {
      Logger.log('watcher', 'Stopping watcher...');

      if (Watcher.watcher) {
        await Watcher.watcher.close();
        Logger.log('watcher', 'Watcher instance closed');
      }

      Watcher.watcher = null;
      Watcher.watching = false;
      Watcher.ignoredPaths.clear();

      Logger.log('watcher', 'File watcher stopped completely');
      EventBus.emit('watcher:stopped', {});
    } catch (error) {
      Logger.error('watcher', `Error stopping watcher: ${error.message}`, {
        error: error.stack
      });

      // Force cleanup even if close() failed
      Watcher.watcher = null;
      Watcher.watching = false;
      Watcher.ignoredPaths.clear();
    }
  }

  /**
   * Check if event is a duplicate (same file/event within debounce window)
   */
  static _isDuplicateEvent(filepath, eventType) {
    const key = `${eventType}:${filepath}`;
    const now = Date.now();
    const lastEventTime = Watcher.recentEvents.get(key);

    if (lastEventTime && (now - lastEventTime) < Watcher.EVENT_DEBOUNCE_MS) {
      return true; // Duplicate event
    }

    Watcher.recentEvents.set(key, now);

    // Clean up old entries (older than 2 seconds)
    for (const [k, time] of Watcher.recentEvents.entries()) {
      if (now - time > 2000) {
        Watcher.recentEvents.delete(k);
      }
    }

    return false;
  }

  /**
   * Handle file addition
   */
  static _handleFileAdd(filepath) {
    try {
      // Deduplicate events
      if (Watcher._isDuplicateEvent(filepath, 'add')) {
        Logger.log('watcher', 'Duplicate add event ignored', { filepath });
        return;
      }
      const queue = Watcher._parseQueueFromPath(filepath);
      const mesh = Watcher._parseMeshFromPath(filepath);
      const filename = path.basename(filepath);
      const agent = Watcher._parseAgentFromPath(filepath);
      const isAgentInbox = agent !== null;

      if (!queue || !mesh) {
        Logger.log('watcher', 'File added but missing queue or mesh info', {
          filepath,
          queue,
          mesh
        });
        return;
      }

      // Check if this is a system operation (should be ignored)
      const isSystemOp = Watcher.ignoredPaths.has(filepath);
      if (isSystemOp) {
        Watcher.ignoredPaths.delete(filepath);
        Logger.log('watcher', 'File added (system operation - ignored)', {
          filepath,
          queue
        });
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
        Logger.log('watcher', 'Emitting ask event', { mesh, agent, file: filename });
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
        Logger.log('watcher', 'Emitting ask-response event', { mesh, agent, file: filename });
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
        Logger.log('watcher', `Emitting event: ${eventName}`, { mesh, agent, file: filename });
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
        Logger.log('watcher', `Emitting event: ${eventName}`, { mesh, file: filename });
        EventBus.emit(eventName, {
          mesh,
          file: filename,
          filepath,
          queue
        });
      }
    } catch (error) {
      Logger.error('watcher', `Error handling file addition: ${error.message}`, {
        filepath,
        error: error.stack
      });
    }
  }

  /**
   * Handle file change
   */
  static _handleFileChange(filepath) {
    // Deduplicate events
    if (Watcher._isDuplicateEvent(filepath, 'change')) {
      Logger.log('watcher', 'Duplicate change event ignored', { filepath });
      return;
    }

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
    // Deduplicate events
    if (Watcher._isDuplicateEvent(filepath, 'unlink')) {
      Logger.log('watcher', 'Duplicate unlink event ignored', { filepath });
      return;
    }

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
   * V4: Improved ready state handling
   */
  static async ready() {
    if (!Watcher.watcher) {
      throw new Error('Watcher not started');
    }

    return new Promise((resolve) => {
      // V4: Check if ready was already emitted
      if (Watcher.watcher._readyEmitted) {
        resolve();
      } else {
        Watcher.watcher.once('ready', resolve);
      }
    });
  }

  /**
   * Get watcher status
   * V4: Enhanced status information
   */
  static getWatcherStatus() {
    const status = {
      isRunning: Watcher.watching,
      hasWatcher: Watcher.watcher !== null,
      version: 'v4'
    };

    if (Watcher.watcher) {
      const watched = Watcher.watcher.getWatched();
      status.watchedDirectories = Object.keys(watched).length;
      status.totalFiles = Object.values(watched).flat().length;
      status.ready = Watcher.watcher._readyEmitted || false;
    }

    return status;
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

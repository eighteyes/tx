const chokidar = require('chokidar');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');

/**
 * Simplified file watcher for msgs/ directory
 * Watches for new message files and emits events for queue processing
 *
 * Key changes from complex watcher:
 * - Single pattern for direct files in msgs/
 * - DETECTION pattern for nested files (warns if found)
 * - Single event: file:msgs:new
 * - No subdirectory tracking (inbox/outbox/next/active/complete/archive)
 * - Simpler ignore logic
 */
class SimpleWatcher {
  static watcher = null;
  static detectionWatcher = null;
  static watching = false;
  static ignoredPaths = new Set();

  /**
   * Tell watcher to ignore the next operation on this filepath
   * Used when we programmatically create files to avoid loops
   */
  static ignoreNextOperation(filepath) {
    Logger.log('watcher', `Ignoring next operation on: ${filepath}`);
    SimpleWatcher.ignoredPaths.add(filepath);
    // Auto-remove after 5 seconds to prevent memory leaks
    setTimeout(() => {
      SimpleWatcher.ignoredPaths.delete(filepath);
    }, 5000);
  }

  /**
   * Start watching for new message files
   */
  static start() {
    if (SimpleWatcher.watching) {
      Logger.warn('watcher', 'Watcher already started');
      return;
    }

    Logger.log('watcher', 'Starting simplified watcher for msgs/*.md');

    // Main watcher - for files directly in msgs/
    SimpleWatcher.watcher = chokidar.watch('.ai/tx/mesh/**/msgs/*.md', {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/prompts/**',
        '**/*-done.md'  // Ignore completed messages
      ],
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    // Detection watcher - for files in subfolders (OLD pattern)
    // This catches agents still using msgs/outbox/, msgs/inbox/, etc.
    SimpleWatcher.detectionWatcher = chokidar.watch('.ai/tx/mesh/**/msgs/**/*.md', {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/prompts/**',
        '.ai/tx/mesh/**/msgs/*.md'  // Ignore top-level (main watcher handles these)
      ],
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    // Main watcher event - NEW message file created
    SimpleWatcher.watcher.on('add', (filepath) => {
      SimpleWatcher.handleFileAdded(filepath);
    });

    // Detection watcher event - OLD pattern detected
    SimpleWatcher.detectionWatcher.on('add', (filepath) => {
      Logger.error('watcher', `⚠️  DEPRECATED PATTERN DETECTED: ${filepath}`);
      Logger.error('watcher', `   Agent is writing to subfolder (msgs/outbox/, msgs/inbox/, etc.)`);
      Logger.error('watcher', `   Should write directly to msgs/ folder`);
      Logger.error('watcher', `   Check runtime prompt and source files for stale references`);

      // Still process it to avoid breaking the system
      SimpleWatcher.handleFileAdded(filepath);
    });

    SimpleWatcher.watcher.on('error', (error) => {
      Logger.error('watcher', `Watcher error: ${error.message}`);
    });

    SimpleWatcher.watcher.on('ready', () => {
      Logger.log('watcher', 'Simplified watcher ready');
      SimpleWatcher.watching = true;
    });

    Logger.log('watcher', 'Simplified watcher started successfully');
  }

  /**
   * Handle new file added event
   */
  static handleFileAdded(filepath) {
    // Check if we should ignore this file
    if (SimpleWatcher.ignoredPaths.has(filepath)) {
      Logger.log('watcher', `Ignoring file (marked as ignored): ${filepath}`);
      SimpleWatcher.ignoredPaths.delete(filepath);
      return;
    }

    // Parse filepath to extract mesh and agent
    // Format: .ai/tx/mesh/{mesh}/agents/{agent}/msgs/{file}.md
    const match = filepath.match(/\.ai\/tx\/mesh\/([^/]+)\/agents\/([^/]+)\/msgs\/.+\.md$/);
    if (!match) {
      Logger.log('watcher', `Skipping file (doesn't match pattern): ${filepath}`);
      return;
    }

    const [, mesh, agent] = match;
    const filename = filepath.split('/').pop();

    // Skip -done files
    if (filename.endsWith('-done.md')) {
      Logger.log('watcher', `Skipping completed message: ${filename}`);
      return;
    }

    Logger.log('watcher', `New message detected: ${mesh}/${agent} - ${filename}`);

    // Emit single event for all new messages
    EventBus.emit('file:msgs:new', {
      mesh,
      agent,
      file: filename,
      filepath
    });
  }

  /**
   * Stop watching
   */
  static async stop() {
    if (!SimpleWatcher.watching) {
      return;
    }

    Logger.log('watcher', 'Stopping simplified watcher...');

    if (SimpleWatcher.watcher) {
      await SimpleWatcher.watcher.close();
    }

    if (SimpleWatcher.detectionWatcher) {
      await SimpleWatcher.detectionWatcher.close();
    }

    SimpleWatcher.watching = false;
    SimpleWatcher.ignoredPaths.clear();
    Logger.log('watcher', 'Simplified watcher stopped');
  }
}

module.exports = { SimpleWatcher };

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
class Watcher {
  static watcher = null;
  static watching = false;
  static ignoredPaths = new Set();

  /**
   * Tell watcher to ignore the next operation on this filepath
   * Used when we programmatically create files to avoid loops
   */
  static ignoreNextOperation(filepath) {
    Logger.log('watcher', `Ignoring next operation on: ${filepath}`);
    Watcher.ignoredPaths.add(filepath);
    // Auto-remove after 5 seconds to prevent memory leaks
    setTimeout(() => {
      Watcher.ignoredPaths.delete(filepath);
    }, 5000);
  }

  /**
   * Start watching for new message files
   */
  static start() {
    if (Watcher.watching) {
      Logger.warn('watcher', 'Watcher already started');
      return;
    }

    // Clean up existing watcher if it exists (shouldn't happen, but defensive)
    if (Watcher.watcher) {
      Watcher.watcher.removeAllListeners();
      Watcher.watcher.close();
      Watcher.watcher = null;
    }

    Logger.log('watcher', 'Starting simplified watcher for msgs/ directories');

    // Main watcher - watch .ai/tx/mesh directory tree
    // NOTE: Glob patterns with .dotdirs don't work reliably in chokidar
    // So we watch the directory tree instead and filter in the handler
    Watcher.watcher = chokidar.watch('.ai/tx/mesh', {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/prompts/**',
        '**/*-done.md',  // Ignore completed messages
        /\/[^/]*\.json$/,  // Ignore JSON files
        /\/[^/]*\.txt$/    // Ignore TXT files
      ],
      ignoreInitial: true,
      persistent: true,
      depth: 99,  // Watch all subdirectories
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    // Detection watcher no longer needed since we watch the entire tree

    // Main watcher event - NEW file created
    Watcher.watcher.on('add', (filepath) => {
      // Only process .md files in msgs/ directories
      if (filepath.includes('/msgs/') && filepath.endsWith('.md')) {
        Watcher.handleFileAdded(filepath);
      }
    });

    Watcher.watcher.on('error', (error) => {
      Logger.error('watcher', `Watcher error: ${error.message}`);
    });

    Watcher.watcher.on('ready', () => {
      Logger.log('watcher', 'Simplified watcher ready');
    });

    // Set watching flag immediately after starting watchers
    Watcher.watching = true;
    Logger.log('watcher', 'Simplified watcher started successfully');
  }

  /**
   * Handle new file added event
   */
  static handleFileAdded(filepath) {
    // Check if we should ignore this file
    if (Watcher.ignoredPaths.has(filepath)) {
      Logger.log('watcher', `Ignoring file (marked as ignored): ${filepath}`);
      Watcher.ignoredPaths.delete(filepath);
      return;
    }

    // Skip -done files
    const filename = filepath.split('/').pop();
    if (filename.endsWith('-done.md')) {
      Logger.log('watcher', `Skipping completed message: ${filename}`);
      return;
    }

    // Parse filepath to extract mesh and optionally agent
    // Two formats supported:
    // 1. Agent messages: .ai/tx/mesh/{mesh}/agents/{agent}/msgs/{file}.md
    // 2. Mesh messages:  .ai/tx/mesh/{mesh}/msgs/{file}.md

    const agentMatch = filepath.match(/\.ai\/tx\/mesh\/([^/]+)\/agents\/([^/]+)\/msgs\/.+\.md$/);
    if (agentMatch) {
      const [, mesh, agent] = agentMatch;
      Logger.log('watcher', `New agent message detected: ${mesh}/${agent} - ${filename}`);

      // Emit event for agent message
      EventBus.emit('file:msgs:new', {
        mesh,
        agent,
        file: filename,
        filepath
      });
      return;
    }

    const meshMatch = filepath.match(/\.ai\/tx\/mesh\/([^/]+)\/msgs\/.+\.md$/);
    if (meshMatch) {
      const [, mesh] = meshMatch;
      Logger.log('watcher', `New mesh message detected: ${mesh} - ${filename}`);

      // Emit event for mesh message (no agent)
      EventBus.emit('file:msgs:new', {
        mesh,
        agent: null,
        file: filename,
        filepath
      });
      return;
    }

    Logger.log('watcher', `Skipping file (doesn't match any pattern): ${filepath}`);
  }

  /**
   * Stop watching
   */
  static async stop() {
    if (!Watcher.watching) {
      return;
    }

    Logger.log('watcher', 'Stopping simplified watcher...');

    if (Watcher.watcher) {
      await Watcher.watcher.close();
    }

    Watcher.watching = false;
    Watcher.ignoredPaths.clear();
    Logger.log('watcher', 'Simplified watcher stopped');
  }
}

module.exports = { Watcher };

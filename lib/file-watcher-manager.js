const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
const { EventEmitter } = require('events');
const { Logger } = require('./logger');

/**
 * FileWatcherManager - Watches a specific file for changes with delta tracking
 *
 * Features:
 * - 1-second debounce on file changes
 * - Queue changes during processing
 * - Delta tracking (only process new lines)
 * - State persistence
 * - Robust error handling
 */
class FileWatcherManager extends EventEmitter {
  constructor(filePath, meshName, options = {}) {
    super();

    this.filePath = path.resolve(filePath);
    this.meshName = meshName;
    this.debounceMs = options.debounceMs || 1000; // Default 1s debounce
    this.stateDir = options.stateDir || '.ai/tx/state/watchers';
    this.stateFile = path.join(this.stateDir, `${meshName}.json`);

    // State machine
    this.currentState = 'idle'; // idle | debouncing | processing
    this.watcher = null;
    this.debounceTimer = null;
    this.queuedChanges = 0;
    this.startedAt = null;

    // State persistence
    this.state = {
      meshName,
      watchedFile: this.filePath,
      lastProcessedLine: 0,
      lastProcessedAt: null,
      totalChangesProcessed: 0,
      currentState: 'idle',
      pid: process.pid,
      startedAt: null
    };
  }

  /**
   * Initialize and start watching
   */
  async start() {
    Logger.log('file-watcher', `Starting watcher for ${this.filePath} (mesh: ${this.meshName})`);

    // Load existing state if present
    await this.loadState();

    // Ensure state directory exists
    await fs.ensureDir(this.stateDir);

    // Update state
    this.startedAt = new Date().toISOString();
    this.state.startedAt = this.startedAt;
    this.state.pid = process.pid;
    await this.saveState();

    // Create chokidar watcher
    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      ignoreInitial: true, // Don't trigger on initial file read
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    // Handle file changes
    this.watcher.on('change', (filepath) => {
      this.handleFileChange(filepath);
    });

    // Handle file creation (if watching a file that doesn't exist yet)
    this.watcher.on('add', (filepath) => {
      Logger.log('file-watcher', `Watched file created: ${filepath}`);
      this.handleFileChange(filepath);
    });

    // Handle errors
    this.watcher.on('error', (error) => {
      Logger.error('file-watcher', `Watcher error: ${error.message}`);
      this.emit('error', error);
    });

    // Ready event
    this.watcher.on('ready', () => {
      Logger.log('file-watcher', `Watcher ready for ${this.filePath}`);
      this.emit('ready');
    });

    Logger.log('file-watcher', `Watcher started for ${this.meshName}`);
  }

  /**
   * Handle file change event
   */
  handleFileChange(filepath) {
    Logger.log('file-watcher', `File changed: ${filepath} (state: ${this.currentState})`);

    if (this.currentState === 'processing') {
      // Currently processing - queue this change
      this.queuedChanges++;
      Logger.log('file-watcher', `Change queued (${this.queuedChanges} queued)`);
      return;
    }

    if (this.currentState === 'debouncing') {
      // Already debouncing - reset timer
      Logger.log('file-watcher', `Resetting debounce timer`);
      clearTimeout(this.debounceTimer);
    }

    // Start/restart debounce
    this.currentState = 'debouncing';
    this.state.currentState = 'debouncing';

    this.debounceTimer = setTimeout(async () => {
      await this.processDelta();
    }, this.debounceMs);
  }

  /**
   * Process delta (new lines since last processing)
   */
  async processDelta() {
    try {
      this.currentState = 'processing';
      this.state.currentState = 'processing';
      await this.saveState();

      Logger.log('file-watcher', `Processing delta for ${this.filePath}`);

      // Check if file exists
      if (!await fs.pathExists(this.filePath)) {
        Logger.warn('file-watcher', `File does not exist: ${this.filePath}`);
        this.currentState = 'idle';
        this.state.currentState = 'idle';
        await this.saveState();
        return;
      }

      // Get delta
      const delta = await this.getDelta();

      if (!delta || delta.newLines.length === 0) {
        Logger.log('file-watcher', `No new content to process`);
        this.currentState = 'idle';
        this.state.currentState = 'idle';
        await this.saveState();
        return;
      }

      Logger.log('file-watcher', `Delta: ${delta.newLines.length} new lines (${delta.fromLine} → ${delta.toLine})`);

      // Emit delta event for processing
      this.emit('delta', {
        content: delta.content,
        newLines: delta.newLines,
        fromLine: delta.fromLine,
        toLine: delta.toLine,
        filepath: this.filePath
      });

      // Note: State will be updated when processing completes (via updateState method)

    } catch (error) {
      Logger.error('file-watcher', `Error processing delta: ${error.message}`);
      this.emit('error', error);

      // Return to idle on error
      this.currentState = 'idle';
      this.state.currentState = 'idle';
      await this.saveState();
    }
  }

  /**
   * Get delta - new lines since last processing
   */
  async getDelta() {
    try {
      // Read entire file
      const content = await fs.readFile(this.filePath, 'utf-8');
      const lines = content.split('\n');

      // Handle file truncation/rotation
      if (lines.length < this.state.lastProcessedLine) {
        Logger.warn('file-watcher', `File appears truncated (${lines.length} < ${this.state.lastProcessedLine}), resetting position`);
        this.state.lastProcessedLine = 0;
        await this.saveState();
      }

      // Get new lines
      const newLines = lines.slice(this.state.lastProcessedLine);

      // Remove trailing empty line if present (common in text files)
      if (newLines.length > 0 && newLines[newLines.length - 1] === '') {
        newLines.pop();
      }

      return {
        content: newLines.join('\n'),
        newLines,
        fromLine: this.state.lastProcessedLine,
        toLine: this.state.lastProcessedLine + newLines.length
      };

    } catch (error) {
      Logger.error('file-watcher', `Error getting delta: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update state after successful processing
   * Called externally when message processing completes
   */
  async updateState(newLineCount) {
    try {
      this.state.lastProcessedLine = newLineCount || this.state.lastProcessedLine;
      this.state.lastProcessedAt = new Date().toISOString();
      this.state.totalChangesProcessed++;

      await this.saveState();

      Logger.log('file-watcher', `State updated: line ${this.state.lastProcessedLine}, total processed: ${this.state.totalChangesProcessed}`);

      // Check if there are queued changes
      if (this.queuedChanges > 0) {
        Logger.log('file-watcher', `Processing ${this.queuedChanges} queued changes`);
        this.queuedChanges = 0;
        // Process next change
        await this.processDelta();
      } else {
        // Return to idle
        this.currentState = 'idle';
        this.state.currentState = 'idle';
        await this.saveState();
        this.emit('processing-complete');
      }

    } catch (error) {
      Logger.error('file-watcher', `Error updating state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load state from disk
   */
  async loadState() {
    try {
      if (await fs.pathExists(this.stateFile)) {
        const savedState = await fs.readJson(this.stateFile);

        // Merge saved state with defaults
        this.state = {
          ...this.state,
          ...savedState,
          // Always update these on load
          pid: process.pid,
          currentState: 'idle'
        };

        Logger.log('file-watcher', `Loaded state: last processed line ${this.state.lastProcessedLine}`);
      } else {
        Logger.log('file-watcher', `No existing state found, starting fresh`);
      }
    } catch (error) {
      Logger.error('file-watcher', `Error loading state: ${error.message}`);
      // Continue with default state
    }
  }

  /**
   * Save state to disk
   */
  async saveState() {
    try {
      await fs.writeJson(this.stateFile, this.state, { spaces: 2 });
    } catch (error) {
      Logger.error('file-watcher', `Error saving state: ${error.message}`);
    }
  }

  /**
   * Get current state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Stop watching
   */
  async stop() {
    Logger.log('file-watcher', `Stopping watcher for ${this.meshName}`);

    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Update state
    this.currentState = 'idle';
    this.state.currentState = 'stopped';
    await this.saveState();

    Logger.log('file-watcher', `Watcher stopped for ${this.meshName}`);
  }
}

module.exports = { FileWatcherManager };

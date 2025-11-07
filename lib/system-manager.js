const { Queue } = require('./queue');
const { Watcher } = require('./watcher');
const { SpawnHandler } = require('./spawn-handler');
const { Logger } = require('./logger');
const fs = require('fs-extra');
const path = require('path');

class SystemManager {
  static running = false;
  static watchersDir = '.ai/tx/state/watchers';

  /**
   * Start orchestration system
   * Initializes queue listeners and file watcher
   */
  static async start() {
    if (SystemManager.running) {
      Logger.warn('system-manager', 'System already running');
      return;
    }

    try {
      Logger.log('system-manager', 'Starting simplified orchestration system...');

      // Phase 2: Always use Queue for routing (single watcher + single router)
      // Queue handles message routing from centralized event log
      Queue.initialize();
      Logger.log('system-manager', 'Queue initialized for centralized message routing');

      // Initialize spawn handler for rearmatter-driven mesh spawning
      SpawnHandler.initialize();
      Logger.log('system-manager', 'Spawn handler initialized');

      // 2. Start file watcher
      Watcher.start();
      Logger.log('system-manager', 'Simplified watcher started');

      // 3. Give watcher a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      SystemManager.running = true;
      Logger.log('system-manager', 'Simplified orchestration system started successfully');

      return true;
    } catch (error) {
      Logger.error('system-manager', `Failed to start system: ${error.message}`, {
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Stop orchestration system
   */
  static async stop() {
    if (!SystemManager.running) {
      return;
    }

    try {
      Logger.log('system-manager', 'Stopping orchestration system...');

      await Watcher.stop();
      Logger.log('system-manager', 'Simplified watcher stopped');

      SpawnHandler.shutdown();
      Logger.log('system-manager', 'Spawn handler shut down');

      Queue.shutdown();
      Logger.log('system-manager', 'Simplified queue shut down');

      SystemManager.running = false;
      Logger.log('system-manager', 'Orchestration system stopped');

      return true;
    } catch (error) {
      Logger.error('system-manager', `Failed to stop system: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if system is running
   */
  static isRunning() {
    return SystemManager.running && Watcher.watching;
  }

  /**
   * Get system status
   */
  static getStatus() {
    return {
      running: SystemManager.running,
      watcherRunning: Watcher.watching,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get all active watchers
   * @returns {Promise<Array>} Array of watcher state objects
   */
  static async getActiveWatchers() {
    try {
      if (!await fs.pathExists(SystemManager.watchersDir)) {
        return [];
      }

      const files = await fs.readdir(SystemManager.watchersDir);
      const watcherStates = [];

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const statePath = path.join(SystemManager.watchersDir, file);
        const state = await fs.readJson(statePath);

        // Check if watcher is still active (process exists)
        const isActive = SystemManager.isProcessRunning(state.pid);

        watcherStates.push({
          ...state,
          isActive,
          stateFile: file
        });
      }

      return watcherStates;

    } catch (error) {
      Logger.error('system-manager', `Error getting active watchers: ${error.message}`);
      return [];
    }
  }

  /**
   * Get watcher state for a specific mesh
   * @param {string} meshName - The mesh name
   * @returns {Promise<Object|null>} Watcher state or null if not found
   */
  static async getWatcherState(meshName) {
    try {
      const statePath = path.join(SystemManager.watchersDir, `${meshName}.json`);

      if (!await fs.pathExists(statePath)) {
        return null;
      }

      const state = await fs.readJson(statePath);
      const isActive = SystemManager.isProcessRunning(state.pid);

      return {
        ...state,
        isActive
      };

    } catch (error) {
      Logger.error('system-manager', `Error getting watcher state: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if a process is running
   * @param {number} pid - Process ID
   * @returns {boolean} True if process is running
   */
  static isProcessRunning(pid) {
    try {
      // Send signal 0 to check if process exists
      // This doesn't actually send a signal, just checks if we could
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // ESRCH means process doesn't exist
      // EPERM means process exists but we don't have permission (still running)
      return error.code === 'EPERM';
    }
  }

  /**
   * Clean up stale watcher state files (for processes that are no longer running)
   * @returns {Promise<number>} Number of stale states cleaned up
   */
  static async cleanupStaleWatchers() {
    try {
      const watchers = await SystemManager.getActiveWatchers();
      let cleaned = 0;

      for (const watcher of watchers) {
        if (!watcher.isActive) {
          const statePath = path.join(SystemManager.watchersDir, watcher.stateFile);
          await fs.remove(statePath);
          cleaned++;
          Logger.log('system-manager', `Cleaned up stale watcher: ${watcher.meshName}`);
        }
      }

      return cleaned;

    } catch (error) {
      Logger.error('system-manager', `Error cleaning up stale watchers: ${error.message}`);
      return 0;
    }
  }
}

module.exports = { SystemManager };

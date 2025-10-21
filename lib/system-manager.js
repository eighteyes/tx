const { SimpleQueue } = require('./simple-queue');
const { SimpleWatcher } = require('./simple-watcher');
const { Logger } = require('./logger');
const fs = require('fs-extra');

class SystemManager {
  static running = false;

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

      // 1. Initialize queue event listeners (must be before watcher)
      SimpleQueue.initialize();
      Logger.log('system-manager', 'Simplified queue initialized');

      // 2. Start file watcher
      SimpleWatcher.start();
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

      await SimpleWatcher.stop();
      Logger.log('system-manager', 'Simplified watcher stopped');

      SimpleQueue.shutdown();
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
    return SystemManager.running && SimpleWatcher.watching;
  }

  /**
   * Get system status
   */
  static getStatus() {
    return {
      running: SystemManager.running,
      watcherRunning: SimpleWatcher.watching,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { SystemManager };

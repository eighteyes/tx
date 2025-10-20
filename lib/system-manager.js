const { Queue } = require('./queue');
const { Watcher } = require('./watcher');
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
      Logger.log('system-manager', 'Starting orchestration system...');

      // 1. Clear all message directories for clean startup
      Queue.clearAllMessages();
      Logger.log('system-manager', 'Message directories cleared');

      // 2. Initialize queue event listeners (must be before watcher)
      Queue.init();
      Logger.log('system-manager', 'Queue listeners registered');

      // 3. Start file watcher
      Watcher.start();
      Logger.log('system-manager', 'File watcher started');

      // 4. Wait for watcher to be ready
      await Watcher.ready();
      Logger.log('system-manager', 'Watcher ready');

      SystemManager.running = true;
      Logger.log('system-manager', 'Orchestration system started successfully');

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
      Logger.log('system-manager', 'Watcher stopped');

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
    return SystemManager.running && Watcher.isRunning();
  }

  /**
   * Get system status
   */
  static getStatus() {
    return {
      running: SystemManager.running,
      watcherRunning: Watcher.isRunning(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { SystemManager };

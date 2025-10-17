const { Queue } = require('./queue');
const { Watcher } = require('./watcher');
const { Logger } = require('./logger');
const fs = require('fs-extra');

class SystemManager {
  static running = false;

  /**
   * Start TX Watch system
   * Initializes queue listeners and file watcher
   */
  static async start() {
    if (SystemManager.running) {
      Logger.warn('system-manager', 'System already running');
      return;
    }

    try {
      Logger.log('system-manager', 'Starting TX Watch system...');

      // 1. Initialize queue event listeners (must be before watcher)
      Queue.init();
      Logger.log('system-manager', 'Queue listeners registered');

      // 2. Start file watcher
      Watcher.start();
      Logger.log('system-manager', 'File watcher started');

      // 3. Wait for watcher to be ready
      await Watcher.ready();
      Logger.log('system-manager', 'Watcher ready');

      SystemManager.running = true;
      Logger.log('system-manager', 'TX Watch system started successfully');

      return true;
    } catch (error) {
      Logger.error('system-manager', `Failed to start system: ${error.message}`, {
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Stop TX Watch system
   */
  static async stop() {
    if (!SystemManager.running) {
      return;
    }

    try {
      Logger.log('system-manager', 'Stopping TX Watch system...');

      await Watcher.stop();
      Logger.log('system-manager', 'Watcher stopped');

      SystemManager.running = false;
      Logger.log('system-manager', 'TX Watch system stopped');

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

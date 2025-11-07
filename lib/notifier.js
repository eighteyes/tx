const notifier = require('node-notifier');
const path = require('path');
const fs = require('fs-extra');
const { Logger } = require('./logger');

/**
 * Notifier - Cross-platform system notifications
 *
 * Sends desktop notifications to alert users when:
 * 1. Agents need human input (ask-human messages)
 * 2. Tools explicitly trigger notifications
 * 3. Important events occur
 *
 * Features:
 * - Cross-platform support (macOS, Linux, Windows)
 * - Rate limiting to prevent spam
 * - Quiet hours support
 * - Graceful degradation if notifications unavailable
 */
class Notifier {
  constructor() {
    this.enabled = true;
    this.quietHours = null; // { start: 22, end: 8 } = 10pm to 8am
    this.lastNotificationTime = 0;
    this.minNotificationInterval = 5000; // 5 seconds between notifications
    this.notificationQueue = [];
    this.isProcessing = false;
    this.configPath = 'config.json';
    this.isDocker = this.detectDocker();
    this.notificationFilePath = '.ai/tx/notifications.log';

    // Load config on initialization
    this.loadConfig();
  }

  /**
   * Detect if running in Docker container
   */
  detectDocker() {
    try {
      // Check for /.dockerenv file
      if (fs.existsSync('/.dockerenv')) {
        return true;
      }

      // Check cgroup for docker
      if (fs.existsSync('/proc/self/cgroup')) {
        const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
        if (cgroup.includes('docker') || cgroup.includes('containerd')) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load configuration from config file
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const config = fs.readJsonSync(this.configPath);
        if (config.notifications) {
          this.configure(config.notifications);
        }
      } else {
        Logger.log('notifier', 'No config file found, using defaults');
      }
    } catch (error) {
      Logger.warn('notifier', `Failed to load config: ${error.message}`);
    }
  }

  /**
   * Configure notifier settings
   * @param {object} config - Configuration options
   * @param {boolean} config.enabled - Enable/disable notifications
   * @param {object} config.quietHours - { start: hour, end: hour } (24h format)
   * @param {number} config.minInterval - Minimum milliseconds between notifications
   */
  configure(config = {}) {
    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
    }
    if (config.quietHours) {
      this.quietHours = config.quietHours;
    }
    if (config.minInterval !== undefined) {
      this.minNotificationInterval = config.minInterval;
    }

    Logger.log('notifier', 'Notifier configured', {
      enabled: this.enabled,
      quietHours: this.quietHours,
      minInterval: this.minNotificationInterval
    });
  }

  /**
   * Send a notification
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {object} options - Additional options
   * @param {string} options.priority - low, medium, high (affects sound/urgency)
   * @param {string} options.sound - Sound to play (true/false or sound name)
   * @param {function} options.callback - Callback for notification interaction
   */
  async send(title, message, options = {}) {
    if (!this.enabled) {
      Logger.log('notifier', 'Notifications disabled, skipping', { title });
      return;
    }

    if (this.isQuietHours()) {
      Logger.log('notifier', 'Quiet hours active, skipping notification', { title });
      return;
    }

    // Add to queue
    this.notificationQueue.push({
      title,
      message,
      options,
      timestamp: Date.now()
    });

    // Process queue
    if (!this.isProcessing) {
      await this.processQueue();
    }
  }

  /**
   * Process notification queue with rate limiting
   */
  async processQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.notificationQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastNotification = now - this.lastNotificationTime;

      // Rate limiting
      if (timeSinceLastNotification < this.minNotificationInterval) {
        const waitTime = this.minNotificationInterval - timeSinceLastNotification;
        Logger.log('notifier', `Rate limiting: waiting ${waitTime}ms`, {
          queueLength: this.notificationQueue.length
        });
        await this.sleep(waitTime);
      }

      const notification = this.notificationQueue.shift();
      await this.sendImmediate(notification.title, notification.message, notification.options);
      this.lastNotificationTime = Date.now();
    }

    this.isProcessing = false;
  }

  /**
   * Send notification immediately (bypassing queue)
   */
  async sendImmediate(title, message, options = {}) {
    try {
      // If in Docker, use fallback strategies
      if (this.isDocker) {
        await this.sendDockerFallback(title, message, options);
        return;
      }

      const notificationOptions = {
        title: title || 'TX System',
        message: message || 'Notification',
        sound: this.getSoundSetting(options.priority),
        wait: false,
        timeout: 10, // Auto-dismiss after 10 seconds
        ...this.getPlatformSpecificOptions(options)
      };

      Logger.log('notifier', 'Sending notification', {
        title,
        message: message.substring(0, 50),
        priority: options.priority
      });

      notifier.notify(notificationOptions, (err, response) => {
        if (err) {
          Logger.error('notifier', `Notification failed: ${err.message}`);
          // Try Docker fallback if system notification fails
          this.sendDockerFallback(title, message, options);
        } else {
          Logger.log('notifier', 'Notification sent successfully', { response });
        }

        if (options.callback) {
          options.callback(err, response);
        }
      });
    } catch (error) {
      Logger.error('notifier', `Failed to send notification: ${error.message}`, {
        title,
        error: error.stack
      });
      // Try Docker fallback on error
      await this.sendDockerFallback(title, message, options);
    }
  }

  /**
   * Fallback notification strategies for Docker/containerized environments
   */
  async sendDockerFallback(title, message, options = {}) {
    Logger.log('notifier', 'Using Docker fallback notification', { title, isDocker: this.isDocker });

    // Strategy 1: Terminal bell (multiple beeps based on priority)
    const beeps = options.priority === 'high' ? 3 : options.priority === 'medium' ? 2 : 1;
    for (let i = 0; i < beeps; i++) {
      process.stdout.write('\x07'); // ASCII bell character
      await this.sleep(200);
    }

    // Strategy 2: Visual terminal alert with color
    const colorCode = options.priority === 'high' ? '\x1b[31m' : options.priority === 'medium' ? '\x1b[33m' : '\x1b[36m';
    const resetCode = '\x1b[0m';
    const icon = options.priority === 'high' ? '🚨' : options.priority === 'medium' ? '🔔' : 'ℹ️';

    console.log('\n' + '='.repeat(70));
    console.log(`${colorCode}${icon} TX NOTIFICATION${resetCode}`);
    console.log(`${colorCode}${title}${resetCode}`);
    if (message && message !== title) {
      console.log(message);
    }
    console.log('='.repeat(70) + '\n');

    // Strategy 3: Write to notification file for host monitoring
    await this.writeNotificationFile(title, message, options);
  }

  /**
   * Write notification to file that can be monitored by host
   */
  async writeNotificationFile(title, message, options = {}) {
    try {
      const notification = {
        timestamp: new Date().toISOString(),
        title,
        message,
        priority: options.priority || 'medium',
        read: false
      };

      await fs.ensureDir(path.dirname(this.notificationFilePath));

      // Append to notification log
      await fs.appendFile(
        this.notificationFilePath,
        JSON.stringify(notification) + '\n'
      );

      Logger.log('notifier', 'Notification written to file', {
        filepath: this.notificationFilePath,
        title
      });
    } catch (error) {
      Logger.error('notifier', `Failed to write notification file: ${error.message}`);
    }
  }

  /**
   * Get sound setting based on priority
   */
  getSoundSetting(priority) {
    if (priority === 'high') {
      return true; // Use default sound
    } else if (priority === 'medium') {
      return true;
    } else {
      return false; // Silent for low priority
    }
  }

  /**
   * Get platform-specific notification options
   */
  getPlatformSpecificOptions(options) {
    const platformOptions = {};

    // macOS specific
    if (process.platform === 'darwin') {
      platformOptions.subtitle = options.subtitle;
      platformOptions.contentImage = options.icon;
    }

    // Linux specific
    if (process.platform === 'linux') {
      platformOptions.urgency = this.getUrgencyLevel(options.priority);
      platformOptions.category = 'tx.notification';
    }

    // Windows specific
    if (process.platform === 'win32') {
      platformOptions.appID = 'TX System';
    }

    return platformOptions;
  }

  /**
   * Get urgency level for Linux notifications
   */
  getUrgencyLevel(priority) {
    switch (priority) {
      case 'high':
        return 'critical';
      case 'medium':
        return 'normal';
      default:
        return 'low';
    }
  }

  /**
   * Check if current time is within quiet hours
   */
  isQuietHours() {
    if (!this.quietHours) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const { start, end } = this.quietHours;

    // Handle quiet hours that span midnight (e.g., 22:00 to 8:00)
    if (start > end) {
      return currentHour >= start || currentHour < end;
    } else {
      return currentHour >= start && currentHour < end;
    }
  }

  /**
   * Send notification for ask-human message
   */
  async notifyAskHuman(from, question, priority = 'high') {
    const agentName = this.extractAgentName(from);
    const title = `Question from ${agentName}`;
    const message = this.truncateMessage(question, 100);

    await this.send(title, message, {
      priority,
      sound: true
    });
  }

  /**
   * Extract agent name from full path (e.g., "research-123/interviewer" -> "interviewer")
   */
  extractAgentName(agentPath) {
    if (!agentPath) {
      return 'agent';
    }
    const parts = agentPath.split('/');
    return parts[parts.length - 1] || 'agent';
  }

  /**
   * Truncate message to fit in notification
   */
  truncateMessage(text, maxLength) {
    if (!text || text.length <= maxLength) {
      return text || '';
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear notification queue
   */
  clearQueue() {
    this.notificationQueue = [];
    Logger.log('notifier', 'Notification queue cleared');
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      queueLength: this.notificationQueue.length,
      isProcessing: this.isProcessing,
      quietHours: this.quietHours,
      isQuietNow: this.isQuietHours()
    };
  }
}

// Singleton instance
const notifierInstance = new Notifier();

module.exports = { Notifier: notifierInstance };

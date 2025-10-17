const fs = require('fs-extra');
const path = require('path');

class Logger {
  static logsDir = '.ai/tx/logs';
  static debugLog = path.join(Logger.logsDir, 'debug.jsonl');
  static errorLog = path.join(Logger.logsDir, 'error.jsonl');
  static maxLines = 1000;

  /**
   * Initialize logs directory
   */
  static init() {
    fs.ensureDirSync(Logger.logsDir);
  }

  /**
   * Write a log entry in JSONL format
   */
  static _write(logFile, component, message, level, metadata = {}) {
    Logger.init();

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...metadata
    };

    try {
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

      // Trim log if too long
      const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim());
      if (lines.length > Logger.maxLines) {
        fs.writeFileSync(logFile, lines.slice(-Logger.maxLines).join('\n') + '\n');
      }
    } catch (error) {
      console.error(`Failed to write log: ${error.message}`);
    }
  }

  /**
   * Log info message
   */
  static log(component, message, metadata = {}) {
    Logger._write(Logger.debugLog, component, message, 'info', metadata);
  }

  /**
   * Log warning
   */
  static warn(component, message, metadata = {}) {
    Logger._write(Logger.debugLog, component, message, 'warn', metadata);
  }

  /**
   * Log error
   */
  static error(component, message, metadata = {}) {
    Logger._write(Logger.errorLog, component, message, 'error', metadata);
  }

  /**
   * Get last N log entries, optionally filtered by component
   */
  static tail(n = 10, component = null) {
    Logger.init();

    const entries = [];

    // Combine both logs and sort by timestamp
    const readLog = (file) => {
      if (fs.existsSync(file)) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(l => l.trim());
        lines.forEach(line => {
          try {
            const entry = JSON.parse(line);
            if (!component || entry.component === component) {
              entries.push(entry);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        });
      }
    };

    readLog(Logger.debugLog);
    readLog(Logger.errorLog);

    // Sort by timestamp descending and return last N
    return entries
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, n);
  }

  /**
   * Clear all logs
   */
  static clear() {
    Logger.init();
    if (fs.existsSync(Logger.debugLog)) {
      fs.removeSync(Logger.debugLog);
    }
    if (fs.existsSync(Logger.errorLog)) {
      fs.removeSync(Logger.errorLog);
    }
  }
}

module.exports = { Logger };

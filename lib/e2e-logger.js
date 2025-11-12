const fs = require('fs-extra');
const path = require('path');

/**
 * Logger for E2E tests
 * Writes logs to .ai/tx/logs/e2e-test.log
 */
class E2ELogger {
  constructor(logFilePath = '.ai/tx/logs/e2e-test.log') {
    this.logFilePath = logFilePath;
    this.sessionStartTime = Date.now();

    // Ensure log directory exists
    const logDir = path.dirname(this.logFilePath);
    fs.ensureDirSync(logDir);

    // Clear or create log file with session header
    const timestamp = new Date().toISOString();
    fs.writeFileSync(
      this.logFilePath,
      `\n${'='.repeat(80)}\n` +
      `E2E Test Session Started: ${timestamp}\n` +
      `${'='.repeat(80)}\n\n`,
      { flag: 'a' }
    );
  }

  /**
   * Write a log entry with timestamp and level
   */
  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const elapsed = Date.now() - this.sessionStartTime;
    const elapsedStr = `+${(elapsed / 1000).toFixed(3)}s`;

    let logEntry = `[${timestamp}] [${elapsedStr}] [${level.toUpperCase()}] ${message}`;

    if (data) {
      if (typeof data === 'object') {
        logEntry += '\n' + JSON.stringify(data, null, 2);
      } else {
        logEntry += '\n' + String(data);
      }
    }

    logEntry += '\n';

    // Write to log file
    try {
      fs.appendFileSync(this.logFilePath, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }

    // Also output to console for visibility
    console.log(logEntry.trim());
  }

  info(message, data = null) {
    this.log('info', message, data);
  }

  debug(message, data = null) {
    this.log('debug', message, data);
  }

  warn(message, data = null) {
    this.log('warn', message, data);
  }

  error(message, data = null) {
    this.log('error', message, data);
  }

  success(message, data = null) {
    this.log('success', message, data);
  }

  /**
   * Log a test step
   */
  step(stepNumber, description) {
    const separator = '-'.repeat(60);
    this.log('step', `Step ${stepNumber}: ${description}\n${separator}`);
  }

  /**
   * Log workflow status
   */
  workflowStatus(status, details = {}) {
    this.log('workflow', `Status: ${status}`, details);
  }

  /**
   * Log session information
   */
  sessionInfo(sessionName, info) {
    this.log('session', `Session: ${sessionName}`, info);
  }

  /**
   * Log message delivery information
   */
  messageInfo(messageType, from, to, details = {}) {
    this.log('message', `${messageType}: ${from} -> ${to}`, details);
  }

  /**
   * Write session end marker
   */
  endSession(testPassed, duration) {
    const timestamp = new Date().toISOString();
    const separator = '='.repeat(80);
    const status = testPassed ? 'PASSED' : 'FAILED';

    const summary = `\n${separator}\n` +
      `E2E Test Session Ended: ${timestamp}\n` +
      `Status: ${status}\n` +
      `Duration: ${(duration / 1000).toFixed(3)}s\n` +
      `${separator}\n\n`;

    fs.appendFileSync(this.logFilePath, summary);
    console.log(summary.trim());
  }
}

module.exports = { E2ELogger };

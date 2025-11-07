const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const { RetryQueue } = require('../retry-queue');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  white: '\x1b[37m'
};

/**
 * Check if directory exists and get file count
 */
async function checkDirectory(dirPath) {
  try {
    if (!await fs.pathExists(dirPath)) {
      return { exists: false, count: 0 };
    }

    const files = await fs.readdir(dirPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    return { exists: true, count: mdFiles.length };
  } catch (error) {
    return { exists: false, count: 0, error: error.message };
  }
}

/**
 * Get active tmux sessions
 */
function getActiveSessions() {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });

    return output.trim().split('\n').filter(s => s.length > 0);
  } catch (error) {
    return [];
  }
}

/**
 * Get recent log entries
 */
async function getRecentErrors() {
  try {
    const errorLog = '.ai/tx/logs/error.jsonl';

    if (!await fs.pathExists(errorLog)) {
      return [];
    }

    const content = await fs.readFile(errorLog, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);

    const errors = lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(e => e !== null);

    // Get errors from last hour
    const oneHourAgo = Date.now() - 3600000;
    return errors.filter(e => new Date(e.timestamp).getTime() > oneHourAgo);
  } catch (error) {
    return [];
  }
}

/**
 * Get system uptime (when was first message sent)
 */
async function getSystemUptime() {
  try {
    const logDir = '.ai/tx/msgs';
    if (!await fs.pathExists(logDir)) {
      return null;
    }

    const files = await fs.readdir(logDir);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();

    if (mdFiles.length === 0) {
      return null;
    }

    // Parse timestamp from first file
    const firstFile = mdFiles[0];
    const timestamp = firstFile.substring(0, 10);
    const mm = timestamp.substring(0, 2);
    const dd = timestamp.substring(2, 4);
    const hh = timestamp.substring(4, 6);
    const min = timestamp.substring(6, 8);
    const ss = timestamp.substring(8, 10);

    const year = new Date().getFullYear();
    const firstMessageTime = new Date(`${year}-${mm}-${dd}T${hh}:${min}:${ss}`);

    return firstMessageTime;
  } catch (error) {
    return null;
  }
}

/**
 * Format duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Display health status
 */
function displayHealth(healthData, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(healthData, null, 2));
    return;
  }

  console.log(`\n${colors.bright}${colors.cyan}❤️  System Health${colors.reset}\n`);

  // Overall status
  const status = healthData.status === 'healthy' ? colors.green : colors.yellow;
  const statusIcon = healthData.status === 'healthy' ? '✓' : '⚠';
  console.log(`${status}${statusIcon} Status: ${healthData.status}${colors.reset}\n`);

  // Uptime
  if (healthData.uptime) {
    console.log(`${colors.dim}Uptime:${colors.reset}           ${colors.bright}${healthData.uptime}${colors.reset}`);
  }
  console.log();

  // Event Log
  console.log(`${colors.bright}Event Log${colors.reset}`);
  const eventLogStatus = healthData.event_log.exists ? colors.green + '●' : colors.red + '○';
  console.log(`${eventLogStatus} ${colors.dim}Status:${colors.reset}         ${healthData.event_log.exists ? 'Active' : 'Not found'}`);
  if (healthData.event_log.exists) {
    console.log(`  ${colors.dim}Messages:${colors.reset}       ${colors.bright}${healthData.event_log.count}${colors.reset}`);
  }
  console.log();

  // Sessions
  console.log(`${colors.bright}Active Sessions${colors.reset}`);
  const sessionStatus = healthData.active_sessions > 0 ? colors.green + '●' : colors.yellow + '○';
  console.log(`${sessionStatus} ${colors.dim}Count:${colors.reset}          ${colors.bright}${healthData.active_sessions}${colors.reset}`);
  if (healthData.sessions.length > 0) {
    healthData.sessions.forEach(session => {
      console.log(`  ${colors.dim}•${colors.reset} ${colors.cyan}${session}${colors.reset}`);
    });
  } else {
    console.log(`  ${colors.dim}No active sessions${colors.reset}`);
  }
  console.log();

  // Session Capture
  console.log(`${colors.bright}Session Capture${colors.reset}`);
  const captureStatus = healthData.session_capture.exists ? colors.green + '●' : colors.yellow + '○';
  console.log(`${captureStatus} ${colors.dim}Status:${colors.reset}         ${healthData.session_capture.exists ? 'Configured' : 'Not configured'}`);
  if (healthData.session_capture.exists) {
    console.log(`  ${colors.dim}Captured:${colors.reset}       ${colors.bright}${healthData.session_capture.count}${colors.reset} sessions`);
  }
  console.log();

  // Logs
  console.log(`${colors.bright}System Logs${colors.reset}`);
  const debugStatus = healthData.logs.debug ? colors.green + '●' : colors.red + '○';
  const errorStatus = healthData.logs.error ? colors.green + '●' : colors.red + '○';
  console.log(`${debugStatus} ${colors.dim}Debug log:${colors.reset}      ${healthData.logs.debug ? 'Active' : 'Not found'}`);
  console.log(`${errorStatus} ${colors.dim}Error log:${colors.reset}      ${healthData.logs.error ? 'Active' : 'Not found'}`);
  console.log();

  // Errors
  if (healthData.recent_errors > 0) {
    console.log(`${colors.bright}${colors.red}Recent Errors${colors.reset}`);
    console.log(`${colors.red}⚠${colors.reset} ${colors.dim}Last hour:${colors.reset}      ${colors.red}${colors.bright}${healthData.recent_errors}${colors.reset} errors`);
    console.log();
  }

  // Retry Queue
  console.log(`${colors.bright}Retry Queue${colors.reset}`);
  const retryStatus = healthData.retry_queue.total > 0 ? colors.yellow + '●' : colors.green + '●';
  console.log(`${retryStatus} ${colors.dim}Pending:${colors.reset}        ${colors.bright}${healthData.retry_queue.total}${colors.reset} retries`);
  if (healthData.retry_queue.total > 0) {
    const sessions = Object.entries(healthData.retry_queue.bySession);
    sessions.forEach(([session, count]) => {
      console.log(`  ${colors.dim}•${colors.reset} ${colors.cyan}${session}${colors.reset}: ${count}`);
    });
  }
  console.log();

  // Issues
  if (healthData.issues.length > 0) {
    console.log(`${colors.bright}${colors.yellow}Issues${colors.reset}`);
    healthData.issues.forEach(issue => {
      console.log(`${colors.yellow}⚠${colors.reset} ${issue}`);
    });
    console.log();
  }
}

/**
 * Collect health data
 */
async function collectHealthData() {
  const eventLog = await checkDirectory('.ai/tx/msgs');
  const sessionCapture = await checkDirectory('.ai/tx/session');
  const activeSessions = getActiveSessions();
  const recentErrors = await getRecentErrors();
  const uptime = await getSystemUptime();

  const debugLog = await fs.pathExists('.ai/tx/logs/debug.jsonl');
  const errorLog = await fs.pathExists('.ai/tx/logs/error.jsonl');

  // Get retry queue status
  const retryQueueStatus = RetryQueue.getStatus();

  // Determine issues
  const issues = [];
  if (!eventLog.exists) {
    issues.push('Event log directory not found');
  }
  if (activeSessions.length === 0) {
    issues.push('No active sessions');
  }
  if (recentErrors.length > 5) {
    issues.push(`High error rate: ${recentErrors.length} errors in last hour`);
  }
  if (retryQueueStatus.total > 10) {
    issues.push(`High retry queue: ${retryQueueStatus.total} pending retries`);
  }

  // Determine overall status
  let status = 'healthy';
  if (issues.length > 0 || recentErrors.length > 0) {
    status = 'degraded';
  }
  if (!eventLog.exists || !debugLog || !errorLog) {
    status = 'unhealthy';
  }

  return {
    status,
    uptime: uptime ? formatDuration(Date.now() - uptime.getTime()) : 'Unknown',
    event_log: eventLog,
    session_capture: sessionCapture,
    active_sessions: activeSessions.length,
    sessions: activeSessions,
    logs: {
      debug: debugLog,
      error: errorLog
    },
    recent_errors: recentErrors.length,
    retry_queue: retryQueueStatus,
    issues
  };
}

/**
 * Watch mode (refresh every N seconds)
 */
async function healthWatch(options = {}) {
  const refreshInterval = parseInt(options.interval || '5') * 1000;

  console.clear();

  async function refresh() {
    const healthData = await collectHealthData();
    console.clear();
    displayHealth(healthData, options);
    console.log(`${colors.dim}Refreshing every ${refreshInterval / 1000}s... (Press Ctrl+C to exit)${colors.reset}\n`);
  }

  await refresh();

  const interval = setInterval(refresh, refreshInterval);

  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(`\n${colors.dim}Stopped watching health${colors.reset}\n`);
    process.exit(0);
  });
}

/**
 * Main health command
 */
async function health(options = {}) {
  // Watch mode
  if (options.watch) {
    return healthWatch(options);
  }

  // Normal mode: single check
  const healthData = await collectHealthData();
  displayHealth(healthData, options);
}

module.exports = { health };

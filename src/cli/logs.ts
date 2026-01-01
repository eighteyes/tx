/**
 * tx logs - View system logs
 *
 * Features:
 * - Interactive mode with filter toggles
 * - Filter by component, severity
 * - Follow mode for real-time updates
 * - Clear logs option
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { colors } from '../shared/colors.ts';

// Component color mapping
const componentColors: Record<string, string> = {
  'queue': colors.blue,
  'consumer': colors.green,
  'dispatcher': colors.cyan,
  'worker': colors.magenta,
  'core': colors.yellow,
  'tmux': colors.yellow,
  'provider': colors.blue,
  'injector': colors.yellow,
  'watcher': colors.magenta,
  'start': colors.cyan,
  'stop': colors.red,
  'error': colors.red,
  'quality': colors.magenta,
  'headless-runner': colors.cyan
};

interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  [key: string]: unknown;
}

interface LogsOptions {
  lines?: string;
  component?: string;
  level?: string;
  follow?: boolean;
  noInteractive?: boolean;
  noFollow?: boolean;
  last?: boolean;
}

function getComponentColor(component: string): string {
  return componentColors[component] || colors.white;
}

function getLevelColor(level: string): string {
  switch (level) {
    case 'error': return colors.red;
    case 'warn': return colors.yellow;
    case 'info': return colors.white;
    case 'debug': return colors.dim;
    default: return colors.white;
  }
}

function getLevelBadge(level: string): string {
  const badges: Record<string, string> = {
    'error': '✗',
    'warn': '⚠',
    'info': ' ',
    'debug': '·'
  };
  return badges[level] || '·';
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};

  function flatten(current: unknown, path: string): void {
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        const newPath = path ? `${path}[${index}]` : `[${index}]`;
        if (typeof item === 'object' && item !== null) {
          flatten(item, newPath);
        } else {
          flattened[newPath] = item;
        }
      });
    } else if (current !== null && typeof current === 'object') {
      Object.entries(current as Record<string, unknown>).forEach(([key, value]) => {
        const newPath = path ? `${path}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
          flatten(value, newPath);
        } else {
          flattened[newPath] = value;
        }
      });
    } else {
      flattened[prefix] = current;
    }
  }

  flatten(obj, prefix);
  return flattened;
}

function formatLogEntry(entry: LogEntry): string {
  const timestamp = colors.dim + formatTimestamp(entry.timestamp) + colors.reset;
  const componentColor = getComponentColor(entry.component);
  const component = componentColor + entry.component.padEnd(14) + colors.reset;
  const levelColor = getLevelColor(entry.level);
  const badge = levelColor + getLevelBadge(entry.level) + colors.reset;

  // Extract metadata
  const { timestamp: _, level, component: __, message, ...metadata } = entry;

  // Flatten nested objects
  const flattenedPairs: [string, unknown][] = [];
  Object.entries(metadata).forEach(([key, value]) => {
    if (typeof value === 'object' && value !== null) {
      const flattened = flattenObject(value as Record<string, unknown>, key);
      Object.entries(flattened).forEach(([flatKey, flatValue]) => {
        flattenedPairs.push([flatKey, flatValue]);
      });
    } else {
      flattenedPairs.push([key, value]);
    }
  });

  let line = `${badge} ${timestamp} ${component} ${colors.bright}${message}${colors.reset}`;

  if (flattenedPairs.length > 0) {
    const metadataStr = flattenedPairs
      .map(([key, value]) => {
        const displayValue = String(value).length > 80 ? String(value).substring(0, 80) + '...' : String(value);
        return `${colors.dim}${key}:${colors.reset}${displayValue}`;
      })
      .join(' ');
    line += ` ${colors.dim}|${colors.reset} ${metadataStr}`;
  }

  return line;
}

function readJSONLFile(filePath: string): LogEntry[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter((entry): entry is LogEntry => entry !== null);
  } catch {
    return [];
  }
}

function mergeSortLogs(debugLogs: LogEntry[], errorLogs: LogEntry[]): LogEntry[] {
  return [...debugLogs, ...errorLogs].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * Interactive logs viewer
 */
async function logsInteractive(options: LogsOptions = {}): Promise<void> {
  const lines = parseInt(options.lines || '50', 10);
  const logSuffix = options.last ? '.last.jsonl' : '.jsonl';
  const workDir = process.env.TX_CWD || process.cwd();
  const v4Log = path.join(workDir, `.ai/tx/logs/v4${logSuffix}`);
  const debugLog = path.join(workDir, `.ai/tx/logs/debug${logSuffix}`);
  const errorLog = path.join(workDir, `.ai/tx/logs/error${logSuffix}`);

  const activeFilters = new Set<string>();
  const activeSeverityFilters = new Set<string>();
  let lastTimestamp = Date.now();
  let watchInterval: NodeJS.Timeout | null = null;

  const filterMap: Record<string, { component: string; label: string }> = {
    worker: { component: 'worker', label: 'worker' },
    queue: { component: 'queue', label: 'queue' },
    core: { component: 'core', label: 'core' },
    dispatcher: { component: 'dispatcher', label: 'dispatch' },
    consumer: { component: 'consumer', label: 'consumer' },
    watcher: { component: 'watcher', label: 'watcher' }
  };

  function getFilteredLogs(): LogEntry[] {
    let v4Logs = readJSONLFile(v4Log);
    let debugLogs = readJSONLFile(debugLog);
    let errorLogs = readJSONLFile(errorLog);
    let allLogs = [...v4Logs, ...debugLogs, ...errorLogs];

    if (activeSeverityFilters.size > 0) {
      const activeLevels = Array.from(activeSeverityFilters);
      allLogs = allLogs.filter(log => activeLevels.includes(log.level));
    }

    if (activeFilters.size > 0) {
      const activeComponents = Array.from(activeFilters).map(f => filterMap[f]?.component || f);
      allLogs = allLogs.filter(log => activeComponents.some(c => log.component.includes(c)));
    }

    return allLogs.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ).slice(-lines);
  }

  function clearLogFiles(): void {
    try {
      if (fs.existsSync(v4Log)) fs.writeFileSync(v4Log, '');
      if (fs.existsSync(debugLog)) fs.writeFileSync(debugLog, '');
      if (fs.existsSync(errorLog)) fs.writeFileSync(errorLog, '');
    } catch { /* ignore */ }
  }

  function displayHeader(): void {
    const filterOptions = [
      { key: 'w', label: 'worker', filter: 'worker', color: colors.magenta },
      { key: 'd', label: 'dispatch', filter: 'dispatcher', color: colors.cyan },
      { key: 'n', label: 'consumer', filter: 'consumer', color: colors.green },
      { key: 'u', label: 'queue', filter: 'queue', color: colors.blue },
      { key: 'o', label: 'core', filter: 'core', color: colors.yellow },
      { key: 't', label: 'watcher', filter: 'watcher', color: colors.magenta }
    ];

    const filterDisplay = filterOptions.map(opt => {
      const isActive = activeFilters.has(opt.filter);
      if (isActive) {
        return `${colors.bright}${opt.color}█ ${opt.label}${colors.reset}`;
      } else {
        return `${colors.dim}${opt.key} ${opt.label}${colors.reset}`;
      }
    }).join('  ');

    const severityOptions = [
      { key: '1', label: 'info', level: 'info', color: colors.white },
      { key: '2', label: 'warn', level: 'warn', color: colors.yellow },
      { key: '3', label: 'error', level: 'error', color: colors.red },
      { key: '4', label: 'debug', level: 'debug', color: colors.dim }
    ];

    const severityDisplay = severityOptions.map(opt => {
      const isActive = activeSeverityFilters.has(opt.level);
      if (isActive) {
        return `${colors.bright}${opt.color}█ ${opt.label}${colors.reset}`;
      } else {
        return `${colors.dim}${opt.key} ${opt.label}${colors.reset}`;
      }
    }).join('  ');

    const hasFilters = activeFilters.size > 0 || activeSeverityFilters.size > 0;
    const mode = hasFilters
      ? `${colors.dim}[filtered]${colors.reset}`
      : `${colors.dim}[all]${colors.reset}`;

    const sessionLabel = options.last ? `${colors.yellow}[prev session]${colors.reset}` : '';

    console.log(`${colors.dim}tx logs${colors.reset}${sessionLabel}  ${filterDisplay}  |  ${severityDisplay}  |  ${colors.green}a${colors.reset}${colors.dim} clear${colors.reset}  ${colors.red}c${colors.reset}${colors.dim} clear-logs  q quit ${mode}${colors.reset}\n`);
  }

  function displayLogs(): void {
    console.clear();

    const logs = getFilteredLogs();
    if (logs.length === 0) {
      console.log(`${colors.dim}No logs found.${colors.reset}\n`);
    } else {
      logs.forEach(entry => console.log(formatLogEntry(entry)));
    }

    console.log();
    displayHeader();
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }

    const keyName = (str || '').toLowerCase();

    switch (keyName) {
      case 'w':
        toggleFilter('worker');
        break;
      case 'd':
        toggleFilter('dispatcher');
        break;
      case 'n':
        toggleFilter('consumer');
        break;
      case 'u':
        toggleFilter('queue');
        break;
      case 'o':
        toggleFilter('core');
        break;
      case 't':
        toggleFilter('watcher');
        break;
      case '1':
        toggleSeverity('info');
        break;
      case '2':
        toggleSeverity('warn');
        break;
      case '3':
        toggleSeverity('error');
        break;
      case '4':
        toggleSeverity('debug');
        break;
      case 'a':
        activeFilters.clear();
        activeSeverityFilters.clear();
        displayLogs();
        break;
      case 'c':
        clearLogFiles();
        lastTimestamp = Date.now();
        displayLogs();
        break;
      case 'q':
        cleanup();
        process.exit(0);
        break;
    }
  });

  function toggleFilter(filter: string): void {
    if (activeFilters.has(filter)) {
      activeFilters.delete(filter);
    } else {
      activeFilters.add(filter);
    }
    displayLogs();
  }

  function toggleSeverity(level: string): void {
    if (activeSeverityFilters.has(level)) {
      activeSeverityFilters.delete(level);
    } else {
      activeSeverityFilters.add(level);
    }
    displayLogs();
  }

  function cleanup(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    if (watchInterval) clearInterval(watchInterval);
    console.log(`\n${colors.dim}Stopped watching logs${colors.reset}\n`);
  }

  displayLogs();

  // Watch for new logs
  watchInterval = setInterval(() => {
    let v4Logs = readJSONLFile(v4Log);
    let debugLogs = readJSONLFile(debugLog);
    let errorLogs = readJSONLFile(errorLog);
    let allLogs = [...v4Logs, ...debugLogs, ...errorLogs];

    if (activeSeverityFilters.size > 0) {
      const activeLevels = Array.from(activeSeverityFilters);
      allLogs = allLogs.filter(log => activeLevels.includes(log.level));
    }

    if (activeFilters.size > 0) {
      const activeComponents = Array.from(activeFilters).map(f => filterMap[f]?.component || f);
      allLogs = allLogs.filter(log => activeComponents.some(c => log.component.includes(c)));
    }

    const newLogs = allLogs.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return logTime > lastTimestamp;
    }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (newLogs.length > 0) {
      displayLogs();
      lastTimestamp = new Date(newLogs[newLogs.length - 1].timestamp).getTime();
    }
  }, 500);

  process.on('SIGINT', cleanup);
}

/**
 * Simple logs list
 */
async function logsList(options: LogsOptions): Promise<void> {
  const lines = parseInt(options.lines || '50', 10);
  const component = options.component || null;
  const level = options.level || null;
  const follow = !options.noFollow && !options.last; // Disable follow for --last

  const logSuffix = options.last ? '.last.jsonl' : '.jsonl';
  const workDir = process.env.TX_CWD || process.cwd();
  const v4Log = path.join(workDir, `.ai/tx/logs/v4${logSuffix}`);
  const debugLog = path.join(workDir, `.ai/tx/logs/debug${logSuffix}`);
  const errorLog = path.join(workDir, `.ai/tx/logs/error${logSuffix}`);

  let v4Logs = readJSONLFile(v4Log);
  let debugLogs = readJSONLFile(debugLog);
  let errorLogs = readJSONLFile(errorLog);
  let allLogs = [...v4Logs, ...debugLogs, ...errorLogs];

  if (level) {
    allLogs = allLogs.filter(log => log.level === level);
  }

  if (component) {
    allLogs = allLogs.filter(log => log.component.includes(component));
  }

  allLogs = allLogs.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const displayLogs = allLogs.slice(-lines);

  console.log(`\n${colors.bright}${colors.cyan}📋 TX Logs${colors.reset} ${colors.dim}(${displayLogs.length} entries)${colors.reset}\n`);

  displayLogs.forEach(entry => console.log(formatLogEntry(entry)));

  if (follow) {
    console.log(`\n${colors.dim}Watching for new logs... (Ctrl+C to exit)${colors.reset}\n`);

    let lastTimestamp = displayLogs.length > 0
      ? new Date(displayLogs[displayLogs.length - 1].timestamp).getTime()
      : Date.now();

    const watchInterval = setInterval(() => {
      let freshV4Logs = readJSONLFile(v4Log);
      let freshDebugLogs = readJSONLFile(debugLog);
      let freshErrorLogs = readJSONLFile(errorLog);
      let freshLogs = [...freshV4Logs, ...freshDebugLogs, ...freshErrorLogs];

      if (component) {
        freshLogs = freshLogs.filter(log => log.component.includes(component));
      }
      if (level) {
        freshLogs = freshLogs.filter(log => log.level === level);
      }

      const newLogs = freshLogs.filter(log => {
        const logTime = new Date(log.timestamp).getTime();
        return logTime > lastTimestamp;
      }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (newLogs.length > 0) {
        newLogs.forEach(entry => console.log(formatLogEntry(entry)));
        lastTimestamp = new Date(newLogs[newLogs.length - 1].timestamp).getTime();
      }
    }, 500);

    process.on('SIGINT', () => {
      clearInterval(watchInterval);
      console.log(`\n${colors.dim}Stopped watching logs${colors.reset}\n`);
      process.exit(0);
    });
  } else {
    console.log();
  }
}

/**
 * Main logs command
 */
export async function logs(options: LogsOptions = {}): Promise<void> {
  // Interactive mode is default unless --no-interactive
  if (!options.noInteractive) {
    return logsInteractive(options);
  }

  return logsList(options);
}

const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('../logger');

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

// Component color mapping
const componentColors = {
  'system-manager': colors.cyan,
  'queue': colors.blue,
  'watcher': colors.magenta,
  'event-bus': colors.yellow,
  'directory-initializer': colors.green,
  'prompt-builder': colors.blue,
  'message': colors.green,
  'spawn': colors.cyan,
  'kill': colors.red,
  'tmux-injector': colors.yellow,
  'atomic-state': colors.magenta,
  'cli': colors.white,
  'start': colors.cyan,
};

function getComponentColor(component) {
  return componentColors[component] || colors.white;
}

function getLevelColor(level) {
  switch (level) {
    case 'error':
      return colors.red;
    case 'warn':
      return colors.yellow;
    case 'info':
    default:
      return colors.white;
  }
}

function getLevelBadge(level) {
  const badges = {
    'error': '✗',
    'warn': '⚠',
    'info': ' '
  };
  return badges[level] || '·';
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function flattenObject(obj, prefix = '') {
  const flattened = {};

  function flatten(current, path) {
    if (Array.isArray(current)) {
      // For arrays, flatten each item with index
      current.forEach((item, index) => {
        const newPath = path ? `${path}[${index}]` : `[${index}]`;
        if (typeof item === 'object' && item !== null) {
          flatten(item, newPath);
        } else {
          flattened[newPath] = item;
        }
      });
    } else if (current !== null && typeof current === 'object') {
      // For objects, flatten each property
      Object.entries(current).forEach(([key, value]) => {
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

function formatMetadata(obj, indent = '', isError = false) {
  const entries = Object.entries(obj);
  if (entries.length === 0) return '';

  // Flatten nested objects and arrays
  const flattenedPairs = [];
  entries.forEach(([key, value]) => {
    if (typeof value === 'object' && value !== null) {
      const flattened = flattenObject(value, key);
      Object.entries(flattened).forEach(([flatKey, flatValue]) => {
        flattenedPairs.push([flatKey, flatValue]);
      });
    } else {
      flattenedPairs.push([key, value]);
    }
  });

  return flattenedPairs
    .map(([key, value]) => {
      let formattedValue = String(value);
      // For error logs, don't truncate the stack trace or error details
      if (!isError) {
        formattedValue = formattedValue.substring(0, 60);
      }
      return `${indent}${colors.dim}${key}:${colors.reset} ${formattedValue}`;
    })
    .join('\n');
}

function formatLogEntry(entry) {
  const timestamp = colors.dim + formatTimestamp(entry.timestamp) + colors.reset;
  const componentColor = getComponentColor(entry.component);
  const component = componentColor + entry.component.padEnd(20) + colors.reset;
  const levelColor = getLevelColor(entry.level);
  const badge = levelColor + getLevelBadge(entry.level) + colors.reset;
  const message = entry.message;

  // Extract metadata (all fields except timestamp, level, component, message)
  const { timestamp: _, level, component: __, message: ___, ...metadata } = entry;
  const isError = entry.level === 'error';
  const metadataStr = formatMetadata(metadata, '  ', isError);

  let output = `${badge} ${timestamp} ${component} ${colors.bright}${message}${colors.reset}`;
  if (metadataStr) {
    output += `\n${metadataStr}`;
  }

  return output;
}

function readJSONLFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      })
      .filter(entry => entry !== null);
  } catch (error) {
    console.error(`Error reading log file: ${error.message}`);
    return [];
  }
}

function mergeSortLogs(debugLogs, errorLogs) {
  return [...debugLogs, ...errorLogs].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
}

async function logsInteractive(options = {}) {
  const readline = require('readline');

  const lines = parseInt(options.lines || options.n || '50', 10);
  const debugLog = '.ai/tx/logs/debug.jsonl';
  const errorLog = '.ai/tx/logs/error.jsonl';

  let currentFilter = 'all'; // 'all', 'files', 'injections', 'events'
  let lastTimestamp = Date.now();
  let watchInterval = null;

  const filterMap = {
    all: { component: null, label: 'All Logs', key: 'A' },
    files: { component: 'watcher', label: 'File Operations', key: 'F' },
    injections: { component: 'tmux-injector', label: 'Injections', key: 'I' },
    events: { component: 'event-bus', label: 'Events', key: 'E' }
  };

  function getFilteredLogs(filter) {
    let debugLogs = readJSONLFile(debugLog);
    let errorLogs = readJSONLFile(errorLog);

    const componentFilter = filterMap[filter].component;
    if (componentFilter) {
      debugLogs = debugLogs.filter(log => log.component === componentFilter);
      errorLogs = errorLogs.filter(log => log.component === componentFilter);
    }

    return mergeSortLogs(debugLogs, errorLogs).slice(-lines);
  }

  function clearScreen() {
    console.clear();
  }

  function clearLogFiles() {
    try {
      if (fs.existsSync(debugLog)) {
        fs.writeFileSync(debugLog, '');
      }
      if (fs.existsSync(errorLog)) {
        fs.writeFileSync(errorLog, '');
      }
    } catch (error) {
      // Silently fail
    }
  }

  function displayHeader() {
    // Build filter options with gradient-style highlighting
    const filterOptions = [
      { key: 'f', label: 'files', filter: 'files', color: colors.cyan },
      { key: 'i', label: 'inject', filter: 'injections', color: colors.yellow },
      { key: 'e', label: 'events', filter: 'events', color: colors.magenta },
      { key: 'a', label: 'all', filter: 'all', color: colors.green }
    ];

    const filterDisplay = filterOptions.map(opt => {
      const isActive = currentFilter === opt.filter;
      if (isActive) {
        // Active: gradient bar with label
        return `${colors.bright}${opt.color}█▓▒░ ${opt.label}${colors.reset}`;
      } else {
        // Inactive: dim label
        return `${colors.dim}${opt.key} ${opt.label}${colors.reset}`;
      }
    }).join('  ');

    console.log(`${colors.dim}tx logs ${colors.reset}${filterDisplay}  ${colors.dim}c clear  q quit${colors.reset}\n`);
  }

  function displayLogs() {
    clearScreen();

    const logs = getFilteredLogs(currentFilter);
    if (logs.length === 0) {
      console.log(`${colors.dim}No logs found for this filter.${colors.reset}\n`);
    } else {
      logs.forEach(entry => {
        console.log(formatLogEntry(entry));
      });
    }

    console.log(); // blank line before footer
    displayHeader();
  }

  // Set up readline for keypress events
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }

    const keyName = (str || '').toLowerCase();

    switch (keyName) {
      case 'f':
        currentFilter = 'files';
        displayLogs();
        break;
      case 'i':
        currentFilter = 'injections';
        displayLogs();
        break;
      case 'e':
        currentFilter = 'events';
        displayLogs();
        break;
      case 'a':
        currentFilter = 'all';
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

  function cleanup() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    if (watchInterval) {
      clearInterval(watchInterval);
    }
    console.log(`\n${colors.dim}Stopped watching logs${colors.reset}\n`);
  }

  // Initial display
  displayLogs();

  // Watch for new logs
  watchInterval = setInterval(() => {
    const currentFilterInfo = filterMap[currentFilter];
    let debugLogs = readJSONLFile(debugLog);
    let errorLogs = readJSONLFile(errorLog);

    // Apply component filter
    const componentFilter = currentFilterInfo.component;
    if (componentFilter) {
      debugLogs = debugLogs.filter(log => log.component === componentFilter);
      errorLogs = errorLogs.filter(log => log.component === componentFilter);
    }

    // Get new logs
    let newLogs = [...debugLogs, ...errorLogs].filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return logTime > lastTimestamp;
    }).sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    if (newLogs.length > 0) {
      // Redisplay everything with new logs
      displayLogs();
      lastTimestamp = new Date(newLogs[newLogs.length - 1].timestamp).getTime();
    }
  }, 500);

  // Handle exit
  process.on('SIGINT', cleanup);
}

async function logs(options = {}) {
  // Interactive mode is now the default (unless --no-interactive is specified)
  const shouldUseInteractive = options.noInteractive !== true;

  if (shouldUseInteractive) {
    return logsInteractive(options);
  }

  try {
    const lines = parseInt(options.lines || options.n || '50', 10);
    const component = options.component || options.c || null;
    // Follow is now the default (unless --no-follow is specified)
    const follow = options.noFollow || options.follow === false ? false : true;
    const level = options.level || options.l || null;

    // Read log files
    const debugLog = '.ai/tx/logs/debug.jsonl';
    const errorLog = '.ai/tx/logs/error.jsonl';

    let debugLogs = readJSONLFile(debugLog);
    let errorLogs = readJSONLFile(errorLog);

    // Filter by level if specified
    if (level) {
      debugLogs = debugLogs.filter(log => log.level === level);
      if (level !== 'error') {
        errorLogs = [];
      } else {
        debugLogs = [];
      }
    }

    // Filter by component if specified
    if (component) {
      debugLogs = debugLogs.filter(log => log.component.includes(component));
      errorLogs = errorLogs.filter(log => log.component.includes(component));
    }

    // Merge and sort
    let allLogs = mergeSortLogs(debugLogs, errorLogs);

    // Get last N lines
    const displayLogs = allLogs.slice(-lines);

    // Display initial logs
    console.log(`\n${colors.bright}${colors.cyan}📋 TX Logs${colors.reset} ${colors.dim}(${displayLogs.length} entries)${colors.reset}\n`);

    displayLogs.forEach(entry => {
      console.log(formatLogEntry(entry));
    });

    // Watch mode
    if (follow) {
      console.log(`\n${colors.dim}Watching for new logs... (Press Ctrl+C to exit)${colors.reset}\n`);

      let lastTimestamp = displayLogs.length > 0
        ? new Date(displayLogs[displayLogs.length - 1].timestamp).getTime()
        : Date.now();

      const watchInterval = setInterval(() => {
        let freshDebugLogs = readJSONLFile(debugLog);
        let freshErrorLogs = readJSONLFile(errorLog);

        // Filter by component if specified
        if (component) {
          freshDebugLogs = freshDebugLogs.filter(log => log.component.includes(component));
          freshErrorLogs = freshErrorLogs.filter(log => log.component.includes(component));
        }

        // Filter by level if specified
        let newLogs = [...freshDebugLogs, ...freshErrorLogs];
        if (level) {
          newLogs = newLogs.filter(log => log.level === level);
        }

        // Get only new entries
        newLogs = newLogs.filter(log => {
          const logTime = new Date(log.timestamp).getTime();
          return logTime > lastTimestamp;
        }).sort((a, b) => {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });

        if (newLogs.length > 0) {
          newLogs.forEach(entry => {
            console.log(formatLogEntry(entry));
          });
          lastTimestamp = new Date(newLogs[newLogs.length - 1].timestamp).getTime();
        }
      }, 500);

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        clearInterval(watchInterval);
        console.log(`\n${colors.dim}Stopped watching logs${colors.reset}\n`);
        process.exit(0);
      });
    } else {
      console.log();
    }
  } catch (error) {
    console.error(`❌ Failed to read logs: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { logs };

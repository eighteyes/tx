const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');
const { execSync } = require('child_process');
const { MessageWriter } = require('../message-writer');

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

// Message type colors
const typeColors = {
  'task': colors.cyan,
  'ask': colors.yellow,
  'ask-response': colors.green,
  'task-complete': colors.magenta,
  'delta': colors.blue,
  'prompt': colors.white,
  'error': colors.red
};

function getTypeColor(type) {
  return typeColors[type] || colors.white;
}

/**
 * Parse event log filename to extract metadata
 */
function parseFilename(filename) {
  try {
    return MessageWriter.parseFilename(filename);
  } catch (error) {
    return null;
  }
}

/**
 * Read and parse a message file
 */
async function readMessage(filepath) {
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!match) {
      return null;
    }

    const frontmatter = parseFrontmatter(match[1]);
    const body = match[2].trim();
    const filename = path.basename(filepath);
    const parsed = parseFilename(filename);

    // If filename parsing failed, try to get info from frontmatter
    if (!parsed) {
      return {
        filepath,
        filename,
        timestamp: frontmatter.timestamp || new Date().toISOString(),
        from: frontmatter.from || '?',
        to: frontmatter.to || '?',
        type: frontmatter.type || 'unknown',
        msgId: frontmatter['msg-id'] || 'unknown',
        frontmatter,
        content: body,
        headline: frontmatter.headline || '',
        status: frontmatter.status || ''
      };
    }

    return {
      filepath,
      filename,
      ...parsed,
      // Prefer frontmatter for from/to since it has full mesh/agent paths
      from: frontmatter.from || parsed.from,
      to: frontmatter.to || parsed.to,
      frontmatter,
      content: body,
      headline: frontmatter.headline || '',
      status: frontmatter.status || ''
    };
  } catch (error) {
    return null;
  }
}

/**
 * Parse YAML frontmatter
 */
function parseFrontmatter(yaml) {
  const lines = yaml.split('\n');
  const data = {};

  lines.forEach(line => {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      data[match[1].trim()] = match[2].trim();
    }
  });

  return data;
}

/**
 * Format timestamp from ISO string
 */
function formatTime(isoString) {
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Display a single message
 */
function displayMessage(msg, options = {}) {
  // Guard against malformed messages
  if (!msg || !msg.timestamp) {
    return;
  }

  const time = formatTime(msg.timestamp);
  const typeColor = getTypeColor(msg.type || 'unknown');
  const type = (msg.type || 'unknown').padEnd(14);

  // Build routing: from → to
  const fromPadded = (msg.from || '?').padEnd(25);
  const toPadded = (msg.to || '?').padEnd(25);
  const route = `${fromPadded} ${colors.dim}→${colors.reset} ${toPadded}`;

  // Build line
  let line = `${colors.dim}${time}${colors.reset} ${typeColor}${type}${colors.reset} ${route}`;

  // Add headline if present
  if (msg.headline) {
    line += ` ${colors.bright}${msg.headline}${colors.reset}`;
  }

  // Add status badge if present
  if (msg.status) {
    const statusBadge = msg.status === 'start' ? '●' : msg.status === 'complete' ? '✓' : '○';
    line += ` ${colors.dim}${statusBadge}${colors.reset}`;
  }

  console.log(line);

  // Verbose mode: show content preview
  if (options.verbose && msg.content) {
    const preview = msg.content.substring(0, 100).replace(/\n/g, ' ');
    console.log(`  ${colors.dim}${preview}${preview.length < msg.content.length ? '...' : ''}${colors.reset}`);
  }
}

/**
 * Check if message matches filters
 */
function matchesFilter(msg, options) {
  // Filter by type
  if (options.type && msg.type !== options.type) {
    return false;
  }

  // Filter by agent (matches from or to)
  if (options.agent) {
    const agent = options.agent.toLowerCase();
    const fromMatch = msg.from && msg.from.toLowerCase().includes(agent);
    const toMatch = msg.to && msg.to.toLowerCase().includes(agent);
    if (!fromMatch && !toMatch) {
      return false;
    }
  }

  // Filter by mesh
  if (options.mesh) {
    const mesh = options.mesh.toLowerCase();
    const fromMatch = msg.from && msg.from.toLowerCase().includes(mesh);
    const toMatch = msg.to && msg.to.toLowerCase().includes(mesh);
    if (!fromMatch && !toMatch) {
      return false;
    }
  }

  // Filter errors
  if (options.errors && msg.type !== 'error') {
    return false;
  }

  // Time filters
  if (options.since) {
    const since = parseTimeFilter(options.since);
    if (new Date(msg.timestamp) < since) {
      return false;
    }
  }

  if (options.before) {
    const before = parseTimeFilter(options.before);
    if (new Date(msg.timestamp) > before) {
      return false;
    }
  }

  return true;
}

/**
 * Parse time filter (e.g., "1h", "30m", "2025-11-03")
 */
function parseTimeFilter(str) {
  // Relative time: 1h, 30m, 2d
  const relativeMatch = str.match(/^(\d+)([hmd])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2];
    const now = Date.now();

    switch (unit) {
      case 'h': return new Date(now - value * 3600000);
      case 'm': return new Date(now - value * 60000);
      case 'd': return new Date(now - value * 86400000);
    }
  }

  // Absolute time
  return new Date(str);
}

/**
 * Get all messages from event log
 */
async function getAllMessages(logDir) {
  const files = await fs.readdir(logDir);
  const messages = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const filepath = path.join(logDir, file);
    const msg = await readMessage(filepath);

    if (msg) {
      messages.push(msg);
    }
  }

  // Sort by timestamp
  return messages.sort((a, b) => {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}

/**
 * Interactive mode with navigation and follow
 */
async function msgInteractive(logDir, options = {}) {
  const readline = require('readline');

  let messages = await getAllMessages(logDir);
  messages = messages.filter(msg => matchesFilter(msg, options));
  const limit = parseInt(options.limit || '50');
  messages = messages.slice(-limit);

  let selectedIndex = messages.length - 1; // Start at latest
  let viewingMessage = false;
  let detailScrollOffset = 0;
  let followMode = options.follow || false;
  let watcher = null;

  function clearScreen() {
    console.clear();
  }

  function displayList() {
    clearScreen();

    const header = `${colors.bright}${colors.cyan}📨 Event Log${colors.reset} ${colors.dim}(${messages.length} messages)${colors.reset}`;
    const controls = `${colors.dim}↑↓/jk navigate  ${colors.reset}${colors.bright}Enter${colors.reset}${colors.dim}/→/l view  ${colors.bright}a${colors.reset}${colors.dim} attach  ${colors.bright}f${colors.reset}${colors.dim} follow${followMode ? ' ●' : ' ○'}  ${colors.bright}q${colors.reset}${colors.dim} quit${colors.reset}`;

    console.log(`\n${header}  ${controls}\n`);

    // Show messages with selection
    const visibleStart = Math.max(0, selectedIndex - 15);
    const visibleEnd = Math.min(messages.length, selectedIndex + 10);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const msg = messages[i];
      const isSelected = i === selectedIndex;

      if (isSelected) {
        // Highlight selected message
        process.stdout.write(`${colors.bright}${colors.cyan}▶ ${colors.reset}`);
      } else {
        process.stdout.write('  ');
      }

      const time = formatTime(msg.timestamp);
      const typeColor = getTypeColor(msg.type || 'unknown');
      const type = (msg.type || 'unknown').padEnd(12);
      const from = (msg.from || '?').padEnd(20);
      const to = (msg.to || '?').padEnd(20);
      const headline = msg.headline ? ` ${msg.headline.substring(0, 40)}` : '';

      console.log(`${colors.dim}${time}${colors.reset} ${typeColor}${type}${colors.reset} ${from} ${colors.dim}→${colors.reset} ${to}${headline}`);
    }

    console.log();
  }

  function displayMessageDetail() {
    clearScreen();

    const msg = messages[selectedIndex];
    console.log(`\n${colors.bright}${colors.cyan}📨 Message Detail${colors.reset} ${colors.dim}(${selectedIndex + 1}/${messages.length})${colors.reset}`);
    console.log(`${colors.dim}↑↓/jk scroll  ${colors.reset}${colors.bright}←${colors.reset}${colors.dim}/h/Esc/q back  ${colors.bright}a${colors.reset}${colors.dim} attach to ${colors.cyan}${msg.to}${colors.reset}\n`);

    // Header (fixed, not scrollable)
    const header = [];
    header.push(`${colors.dim}Time:${colors.reset}     ${formatTime(msg.timestamp)}`);
    header.push(`${colors.dim}Type:${colors.reset}     ${msg.type}`);
    header.push(`${colors.dim}From:${colors.reset}     ${msg.from}`);
    header.push(`${colors.dim}To:${colors.reset}       ${msg.to}`);
    if (msg.headline) {
      header.push(`${colors.dim}Headline:${colors.reset} ${msg.headline}`);
    }
    if (msg.msgId) {
      header.push(`${colors.dim}Msg ID:${colors.reset}   ${msg.msgId}`);
    }
    header.push('');
    header.push(colors.dim + '─'.repeat(80) + colors.reset);
    header.push('');

    header.forEach(line => console.log(line));

    // Content (scrollable)
    const content = msg.content || colors.dim + 'No content' + colors.reset;
    const contentLines = content.split('\n');

    // Calculate visible window (half page scrolling)
    const viewportHeight = process.stdout.rows - header.length - 5; // Leave room for header and footer
    const halfPage = Math.floor(viewportHeight / 2);
    const maxScroll = Math.max(0, contentLines.length - viewportHeight);

    // Clamp scroll offset
    detailScrollOffset = Math.max(0, Math.min(detailScrollOffset, maxScroll));

    // Show visible portion
    const visibleLines = contentLines.slice(detailScrollOffset, detailScrollOffset + viewportHeight);
    visibleLines.forEach(line => console.log(line));

    // Scroll indicator
    if (contentLines.length > viewportHeight) {
      const scrollPercent = maxScroll > 0 ? Math.round((detailScrollOffset / maxScroll) * 100) : 0;
      console.log();
      console.log(`${colors.dim}[${scrollPercent}%] Line ${detailScrollOffset + 1}-${Math.min(detailScrollOffset + viewportHeight, contentLines.length)} of ${contentLines.length}${colors.reset}`);
    }

    console.log();
  }

  function display() {
    if (viewingMessage) {
      displayMessageDetail();
    } else {
      displayList();
    }
  }

  /**
   * Attach to the target agent's tmux session
   */
  function attachToAgent() {
    const msg = messages[selectedIndex];
    const targetAgent = msg.to;

    if (!targetAgent || targetAgent === '?') {
      // Flash error briefly then return to display
      cleanup();
      console.clear();
      console.log(`\n${colors.red}✗${colors.reset} No valid target agent in this message\n`);
      setTimeout(() => {
        // Restart the viewer
        process.exit(0);
      }, 2000);
      return;
    }

    // Determine session name from target agent
    let sessionName = null;

    // Handle core special case
    if (targetAgent === 'core' || targetAgent === 'core/core') {
      sessionName = 'core';
    } else if (targetAgent.includes('/')) {
      // Format: mesh/agent or mesh-instance/agent
      const [mesh, agent] = targetAgent.split('/');

      // Check if mesh equals agent (persistent mesh)
      if (mesh === agent) {
        sessionName = mesh;
      } else {
        // Standard format: mesh-agent
        sessionName = `${mesh}-${agent}`;
      }
    } else {
      // Just agent name - try as-is
      sessionName = targetAgent;
    }

    // Check if session exists
    try {
      execSync(`tmux has-session -t ${sessionName} 2>/dev/null`, { stdio: 'ignore' });
    } catch (error) {
      // Session not found - show error and available sessions
      cleanup();
      console.clear();
      console.log(`\n${colors.yellow}⚠${colors.reset} Session not found: ${colors.cyan}${sessionName}${colors.reset}\n`);
      console.log(`${colors.dim}Available sessions:${colors.reset}`);
      try {
        const sessions = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8' })
          .trim()
          .split('\n')
          .filter(s => s.length > 0);
        sessions.forEach(s => console.log(`  ${colors.cyan}${s}${colors.reset}`));
      } catch {
        console.log(`  ${colors.dim}No active sessions${colors.reset}`);
      }
      console.log(`\n${colors.dim}Press any key to exit...${colors.reset}`);

      process.stdin.once('data', () => {
        process.exit(0);
      });
      return;
    }

    // Clean up viewer state
    cleanup();

    // Clear screen and show what we're doing
    console.clear();
    console.log(`${colors.green}✓${colors.reset} Attaching to ${colors.cyan}${sessionName}${colors.reset}...\n`);

    // Small delay to let cleanup complete
    setTimeout(() => {
      try {
        // Use spawn instead of execSync for better terminal handling
        const { spawn } = require('child_process');
        const child = spawn('tmux', ['attach', '-t', sessionName], {
          stdio: 'inherit'
        });

        child.on('exit', (code) => {
          // When user detaches from session, return to msg viewer
          console.clear();
          console.log(`${colors.dim}Returning to message viewer...${colors.reset}\n`);
          setTimeout(() => {
            msgInteractive(logDir, options);
          }, 100);
        });
      } catch (error) {
        console.log(`\n${colors.red}✗${colors.reset} Failed to attach: ${error.message}\n`);
        process.exit(1);
      }
    }, 100);
  }

  // Initial display
  if (messages.length === 0) {
    console.log(`${colors.dim}No messages found matching filters.${colors.reset}\n`);
    return;
  }

  display();

  // Setup follow mode watcher
  function setupWatcher() {
    if (watcher) return; // Already watching

    // Watch the directory itself, not a glob pattern (better for macOS)
    watcher = chokidar.watch(logDir, {
      ignoreInitial: true,
      persistent: true,
      usePolling: true,  // Use polling for more reliable detection
      interval: 500,     // Poll every 500ms
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    watcher.on('add', async (filepath) => {
      try {
        // Only process .md files
        if (!filepath.endsWith('.md')) return;

        const filename = path.basename(filepath);
        const msg = await readMessage(filepath);
        if (msg && matchesFilter(msg, options)) {
          // Add message to array
          messages.push(msg);

          // Sort messages by timestamp to maintain chronological order
          messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

          // Update selection to latest message
          selectedIndex = messages.length - 1;

          // Refresh display if in list view
          if (!viewingMessage) {
            display();
          }
        }
      } catch (error) {
        // Silently ignore parse errors
      }
    });

    watcher.on('error', (error) => {
      // Silently ignore watcher errors
    });

    watcher.on('ready', () => {
      // Watcher is ready
    });
  }

  if (followMode) {
    setupWatcher();
  }

  // Setup keyboard handling
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }

    if (viewingMessage) {
      // In detail view
      const msg = messages[selectedIndex];
      const content = msg.content || '';
      const contentLines = content.split('\n');
      const viewportHeight = process.stdout.rows - 15; // Approximate viewport
      const halfPage = Math.floor(viewportHeight / 2);
      const maxScroll = Math.max(0, contentLines.length - viewportHeight);

      switch (key.name) {
        case 'up':
        case 'k': // vim up
          // Scroll up by half page
          detailScrollOffset = Math.max(0, detailScrollOffset - halfPage);
          display();
          break;
        case 'down':
        case 'j': // vim down
          // Scroll down by half page
          detailScrollOffset = Math.min(maxScroll, detailScrollOffset + halfPage);
          display();
          break;
        case 'left':
        case 'h': // vim left
        case 'escape':
        case 'q':
          viewingMessage = false;
          detailScrollOffset = 0; // Reset scroll
          display();
          break;
        case 'a':
          // Attach to target agent
          attachToAgent();
          break;
      }
    } else {
      // In list view
      switch (key.name) {
        case 'up':
          if (selectedIndex > 0) {
            selectedIndex--;
            display();
          }
          break;
        case 'down':
          if (selectedIndex < messages.length - 1) {
            selectedIndex++;
            display();
          }
          break;
        case 'k': // vim up
          if (selectedIndex > 0) {
            selectedIndex--;
            display();
          }
          break;
        case 'j': // vim down
          if (selectedIndex < messages.length - 1) {
            selectedIndex++;
            display();
          }
          break;
        case 'return':
        case 'right':
        case 'l': // vim right
          viewingMessage = true;
          detailScrollOffset = 0; // Reset scroll when entering detail
          display();
          break;
        case 'f':
          followMode = !followMode;
          if (followMode) {
            setupWatcher();
          } else if (watcher) {
            watcher.close();
            watcher = null;
          }
          display();
          break;
        case 'a':
          // Attach to target agent
          attachToAgent();
          break;
        case 'q':
          cleanup();
          process.exit(0);
          break;
      }
    }
  });

  function cleanup() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    if (watcher) {
      watcher.close();
    }
    console.log(`\n${colors.dim}Exited message viewer${colors.reset}\n`);
  }

  process.on('SIGINT', cleanup);
}

/**
 * Main msg command
 */
async function msg(options = {}) {
  const logDir = '.ai/tx/msgs';

  // Check if log directory exists
  if (!await fs.pathExists(logDir)) {
    console.log(`${colors.yellow}⚠${colors.reset} Event log directory not found: ${logDir}`);
    console.log(`${colors.dim}No messages yet.${colors.reset}\n`);
    return;
  }

  // Interactive mode (default unless --no-interactive or --json)
  if (options.interactive !== false && !options.json) {
    return msgInteractive(logDir, options);
  }

  // JSON output mode
  if (options.json) {
    return msgJson(logDir, options);
  }

  // Simple list mode (--no-interactive)
  let messages = await getAllMessages(logDir);

  // Apply filters
  messages = messages.filter(msg => matchesFilter(msg, options));

  // Apply limit
  const limit = parseInt(options.limit || '50');
  messages = messages.slice(-limit);

  // Display
  if (messages.length === 0) {
    console.log(`${colors.dim}No messages found matching filters.${colors.reset}\n`);
    return;
  }

  console.log(`\n${colors.bright}${colors.cyan}📨 Event Log${colors.reset} ${colors.dim}(${messages.length} messages)${colors.reset}\n`);

  messages.forEach(msg => displayMessage(msg, options));

  console.log();
}

/**
 * Follow mode (tail -f style)
 */
async function msgFollow(logDir, options) {
  console.log(`${colors.bright}${colors.cyan}📨 Event Log${colors.reset} ${colors.dim}(follow mode)${colors.reset}\n`);

  // Display existing messages first
  let messages = await getAllMessages(logDir);
  messages = messages.filter(msg => matchesFilter(msg, options));
  const limit = parseInt(options.limit || '20');
  messages = messages.slice(-limit);

  messages.forEach(msg => displayMessage(msg, options));

  console.log(`\n${colors.dim}Watching for new messages... (Press Ctrl+C to exit)${colors.reset}\n`);

  // Track last processed timestamp
  let lastTimestamp = messages.length > 0
    ? new Date(messages[messages.length - 1].timestamp).getTime()
    : 0;

  // Watch for new files
  const watcher = chokidar.watch(`${logDir}/*.md`, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    }
  });

  watcher.on('add', async (filepath) => {
    const msg = await readMessage(filepath);

    if (msg && matchesFilter(msg, options)) {
      const msgTime = new Date(msg.timestamp).getTime();
      if (msgTime > lastTimestamp) {
        displayMessage(msg, options);
        lastTimestamp = msgTime;
      }
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    watcher.close();
    console.log(`\n${colors.dim}Stopped watching messages${colors.reset}\n`);
    process.exit(0);
  });
}

/**
 * JSON output mode
 */
async function msgJson(logDir, options) {
  let messages = await getAllMessages(logDir);

  // Apply filters
  messages = messages.filter(msg => matchesFilter(msg, options));

  // Apply limit
  const limit = parseInt(options.limit || '50');
  messages = messages.slice(-limit);

  // Output as JSON
  console.log(JSON.stringify(messages, null, 2));
}

module.exports = { msg };

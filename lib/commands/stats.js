const fs = require('fs-extra');
const path = require('path');
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
    const filename = path.basename(filepath);
    const parsed = MessageWriter.parseFilename(filename);

    return {
      ...parsed,
      frontmatter,
      size: content.length
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

  return messages;
}

/**
 * Group messages by key
 */
function groupBy(messages, keyFn) {
  const groups = {};

  messages.forEach(msg => {
    const key = typeof keyFn === 'function' ? keyFn(msg) : msg[keyFn];
    if (!groups[key]) {
      groups[key] = 0;
    }
    groups[key]++;
  });

  return groups;
}

/**
 * Get recent activity stats
 */
function getRecentActivity(messages) {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const oneDayAgo = now - 86400000;
  const oneWeekAgo = now - 604800000;

  return {
    last_hour: messages.filter(m => new Date(m.timestamp) > oneHourAgo).length,
    last_day: messages.filter(m => new Date(m.timestamp) > oneDayAgo).length,
    last_week: messages.filter(m => new Date(m.timestamp) > oneWeekAgo).length
  };
}

/**
 * Get top agents by message count
 */
function getTopAgents(messages, limit = 10) {
  const senders = {};
  const receivers = {};

  messages.forEach(msg => {
    if (msg.from) {
      senders[msg.from] = (senders[msg.from] || 0) + 1;
    }
    if (msg.to) {
      receivers[msg.to] = (receivers[msg.to] || 0) + 1;
    }
  });

  // Combine and sort
  const combined = {};
  [...Object.keys(senders), ...Object.keys(receivers)].forEach(agent => {
    combined[agent] = (senders[agent] || 0) + (receivers[agent] || 0);
  });

  return Object.entries(combined)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([agent, count]) => ({
      agent,
      sent: senders[agent] || 0,
      received: receivers[agent] || 0,
      total: count
    }));
}

/**
 * Display stats as table
 */
function displayStats(stats, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`\n${colors.bright}${colors.cyan}📊 Event Log Statistics${colors.reset}\n`);

  // Overview
  console.log(`${colors.bright}Overview${colors.reset}`);
  console.log(`${colors.dim}Total messages:${colors.reset}   ${colors.bright}${stats.total_messages}${colors.reset}`);
  console.log(`${colors.dim}Unique agents:${colors.reset}    ${colors.bright}${Object.keys(stats.agents).length}${colors.reset}`);
  console.log(`${colors.dim}Total size:${colors.reset}       ${colors.bright}${formatBytes(stats.total_size)}${colors.reset}`);
  console.log();

  // Recent activity
  console.log(`${colors.bright}Recent Activity${colors.reset}`);
  console.log(`${colors.dim}Last hour:${colors.reset}        ${colors.bright}${stats.recent_activity.last_hour}${colors.reset} messages`);
  console.log(`${colors.dim}Last day:${colors.reset}         ${colors.bright}${stats.recent_activity.last_day}${colors.reset} messages`);
  console.log(`${colors.dim}Last week:${colors.reset}        ${colors.bright}${stats.recent_activity.last_week}${colors.reset} messages`);
  console.log();

  // By message type
  console.log(`${colors.bright}By Message Type${colors.reset}`);
  const sortedTypes = Object.entries(stats.by_type).sort((a, b) => b[1] - a[1]);
  sortedTypes.forEach(([type, count]) => {
    const bar = '█'.repeat(Math.ceil((count / stats.total_messages) * 20));
    const percentage = ((count / stats.total_messages) * 100).toFixed(1);
    console.log(`${colors.dim}${type.padEnd(20)}${colors.reset} ${colors.cyan}${bar}${colors.reset} ${colors.bright}${count}${colors.reset} ${colors.dim}(${percentage}%)${colors.reset}`);
  });
  console.log();

  // Top agents
  if (stats.top_agents && stats.top_agents.length > 0) {
    console.log(`${colors.bright}Top Agents${colors.reset} ${colors.dim}(by total messages)${colors.reset}`);
    stats.top_agents.forEach((agent, idx) => {
      const rank = `${idx + 1}.`.padEnd(3);
      const name = agent.agent.padEnd(30);
      const sent = `↑${agent.sent}`.padStart(6);
      const received = `↓${agent.received}`.padStart(6);
      const total = colors.bright + agent.total + colors.reset;
      console.log(`${colors.dim}${rank}${colors.reset} ${colors.cyan}${name}${colors.reset} ${colors.dim}${sent} ${received}${colors.reset} ${total}`);
    });
    console.log();
  }

  // Errors
  if (stats.errors > 0) {
    console.log(`${colors.bright}${colors.red}⚠ Errors${colors.reset}`);
    console.log(`${colors.dim}Error messages:${colors.reset}   ${colors.red}${colors.bright}${stats.errors}${colors.reset}`);
    console.log();
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Main stats command
 */
async function stats(options = {}) {
  const logDir = '.ai/tx/msgs';

  // Check if log directory exists
  if (!await fs.pathExists(logDir)) {
    console.log(`${colors.yellow}⚠${colors.reset} Event log directory not found: ${logDir}`);
    console.log(`${colors.dim}No messages yet.${colors.reset}\n`);
    return;
  }

  // Load all messages
  let messages = await getAllMessages(logDir);

  // Filter by mesh if specified
  if (options.mesh) {
    const mesh = options.mesh.toLowerCase();
    messages = messages.filter(msg => {
      const fromMatch = msg.from && msg.from.toLowerCase().includes(mesh);
      const toMatch = msg.to && msg.to.toLowerCase().includes(mesh);
      return fromMatch || toMatch;
    });
  }

  // Filter by agent if specified
  if (options.agent) {
    const agent = options.agent.toLowerCase();
    messages = messages.filter(msg => {
      const fromMatch = msg.from && msg.from.toLowerCase().includes(agent);
      const toMatch = msg.to && msg.to.toLowerCase().includes(agent);
      return fromMatch || toMatch;
    });
  }

  // Filter by time
  if (options.since) {
    const since = new Date(options.since);
    messages = messages.filter(m => new Date(m.timestamp) >= since);
  }

  if (messages.length === 0) {
    console.log(`${colors.dim}No messages found matching filters.${colors.reset}\n`);
    return;
  }

  // Calculate stats
  const statsData = {
    total_messages: messages.length,
    by_type: groupBy(messages, 'type'),
    agents: groupBy(messages, msg => msg.from || 'unknown'),
    recent_activity: getRecentActivity(messages),
    top_agents: getTopAgents(messages, 10),
    errors: messages.filter(m => m.type === 'error').length,
    total_size: messages.reduce((sum, m) => sum + (m.size || 0), 0)
  };

  // Display
  displayStats(statsData, options);
}

module.exports = { stats };

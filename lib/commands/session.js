const fs = require('fs-extra');
const path = require('path');

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
 * Parse session filename
 * Format: MMDDHHMMSS-mesh-agent-seq.md
 */
function parseSessionFilename(filename) {
  const withoutExt = filename.replace('.md', '');
  const parts = withoutExt.split('-');

  if (parts.length < 4) {
    return null;
  }

  const timestamp = parts[0];
  const year = new Date().getFullYear();

  const mm = timestamp.substring(0, 2);
  const dd = timestamp.substring(2, 4);
  const hh = timestamp.substring(4, 6);
  const min = timestamp.substring(6, 8);
  const ss = timestamp.substring(8, 10);

  // Everything between timestamp and last 2 parts is the mesh
  const mesh = parts.slice(1, parts.length - 2).join('-');
  const agent = parts[parts.length - 2];
  const sequence = parts[parts.length - 1];

  return {
    date: `${year}-${mm}-${dd}`,
    time: `${hh}:${min}:${ss}`,
    timestamp: new Date(`${year}-${mm}-${dd}T${hh}:${min}:${ss}`),
    mesh,
    agent,
    sequence: parseInt(sequence)
  };
}

/**
 * Read session file
 */
async function readSession(filepath) {
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!match) {
      return null;
    }

    const frontmatter = parseFrontmatter(match[1]);
    const body = match[2];

    return {
      filepath,
      frontmatter,
      content: body
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
 * List all sessions
 */
async function listSessions(sessionDir, options = {}) {
  if (!await fs.pathExists(sessionDir)) {
    console.log(`${colors.yellow}⚠${colors.reset} Session directory not found: ${sessionDir}`);
    console.log(`${colors.dim}No sessions captured yet.${colors.reset}\n`);
    return [];
  }

  const files = await fs.readdir(sessionDir);
  const sessions = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const parsed = parseSessionFilename(file);
    if (parsed) {
      sessions.push({
        filename: file,
        filepath: path.join(sessionDir, file),
        ...parsed
      });
    }
  }

  // Sort by timestamp descending (newest first)
  sessions.sort((a, b) => b.timestamp - a.timestamp);

  // Filter by options
  let filtered = sessions;

  if (options.mesh) {
    filtered = filtered.filter(s => s.mesh.includes(options.mesh));
  }

  if (options.agent) {
    filtered = filtered.filter(s => s.agent === options.agent);
  }

  if (options.today) {
    const today = new Date().toISOString().split('T')[0];
    filtered = filtered.filter(s => s.date === today);
  }

  if (options.since) {
    const since = new Date(options.since);
    filtered = filtered.filter(s => s.timestamp >= since);
  }

  return filtered;
}

/**
 * Display session list
 */
function displaySessionList(sessions) {
  if (sessions.length === 0) {
    console.log(`${colors.dim}No sessions found matching filters.${colors.reset}\n`);
    return;
  }

  console.log(`\n${colors.bright}${colors.cyan}🖥  Sessions${colors.reset} ${colors.dim}(${sessions.length} captured)${colors.reset}\n`);

  sessions.forEach(session => {
    const meshAgent = `${session.mesh}/${session.agent}`.padEnd(40);
    const dateTime = `${session.date} ${session.time}`.padEnd(20);
    const seq = `#${session.sequence}`;

    console.log(`${colors.dim}${dateTime}${colors.reset} ${colors.cyan}${meshAgent}${colors.reset} ${colors.dim}${seq}${colors.reset}`);
  });

  console.log();
}

/**
 * Display session content
 */
async function displaySession(session) {
  const sessionData = await readSession(session.filepath);

  if (!sessionData) {
    console.log(`${colors.red}✗${colors.reset} Failed to read session: ${session.filepath}\n`);
    return;
  }

  const { frontmatter, content } = sessionData;

  console.log(`\n${colors.bright}${colors.cyan}🖥  Session Output${colors.reset}\n`);
  console.log(`${colors.dim}Mesh:${colors.reset}     ${frontmatter.mesh || session.mesh}`);
  console.log(`${colors.dim}Agent:${colors.reset}    ${frontmatter.agent || session.agent}`);
  console.log(`${colors.dim}Started:${colors.reset}  ${frontmatter.session_start || 'unknown'}`);
  console.log(`${colors.dim}Ended:${colors.reset}    ${frontmatter.session_end || 'unknown'}`);
  console.log(`${colors.dim}Sequence:${colors.reset} #${session.sequence}`);
  console.log();
  console.log(colors.dim + '─'.repeat(80) + colors.reset);
  console.log();

  // Display content (remove markdown code fence if present)
  let displayContent = content;
  if (displayContent.startsWith('# Session Output')) {
    displayContent = displayContent.split('\n').slice(1).join('\n').trim();
  }
  if (displayContent.startsWith('```')) {
    const lines = displayContent.split('\n');
    displayContent = lines.slice(1, -1).join('\n');
  }

  console.log(displayContent);
  console.log();
}

/**
 * Find sessions matching criteria
 */
async function findSessions(sessionDir, mesh, agent, options = {}) {
  const allSessions = await listSessions(sessionDir, { mesh, agent, ...options });

  if (allSessions.length === 0) {
    return [];
  }

  // If specific agent requested, filter exact match
  if (agent) {
    return allSessions.filter(s => s.agent === agent);
  }

  return allSessions;
}

/**
 * Main session command
 */
async function session(args = [], options = {}) {
  const sessionDir = '.ai/tx/session';

  // Subcommand: list
  if (args[0] === 'list') {
    const sessions = await listSessions(sessionDir, options);
    displaySessionList(sessions);
    return;
  }

  // No args: show recent sessions
  if (args.length === 0) {
    const sessions = await listSessions(sessionDir, { ...options, limit: 10 });
    displaySessionList(sessions.slice(0, 10));
    return;
  }

  // Args: mesh [agent]
  const mesh = args[0];
  const agent = args[1] || null;

  const sessions = await findSessions(sessionDir, mesh, agent, options);

  if (sessions.length === 0) {
    console.log(`${colors.yellow}⚠${colors.reset} No sessions found for ${mesh}${agent ? '/' + agent : ''}\n`);
    return;
  }

  // Get latest or all
  if (options.latest !== false) {
    // Show latest session content
    await displaySession(sessions[0]);
  } else {
    // Show list
    displaySessionList(sessions);
  }
}

module.exports = { session };

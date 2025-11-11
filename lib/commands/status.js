const { TmuxInjector } = require('../tmux-injector');
const { SystemManager } = require('../system-manager');
const { StateManager } = require('../state-manager');
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
  white: '\x1b[37m',
  gray: '\x1b[90m',
  redBright: '\x1b[91m'
};

// Color helper functions
const chalk = {
  red: (text) => `${colors.red}${text}${colors.reset}`,
  yellow: (text) => `${colors.yellow}${text}${colors.reset}`,
  blue: (text) => `${colors.blue}${text}${colors.reset}`,
  cyan: (text) => `${colors.cyan}${text}${colors.reset}`,
  green: (text) => `${colors.green}${text}${colors.reset}`,
  magenta: (text) => `${colors.magenta}${text}${colors.reset}`,
  white: (text) => `${colors.white}${text}${colors.reset}`,
  gray: (text) => `${colors.gray}${text}${colors.reset}`,
  redBright: (text) => `${colors.redBright}${text}${colors.reset}`,
  dim: (text) => `${colors.dim}${text}${colors.reset}`,
  bold: {
    cyan: (text) => `${colors.bright}${colors.cyan}${text}${colors.reset}`,
    white: (text) => `${colors.bright}${colors.white}${text}${colors.reset}`,
    red: (text) => `${colors.bright}${colors.red}${text}${colors.reset}`
  }
};

/**
 * Get state icon for agent state
 */
function getStateIcon(state) {
  const icons = {
    spawned: '🥚',
    initializing: '🔄',
    ready: '✅',
    working: '⚡',
    blocked: '⏸️',
    distracted: '🐿️',
    completing: '📝',
    error: '❌',
    suspended: '💤',
    killed: '💀'
  };
  return icons[state] || '❓';
}

/**
 * Get color for state
 */
function getStateColor(state) {
  const colorMap = {
    spawned: chalk.gray,
    initializing: chalk.blue,
    ready: chalk.green,
    working: chalk.cyan,
    blocked: chalk.yellow,
    distracted: chalk.redBright,
    completing: chalk.magenta,
    error: chalk.red,
    suspended: chalk.gray,
    killed: chalk.dim
  };
  return colorMap[state] || chalk.white;
}

/**
 * Format duration from milliseconds
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Simplified status display
 * Shows meshes with their agents, current tasks, and idle detection
 */
async function status(options = {}) {
  // Watch mode - refresh periodically
  if (options.watch) {
    const interval = options.interval || 2000; // Default 2 second refresh
    const refresh = async () => {
      console.clear();
      console.log(chalk.bold.cyan('TX Status Monitor'), chalk.gray(`(refreshing every ${interval/1000}s)`));
      console.log(chalk.gray('Press Ctrl+C to exit\n'));
      await displayStatus(options);
    };

    // Initial display
    await refresh();

    // Set up refresh interval
    setInterval(refresh, interval);

    // Keep process alive
    process.stdin.resume();
    return;
  }

  if (options.prompt) {
    const promptStatus = await generateStatusPrompt();
    console.log(promptStatus);
    return;
  }

  await displayStatus(options);
}

/**
 * Get elapsed time string
 */
function getElapsedTime(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffHr > 0) {
    return `${diffHr}h ${diffMin % 60}m`;
  } else if (diffMin > 0) {
    return `${diffMin}m`;
  } else {
    return `${diffSec}s`;
  }
}

/**
 * Get list of active tmux sessions
 */
function getActiveSessions() {
  try {
    const { execSync } = require('child_process');
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (!output) {
      return new Set();
    }

    return new Set(output.split('\n'));
  } catch (error) {
    // No tmux server running
    return new Set();
  }
}

/**
 * Display the actual status
 */
async function displayStatus(options = {}) {
  try {
    console.log('📊 TX Status\n');

    // Get active tmux sessions
    const activeSessions = getActiveSessions();

    if (activeSessions.size === 0) {
      console.log('No tmux sessions running\n');
      return;
    }

    // Load mesh directory to map sessions to mesh/agent
    const meshDir = '.ai/tx/mesh';
    const meshLookup = {};

    if (fs.existsSync(meshDir)) {
      const meshDirs = fs.readdirSync(meshDir);
      for (const meshName of meshDirs) {
        const agentsDir = path.join(meshDir, meshName, 'agents');
        if (fs.existsSync(agentsDir)) {
          const agents = fs.readdirSync(agentsDir).filter(f => {
            return fs.statSync(path.join(agentsDir, f)).isDirectory();
          });
          for (const agent of agents) {
            // Store potential session names for this mesh/agent
            const sessionNames = [
              meshName, // For mesh === agent (brain/brain -> brain)
              `${meshName}-${agent}` // Standard pattern
            ];
            sessionNames.forEach(sn => {
              meshLookup[sn] = { mesh: meshName, agent };
            });
          }
        }
      }
    }

    // Group sessions by mesh
    const meshes = {};

    for (const session of activeSessions) {
      // Skip non-TX sessions
      if (session === 'tx-dashboard') continue;

      // Look up in mesh directory
      const lookup = meshLookup[session];

      if (lookup) {
        const { mesh, agent } = lookup;

        if (!meshes[mesh]) {
          meshes[mesh] = [];
        }

        meshes[mesh].push({
          agentId: `${mesh}/${agent}`,
          sessionName: session,
          state: null
        });
      } else {
        // Unknown session - show it anyway
        console.log(`   ⚠️  Unknown session: ${session}`);
      }
    }

    // Load current tasks from StateManager
    const allStates = StateManager.getAllStates();
    const tasks = {};
    for (const [agentId, state] of Object.entries(allStates)) {
      if (state.currentTask) {
        tasks[agentId] = { task: state.currentTask };
      }
    }

    let totalAgents = 0;
    let agentsWithTasks = 0;

    // Display each mesh
    for (const [mesh, agents] of Object.entries(meshes)) {
      console.log(`📦 ${mesh}`);

      for (const { agentId, sessionName } of agents) {
        const [, agentName] = agentId.split('/');
        totalAgents++;

        const taskData = tasks[agentId];

        if (taskData) {
          agentsWithTasks++;
          const elapsed = getElapsedTime(taskData.timestamp);
          console.log(`   🟢 ${agentName}: ${taskData.task}`);
          console.log(`      └─ ${elapsed} elapsed (tmux: ${sessionName})`);
        } else {
          console.log(`   🟢 ${agentName} (tmux: ${sessionName})`);
        }
      }

      console.log();
    }

    // Summary
    const summary = [];
    summary.push(`${Object.keys(meshes).length} mesh${Object.keys(meshes).length !== 1 ? 'es' : ''}`);
    summary.push(`${totalAgents} agent${totalAgents !== 1 ? 's' : ''}`);
    if (agentsWithTasks > 0) {
      summary.push(`${agentsWithTasks} working`);
    }

    console.log(`Running: ${summary.join(', ')}`);
    console.log(`Attach: tmux attach -t <session-name>`);

  } catch (error) {
    console.error('❌ Failed to get status:', error.message);
    process.exit(1);
  }
}

/**
 * Get recent messages from event log
 */
async function getRecentMessages(msgsDir, timeWindowMs) {
  if (!fs.existsSync(msgsDir)) {
    return [];
  }

  const now = Date.now();
  const files = fs.readdirSync(msgsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filepath = path.join(msgsDir, f);
      const stats = fs.statSync(filepath);
      return {
        filename: f,
        filepath,
        mtime: stats.mtime.getTime()
      };
    })
    .filter(f => (now - f.mtime) < timeWindowMs)
    .sort((a, b) => b.mtime - a.mtime);

  // Parse messages
  const messages = [];
  for (const file of files) {
    try {
      const parts = file.filename.split('-');
      if (parts.length >= 3) {
        const [timestamp, type, routing] = parts;
        const [from, to] = routing.split('>');
        const toAgent = to?.split('-')[0]; // Remove msg-id

        messages.push({
          filename: file.filename,
          timestamp: file.mtime,
          type,
          from,
          to: toAgent,
          routing
        });
      }
    } catch (err) {
      // Skip malformed filenames
    }
  }

  return messages;
}

/**
 * Get current task for an agent from recent messages
 */
async function getCurrentTask(mesh, agent, recentMessages) {
  // Find most recent task sent TO this agent
  const agentMessages = recentMessages.filter(msg => {
    return msg.to === agent && (msg.type === 'task' || msg.type === 'ask');
  });

  if (agentMessages.length === 0) {
    return null;
  }

  // Read the actual task content
  try {
    const msgPath = path.join('.ai/tx/msgs', agentMessages[0].filename);
    if (fs.existsSync(msgPath)) {
      const content = fs.readFileSync(msgPath, 'utf8');

      // Extract headline from frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const headlineMatch = frontmatterMatch[1].match(/headline:\s*(.+)/);
        if (headlineMatch) {
          return headlineMatch[1];
        }
      }

      // Fallback to first line of content
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      return lines[0] || 'Processing...';
    }
  } catch (err) {
    // Ignore read errors
  }

  return 'Processing...';
}

/**
 * Get last activity timestamp for an agent
 */
async function getLastActivity(mesh, agent, recentMessages) {
  // Find most recent message FROM or TO this agent
  const agentMessages = recentMessages.filter(msg => {
    return msg.from === agent || msg.to === agent;
  });

  if (agentMessages.length === 0) {
    return null;
  }

  return agentMessages[0].timestamp;
}

/**
 * Check if agent is idle (no activity in last 2 minutes)
 */
function isAgentIdle(lastActivity) {
  if (!lastActivity) {
    return true;
  }

  const idleThresholdMs = 2 * 60 * 1000; // 2 minutes
  const now = Date.now();
  return (now - lastActivity) > idleThresholdMs;
}

/**
 * Format time ago string
 */
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  } else if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m ago`;
  } else {
    return `${Math.floor(diffSec / 3600)}h ago`;
  }
}

/**
 * Truncate text to max length
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Generate a prompt-ready status summary
 */
async function generateStatusPrompt() {
  try {
    const meshDir = '.ai/tx/mesh';
    if (!fs.existsSync(meshDir)) {
      return '## TX Status\nNo active meshes.';
    }

    let meshes = fs.readdirSync(meshDir).filter(f => {
      const stateFile = path.join(meshDir, f, 'state.json');
      return fs.statSync(path.join(meshDir, f)).isDirectory() && fs.existsSync(stateFile);
    });

    if (meshes.length === 0) {
      return '## TX Status\nNo active meshes.';
    }

    const msgsDir = '.ai/tx/msgs';
    const recentMessages = await getRecentMessages(msgsDir, 5 * 60 * 1000);

    let prompt = '## TX Status\n\n';

    for (const mesh of meshes) {
      prompt += `### ${mesh}\n`;

      const agentsDir = path.join(meshDir, mesh, 'agents');
      const agents = fs.existsSync(agentsDir)
        ? fs.readdirSync(agentsDir).filter(f => {
            return fs.statSync(path.join(agentsDir, f)).isDirectory();
          })
        : [];

      for (const agent of agents) {
        const currentTask = await getCurrentTask(mesh, agent, recentMessages);
        const lastActivity = await getLastActivity(mesh, agent, recentMessages);
        const idle = isAgentIdle(lastActivity);

        prompt += `- **${agent}**: ${currentTask || (idle ? 'idle' : 'waiting')}\n`;
      }

      prompt += '\n';
    }

    // Add watchers
    const watchers = await SystemManager.getActiveWatchers();
    const activeWatchers = watchers.filter(w => w.isActive);

    if (activeWatchers.length > 0) {
      prompt += '### Active Watchers\n';
      for (const watcher of activeWatchers) {
        prompt += `- ${watcher.meshName} → ${path.basename(watcher.watchedFile)}\n`;
      }
      prompt += '\n';
    }

    return prompt;
  } catch (error) {
    Logger.error('status', `Failed to generate status prompt: ${error.message}`);
    return '## TX Status\nError generating status.';
  }
}

module.exports = { status };

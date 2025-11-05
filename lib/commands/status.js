const { TmuxInjector } = require('../tmux-injector');
const { AtomicState } = require('../atomic-state');
const { SystemManager } = require('../system-manager');
const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('../logger');

/**
 * Simplified status display
 * Shows meshes with their agents, current tasks, and idle detection
 */
async function status(options = {}) {
  if (options.prompt) {
    const promptStatus = await generateStatusPrompt();
    console.log(promptStatus);
    return;
  }

  try {
    console.log('📊 TX Status\n');

    // Get all meshes
    const meshDir = '.ai/tx/mesh';
    if (!fs.existsSync(meshDir)) {
      console.log('No meshes active');
      return;
    }

    let meshes = fs.readdirSync(meshDir).filter(f => {
      return fs.statSync(path.join(meshDir, f)).isDirectory();
    });

    // Filter to only meshes with state.json (living meshes)
    meshes = meshes.filter(mesh => {
      const stateFile = path.join(meshDir, mesh, 'state.json');
      return fs.existsSync(stateFile);
    });

    if (meshes.length === 0) {
      console.log('No active meshes\n');
      return;
    }

    // Get recent messages for idle detection
    const msgsDir = '.ai/tx/msgs';
    const recentMessages = await getRecentMessages(msgsDir, 5 * 60 * 1000); // Last 5 minutes

    // Display each mesh
    for (const mesh of meshes) {
      const state = AtomicState.read(mesh);
      console.log(`📦 ${mesh}`);

      // Get agents in this mesh
      const agentsDir = path.join(meshDir, mesh, 'agents');
      const agents = fs.existsSync(agentsDir)
        ? fs.readdirSync(agentsDir).filter(f => {
            return fs.statSync(path.join(agentsDir, f)).isDirectory();
          })
        : [];

      if (agents.length === 0) {
        console.log('   No agents');
        console.log();
        continue;
      }

      // Display agents with their status
      for (const agent of agents) {
        const agentPath = `${mesh}/${agent}`;

        // Get current task from recent messages
        const currentTask = await getCurrentTask(mesh, agent, recentMessages);

        // Detect idle state (no messages in last 2 minutes)
        const lastActivity = await getLastActivity(mesh, agent, recentMessages);
        const isIdle = isAgentIdle(lastActivity);

        // Format agent display
        const statusIcon = isIdle ? '💤' : '🟢';
        const taskDisplay = currentTask
          ? truncateText(currentTask, 40)
          : (isIdle ? 'idle' : 'waiting...');

        console.log(`   ${statusIcon} ${agent}: ${taskDisplay}`);

        if (lastActivity && !isIdle) {
          const timeAgo = formatTimeAgo(lastActivity);
          console.log(`      └─ active ${timeAgo}`);
        }
      }

      console.log();
    }

    // Show active watchers
    const watchers = await SystemManager.getActiveWatchers();
    const activeWatchers = watchers.filter(w => w.isActive);

    if (activeWatchers.length > 0) {
      console.log('👁️  Watchers:');
      for (const watcher of activeWatchers) {
        const status = watcher.currentState === 'idle' ? '💤' : '🟢';
        console.log(`   ${status} ${watcher.meshName} → ${path.basename(watcher.watchedFile)}`);
      }
      console.log();
    }

    // Summary
    const totalAgents = meshes.reduce((sum, mesh) => {
      const agentsDir = path.join(meshDir, mesh, 'agents');
      return sum + (fs.existsSync(agentsDir)
        ? fs.readdirSync(agentsDir).filter(f => {
            return fs.statSync(path.join(agentsDir, f)).isDirectory();
          }).length
        : 0);
    }, 0);

    console.log(`Summary: ${meshes.length} meshes, ${totalAgents} agents, ${activeWatchers.length} watchers`);

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

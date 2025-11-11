const { StateManager } = require('../state-manager');
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

/**
 * Initialize state tracking for existing agents
 * Scans running tmux sessions and creates state files
 */
async function initState() {
  console.log('🔍 Scanning for running TX agents...\n');

  // Get all running tmux sessions
  let sessions;
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (!output) {
      console.log('No tmux sessions found');
      return;
    }

    sessions = output.split('\n');
  } catch (error) {
    console.log('No tmux server running');
    return;
  }

  // Get all mesh directories
  const meshDir = '.ai/tx/mesh';
  if (!await fs.pathExists(meshDir)) {
    console.log('No mesh directory found');
    return;
  }

  const meshDirs = await fs.readdir(meshDir);
  let initializedCount = 0;

  // For each mesh, check agents
  for (const mesh of meshDirs) {
    const agentsDir = path.join(meshDir, mesh, 'agents');
    if (!await fs.pathExists(agentsDir)) {
      continue;
    }

    const agents = await fs.readdir(agentsDir);

    for (const agent of agents) {
      const agentPath = path.join(agentsDir, agent);
      const stats = await fs.stat(agentPath);

      if (!stats.isDirectory()) {
        continue;
      }

      const agentId = `${mesh}/${agent}`;

      // Determine session name
      let sessionName;
      if (mesh === agent) {
        sessionName = mesh; // Persistent mesh like brain/brain -> brain
      } else {
        sessionName = `${mesh}-${agent}`; // Instance mesh
      }

      // Check if session exists
      if (sessions.includes(sessionName)) {
        // Check if state already exists
        const existingState = await StateManager.getState(agentId);

        if (!existingState) {
          // Initialize state
          await StateManager.initializeAgent(agentId, sessionName);
          await StateManager.transitionState(agentId, StateManager.STATES.READY);
          console.log(`✅ Initialized state for ${agentId} (session: ${sessionName})`);
          initializedCount++;
        } else {
          console.log(`⏭️  State already exists for ${agentId}`);
        }
      }
    }
  }

  console.log(`\n✨ Initialized ${initializedCount} agent${initializedCount !== 1 ? 's' : ''}`);

  if (initializedCount > 0) {
    console.log('\n💡 Run "tx status" to see state tracking in action');
  }

  // Cleanup StateManager to allow process to exit
  StateManager.cleanup();
  process.exit(0);
}

module.exports = { initState };

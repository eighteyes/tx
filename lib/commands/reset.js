const path = require('path');
const fs = require('fs-extra');
const { Logger } = require('../logger');
const { TmuxInjector } = require('../tmux-injector');
const { TX_ROOT } = require('../paths');
const { AgentPath } = require('../utils/agent-path');
const { ResetHandler } = require('../reset-handler');

/**
 * Reset an agent by clearing its session and re-injecting its original prompt
 * @param {string} mesh - Mesh name (e.g., "core", "research-abc123")
 * @param {string} agent - Optional agent name. If not provided, resets all agents in mesh
 */
async function reset(mesh, agent = null) {
  try {
    // If no agent specified, reset all agents in the mesh
    if (!agent) {
      return await resetAllAgents(mesh);
    }

    // Reset single agent
    const agentName = agent;

    // Determine session name using same logic as spawn command:
    // - core/core should be just "core"
    // - mesh/mesh should be just mesh name
    // - otherwise mesh-agent
    const sessionName = (mesh === 'core' && agentName === 'core')
      ? 'core'
      : (mesh === agentName)
      ? mesh
      : `${mesh}-${agentName}`;

    Logger.log('reset', 'Resetting agent', {
      mesh,
      agent: agentName,
      session: sessionName
    });

    // Check if session exists
    if (!TmuxInjector.sessionExists(sessionName)) {
      console.error(`❌ Session not found: ${sessionName}`);
      console.log('\nAvailable sessions:');
      const sessions = TmuxInjector.listSessions();
      if (sessions.length === 0) {
        console.log('   (no active sessions)');
      } else {
        sessions.forEach(s => console.log(`   - ${s}`));
      }
      process.exit(1);
    }

    console.log(`\n🔄 Resetting ${mesh}/${agentName}...`);

    // Step 1: Inject /clear command
    console.log('   1. Clearing session...');
    TmuxInjector.injectCommand(sessionName, 'clear');

    // Wait for clear to complete
    await TmuxInjector.waitForIdle(sessionName, 2000, 10000);

    // Step 2: Find and inject the most recent prompt message from .ai/tx/msgs/
    console.log('   2. Finding last prompt message...');

    const msgsDir = '.ai/tx/msgs';
    if (!fs.existsSync(msgsDir)) {
      console.error(`❌ Messages directory not found: ${msgsDir}`);
      process.exit(1);
    }

    // Find most recent prompt message for this agent
    // Pattern: *-prompt-system--{agent}-*.md
    const files = fs.readdirSync(msgsDir);
    const promptMessages = files
      .filter(f => f.includes(`-prompt-system--${agentName}-`))
      .sort()
      .reverse(); // Most recent first

    if (promptMessages.length === 0) {
      console.error(`❌ No prompt messages found for agent: ${agentName}`);
      console.log(`   Looking for pattern: *-prompt-system--${agentName}-*.md in ${msgsDir}`);
      process.exit(1);
    }

    const lastPromptFile = promptMessages[0];
    const promptPath = path.resolve(msgsDir, lastPromptFile);

    console.log(`   3. Re-injecting prompt: ${lastPromptFile}`);

    // Inject the prompt file
    TmuxInjector.injectFile(sessionName, promptPath, true);

    // Wait for injection to complete
    await TmuxInjector.waitForIdle(sessionName, 2000, 10000);

    console.log('✅ Reset complete!\n');

    Logger.log('reset', 'Agent reset complete', {
      mesh,
      agent: agentName,
      session: sessionName,
      promptPath
    });

  } catch (error) {
    console.error(`❌ Error resetting agent: ${error.message}`);
    Logger.error('reset', `Failed to reset agent: ${error.message}`, {
      mesh,
      agent,
      error: error.stack
    });
    process.exit(1);
  }
}

/**
 * Reset all agents in a mesh
 * @param {string} mesh - Mesh name or mesh instance ID
 */
async function resetAllAgents(mesh) {
  try {
    console.log(`\n🔄 Resetting all agents in mesh: ${mesh}...`);

    // Strip UUID suffix if present to get base mesh name
    let baseMeshName = mesh;
    const lastDashIndex = mesh.lastIndexOf('-');
    if (lastDashIndex > 0) {
      const suffix = mesh.substring(lastDashIndex + 1);
      if (/^[0-9a-f]{6}$/.test(suffix)) {
        baseMeshName = mesh.substring(0, lastDashIndex);
      }
    }

    // Load mesh config to get agent list
    const configPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${baseMeshName}.json`);

    if (!fs.existsSync(configPath)) {
      console.error(`❌ Mesh config not found: ${configPath}`);
      console.log('\nAvailable meshes:');
      const meshConfigsDir = path.join(TX_ROOT, 'meshes/mesh-configs');
      if (fs.existsSync(meshConfigsDir)) {
        const meshes = fs.readdirSync(meshConfigsDir)
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace('.json', ''));
        meshes.forEach(m => console.log(`   - ${m}`));
      }
      process.exit(1);
    }

    const config = fs.readJsonSync(configPath);
    const agents = config.agents || [];

    if (agents.length === 0) {
      console.error(`❌ No agents found in mesh config: ${baseMeshName}`);
      process.exit(1);
    }

    console.log(`   Found ${agents.length} agent(s) in mesh config\n`);

    // Reset each agent
    let successCount = 0;
    let failCount = 0;

    for (const agentPath of agents) {
      // Extract agent name from path (e.g., "core/core" -> "core", "product-dev/coordinator" -> "coordinator")
      const agentName = AgentPath.extractName(agentPath);

      try {
        console.log(`\n--- Resetting ${mesh}/${agentName} ---`);
        await resetSingleAgent(mesh, agentName);
        successCount++;
      } catch (error) {
        console.error(`   ❌ Failed to reset ${agentName}: ${error.message}`);
        failCount++;
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Reset complete!`);
    console.log(`   Success: ${successCount}/${agents.length}`);
    if (failCount > 0) {
      console.log(`   Failed: ${failCount}/${agents.length}`);
    }
    console.log(`${'='.repeat(50)}\n`);

    Logger.log('reset', 'All agents reset', {
      mesh,
      baseMeshName,
      totalAgents: agents.length,
      success: successCount,
      failed: failCount
    });

  } catch (error) {
    console.error(`❌ Error resetting mesh: ${error.message}`);
    Logger.error('reset', `Failed to reset mesh: ${error.message}`, {
      mesh,
      error: error.stack
    });
    process.exit(1);
  }
}

/**
 * Reset a single agent (internal helper)
 * @param {string} mesh - Mesh name or instance
 * @param {string} agentName - Agent name
 */
async function resetSingleAgent(mesh, agentName) {
  // Determine session name using same logic as spawn command
  const sessionName = ResetHandler.getSessionName(mesh, agentName);

  Logger.log('reset', 'Resetting agent', {
    mesh,
    agent: agentName,
    session: sessionName
  });

  // Check if session exists
  if (!TmuxInjector.sessionExists(sessionName)) {
    throw new Error(`Session not found: ${sessionName}`);
  }

  // Step 1: Clear session
  console.log('   1. Clearing session...');

  // Step 2: Find and re-inject prompt
  console.log('   2. Finding last prompt message...');

  const promptPath = ResetHandler.findPromptMessage(agentName);
  if (!promptPath) {
    throw new Error(`No prompt messages found for agent: ${agentName} (pattern: *-prompt-system--${agentName}-*.md)`);
  }

  const promptFile = path.basename(promptPath);
  console.log(`   3. Re-injecting prompt: ${promptFile}`);

  // Use ResetHandler to perform the reset
  const success = await ResetHandler.resetSession(sessionName, agentName, { silent: true });

  if (!success) {
    throw new Error('Reset failed - check logs for details');
  }

  console.log('   ✅ Agent reset complete');

  Logger.log('reset', 'Agent reset complete', {
    mesh,
    agent: agentName,
    session: sessionName,
    promptPath
  });
}

module.exports = { reset };

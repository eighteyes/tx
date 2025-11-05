const path = require('path');
const fs = require('fs-extra');
const { Logger } = require('../logger');
const { TmuxInjector } = require('../tmux-injector');

/**
 * Reset an agent by clearing its session and re-injecting its original prompt
 * @param {string} mesh - Mesh name (e.g., "core", "research-abc123")
 * @param {string} agent - Optional agent name (defaults to mesh name)
 */
async function reset(mesh, agent = null) {
  try {
    // If no agent specified, use mesh name as agent name
    const agentName = agent || mesh;

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
    // Pattern: *-prompt-system>{agent}-*.md
    const files = fs.readdirSync(msgsDir);
    const promptMessages = files
      .filter(f => f.includes(`-prompt-system>${agentName}-`))
      .sort()
      .reverse(); // Most recent first

    if (promptMessages.length === 0) {
      console.error(`❌ No prompt messages found for agent: ${agentName}`);
      console.log(`   Looking for pattern: *-prompt-system>${agentName}-*.md in ${msgsDir}`);
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

module.exports = { reset };

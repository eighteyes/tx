const { SimpleQueue } = require('../queue');
const { TmuxInjector } = require('../tmux-injector');
const { AtomicState } = require('../atomic-state');
const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('../logger');

function status(options = {}) {
  if (options.prompt) {
    const promptStatus = generateStatusPrompt();
    console.log(promptStatus);
    return;
  }
  try {
    console.log('📊 TX Status\n');

    // Get active tmux sessions
    const sessions = TmuxInjector.listSessions();
    console.log(`Tmux Sessions (${sessions.length}):`);
    if (sessions.length === 0) {
      console.log('   None');
    } else {
      sessions.forEach(s => console.log(`   ✓ ${s}`));
    }
    console.log();

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

    console.log(`Active Meshes (${meshes.length}):`);
    if (meshes.length === 0) {
      console.log('   None');
      console.log();
      console.log(`Summary:`);
      console.log(`  Total meshes: 0`);
      console.log(`  Total inbox: 0`);
      console.log(`  Total active: 0`);
      console.log();
      return;
    }
    console.log();

    meshes.forEach(mesh => {
      const state = AtomicState.read(mesh);
      const status = SimpleQueue.getQueueStatus(mesh);

      console.log(`  📦 ${mesh}`);
      if (state) {
        console.log(`     Status: ${state.status}`);
        console.log(`     Agent: ${state.current_agent || 'N/A'}`);
        if (state.workflow && state.workflow.length > 0) {
          console.log(
            `     Workflow: [${state.workflow.join(' → ')}] (${state.workflow_position + 1}/${state.workflow.length})`
          );
        }
      }

      console.log(`     Queue:`);
      console.log(`       Inbox: ${status.inbox}`);
      console.log(`       Next: ${status.next}`);
      console.log(`       Active: ${status.active}`);
      console.log(`       Complete: ${status.complete}`);
      console.log();
    });

    // Summary
    const totalInbox = meshes.reduce(
      (sum, m) => sum + SimpleQueue.getQueueStatus(m).inbox,
      0
    );
    const totalActive = meshes.reduce(
      (sum, m) => sum + SimpleQueue.getQueueStatus(m).active,
      0
    );

    console.log(`Summary:`);
    console.log(`  Total meshes: ${meshes.length}`);
    console.log(`  Total inbox: ${totalInbox}`);
    console.log(`  Total active: ${totalActive}`);
    console.log();
  } catch (error) {
    console.error('❌ Failed to get status:', error.message);
    process.exit(1);
  }
}

/**
 * Generate a prompt-ready status summary for injection into preamble
 */
function generateStatusPrompt() {
  try {
    const meshDir = '.ai/tx/mesh';
    if (!fs.existsSync(meshDir)) {
      return '## TX Status\nNo active meshes.';
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
      return '## TX Status\nNo active meshes.';
    }

    let prompt = '## TX Status\n\n';

    meshes.forEach(mesh => {
      // Get mesh config for description
      const configPath = `meshes/mesh-configs/${mesh}.json`;
      let description = 'No description';
      if (fs.existsSync(configPath)) {
        const config = fs.readJsonSync(configPath);
        description = config.description || 'No description';
      }

      prompt += `### Mesh: **${mesh}**\n`;
      prompt += `${description}\n\n`;

      // List agents in this mesh
      const agentsDir = path.join(meshDir, mesh, 'agents');
      if (fs.existsSync(agentsDir)) {
        const agents = fs.readdirSync(agentsDir).filter(f => {
          return fs.statSync(path.join(agentsDir, f)).isDirectory();
        });

        agents.forEach(agent => {
          // Get agent config for description
          const agentConfigPath = path.join('meshes', 'agents', mesh, agent, 'config.json');
          let agentDesc = 'No description';
          if (fs.existsSync(agentConfigPath)) {
            const agentConfig = fs.readJsonSync(agentConfigPath);
            agentDesc = agentConfig.description || 'No description';
          }

          prompt += `**Agent: ${agent}** - ${agentDesc}\n`;

          // Get current task
          const activeDir = path.join(meshDir, mesh, 'agents', agent, 'msgs', 'active');
          let currentTask = 'No active task';
          if (fs.existsSync(activeDir)) {
            const files = fs.readdirSync(activeDir);
            if (files.length > 0) {
              currentTask = files[0];
            }
          }
          prompt += `  Current: ${currentTask}\n`;

          // Get last 3 completed tasks
          const completeDir = path.join(meshDir, mesh, 'agents', agent, 'msgs', 'complete');
          if (fs.existsSync(completeDir)) {
            const completed = fs.readdirSync(completeDir)
              .sort()
              .reverse()
              .slice(0, 3);

            if (completed.length > 0) {
              prompt += `  Recent:\n`;
              completed.forEach(task => {
                prompt += `    - ${task}\n`;
              });
            }
          }

          prompt += '\n';
        });
      }

      prompt += '\n';
    });

    return prompt;
  } catch (error) {
    Logger.error('status', `Failed to generate status prompt: ${error.message}`);
    return '## TX Status\nError generating status.';
  }
}

module.exports = { status };

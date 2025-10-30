const fs = require('fs-extra');
const path = require('path');
const { SystemManager } = require('../system-manager');
const { TmuxInjector } = require('../tmux-injector');
const { Logger } = require('../logger');

async function stop(mesh = null, agent = null) {
  const pidFile = '.ai/tx/.tx-start.pid';

  try {
    // Determine what we're stopping
    if (mesh && agent) {
      // Stop specific agent
      console.log(`⏹️  Stopping ${mesh}/${agent}...\n`);
      return await stopAgent(mesh, agent);
    } else if (mesh) {
      // Stop all agents in mesh
      console.log(`⏹️  Stopping all agents in mesh: ${mesh}...\n`);
      return await stopMesh(mesh);
    } else {
      // Stop everything (original behavior)
      console.log('⏹️  Stopping TX...\n');
      return await stopAll(pidFile);
    }
  } catch (error) {
    console.error('❌ Failed to stop:', error.message);
    Logger.error('stop', `Failed to stop: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Stop a specific agent
 */
async function stopAgent(mesh, agent) {
  const sessionName = `${mesh}-${agent}`;

  const result = TmuxInjector.killSession(sessionName);

  if (result) {
    console.log(`✅ Agent stopped: ${sessionName}\n`);
    Logger.log('stop', 'Agent stopped', { mesh, agent, sessionName });
  } else {
    console.log(`⚠️  Session not found: ${sessionName}\n`);
  }
}

/**
 * Stop all agents in a mesh
 */
async function stopMesh(mesh) {
  const sessions = TmuxInjector.listSessions();
  const meshSessions = sessions.filter(s => s.startsWith(`${mesh}-`));

  if (meshSessions.length === 0) {
    console.log(`⚠️  No sessions found for mesh: ${mesh}\n`);
    return;
  }

  console.log(`Killing ${meshSessions.length} session(s) in mesh ${mesh}...`);

  meshSessions.forEach(session => {
    TmuxInjector.killSession(session);
    console.log(`   ✓ ${session}`);
  });

  // Clean up mesh state file
  const stateFile = path.join('.ai/tx/mesh', mesh, 'state.json');
  if (fs.existsSync(stateFile)) {
    fs.removeSync(stateFile);
    console.log(`   ✓ Removed state file: ${stateFile}`);
  }

  console.log(`\n✅ Mesh stopped: ${mesh}\n`);
  Logger.log('stop', 'Mesh stopped', { mesh, sessionCount: meshSessions.length });
}

/**
 * Stop everything (original behavior)
 */
async function stopAll(pidFile) {
  // Stop the background tx start process if running
  if (fs.existsSync(pidFile)) {
    const pid = fs.readFileSync(pidFile, 'utf-8').trim();
    console.log(`Found TX process (PID: ${pid}), stopping...`);

    try {
      process.kill(pid, 'SIGTERM');
      console.log('   ✓ Sent SIGTERM signal\n');

      // Wait a moment for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      if (e.code === 'ESRCH') {
        console.log('   ✓ Process already stopped\n');
      } else {
        console.warn(`   ⚠ Could not stop process: ${e.message}\n`);
      }
    }

    // Remove PID file
    fs.removeSync(pidFile);
  }

  // Kill all tmux sessions
  const sessions = TmuxInjector.listSessions();
  console.log(`Killing ${sessions.length} tmux session(s)...`);

  sessions.forEach(session => {
    TmuxInjector.killSession(session);
    console.log(`   ✓ ${session}`);
  });

  // Clean up all state.json files
  console.log('\nCleaning up state files...');
  const meshDir = '.ai/tx/mesh';
  let cleaned = 0;

  try {
    if (fs.existsSync(meshDir)) {
      const meshes = fs.readdirSync(meshDir);

      meshes.forEach(mesh => {
        const stateFile = path.join(meshDir, mesh, 'state.json');
        if (fs.existsSync(stateFile)) {
          try {
            fs.removeSync(stateFile);
            console.log(`   ✓ Removed: ${stateFile}`);
            cleaned++;
          } catch (e) {
            Logger.warn('stop', `Failed to remove state file: ${stateFile}`, { error: e.message });
          }
        }
      });
    }
  } catch (e) {
    Logger.warn('stop', `Failed to scan mesh directory: ${e.message}`);
  }

  if (cleaned > 0) {
    console.log(`\nCleaned ${cleaned} state file(s)`);
  }

  // Stop system (if this is being called from within a tx start process)
  console.log('\nStopping system...');
  await SystemManager.stop();

  // Clean up PID file if it still exists
  if (fs.existsSync(pidFile)) {
    fs.removeSync(pidFile);
  }

  console.log('\n✅ TX stopped\n');
  Logger.log('stop', 'System stopped', { sessionCount: sessions.length, stateFilesCleared: cleaned });
}

module.exports = { stop };

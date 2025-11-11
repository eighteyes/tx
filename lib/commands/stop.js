const fs = require('fs-extra');
const path = require('path');
const { SystemManager } = require('../system-manager');
const { TmuxInjector } = require('../tmux-injector');
const { SessionCapture } = require('../session-capture');
const { Logger } = require('../logger');
const { StateManager } = require('../state-manager');
const StateDB = require('../state-db');
const { Heartbeat } = require('../heartbeat');

async function stop(mesh = null, agent = null, options = {}) {
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
      // Stop everything (original behavior) - requires confirmation
      console.log('⏹️  Stopping TX...\n');

      // Ask for confirmation unless -y flag is set
      if (!options.yes) {
        const confirmed = await confirm('This will kill ALL tmux sessions and the tmux server. Continue? (y/N): ');
        if (!confirmed) {
          console.log('❌ Cancelled\n');
          return;
        }
      }

      return await stopAll(pidFile);
    }
  } catch (error) {
    console.error('❌ Failed to stop:', error.message);
    Logger.error('stop', `Failed to stop: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Prompt user for confirmation
 */
function confirm(question) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Stop a specific agent
 */
async function stopAgent(mesh, agent) {
  const sessionName = `${mesh}-${agent}`;
  const agentId = `${mesh}/${agent}`;

  // Capture session output before killing
  await SessionCapture.captureSession(mesh, agent, sessionName);

  const result = TmuxInjector.killSession(sessionName);

  if (result) {
    console.log(`✅ Agent stopped: ${sessionName}`);
  } else {
    console.log(`⚠️  Session not found: ${sessionName}`);
  }

  // Clean up agent state from SQLite
  try {
    StateManager.transitionState(agentId, StateManager.STATES.KILLED);
    StateManager.deleteAgent(agentId);
    console.log(`   ✓ Cleaned up state for: ${agentId}`);
    Logger.log('stop', 'Agent state cleaned', { mesh, agent, agentId });
  } catch (e) {
    Logger.warn('stop', `Failed to clean agent state: ${agentId}`, { error: e.message });
  }

  console.log();
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

  console.log(`Capturing ${meshSessions.length} session(s) in mesh ${mesh}...`);

  // Capture all sessions before killing
  for (const session of meshSessions) {
    // Extract agent name from session
    const agent = session.substring(mesh.length + 1);
    await SessionCapture.captureSession(mesh, agent, session);
    console.log(`   ✓ Captured: ${session}`);
  }

  console.log(`\nKilling ${meshSessions.length} session(s)...`);

  meshSessions.forEach(session => {
    TmuxInjector.killSession(session);
    console.log(`   ✓ ${session}`);
  });

  console.log('\nCleaning up state...');

  // Clean up mesh state file
  const stateFile = path.join('.ai/tx/mesh', mesh, 'state.json');
  if (fs.existsSync(stateFile)) {
    fs.removeSync(stateFile);
    console.log(`   ✓ Removed mesh state file: ${stateFile}`);
  }

  // Clean up agent states from SQLite
  const db = StateDB.init();
  let agentsCleaned = 0;

  try {
    for (const session of meshSessions) {
      const agent = session.substring(mesh.length + 1);
      const agentId = `${mesh}/${agent}`;

      try {
        StateManager.transitionState(agentId, StateManager.STATES.KILLED);
        StateManager.deleteAgent(agentId);
        agentsCleaned++;
      } catch (e) {
        Logger.warn('stop', `Failed to clean agent state: ${agentId}`, { error: e.message });
      }
    }

    if (agentsCleaned > 0) {
      console.log(`   ✓ Cleaned ${agentsCleaned} agent state(s) from database`);
    }

    // Clean up mesh state from SQLite
    db.prepare('DELETE FROM mesh_states WHERE mesh_name = ?').run(mesh);
    console.log(`   ✓ Cleaned mesh state from database`);
  } catch (e) {
    Logger.warn('stop', `Failed to clean mesh state: ${mesh}`, { error: e.message });
  }

  console.log(`\n✅ Mesh stopped: ${mesh}\n`);
  Logger.log('stop', 'Mesh stopped', { mesh, sessionCount: meshSessions.length, agentsCleaned });
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

  // Capture all sessions before killing
  const sessions = TmuxInjector.listSessions();

  if (sessions.length > 0) {
    console.log(`Capturing ${sessions.length} session(s)...`);

    for (const session of sessions) {
      // Try to parse mesh/agent from session name
      const parts = session.split('-');
      if (parts.length >= 2) {
        const mesh = parts.slice(0, -1).join('-');
        const agent = parts[parts.length - 1];
        await SessionCapture.captureSession(mesh, agent, session);
      } else {
        // Handle special cases like 'core'
        await SessionCapture.captureSession(session, session, session);
      }
      console.log(`   ✓ Captured: ${session}`);
    }

    console.log(`\nKilling ${sessions.length} tmux session(s)...`);

    sessions.forEach(session => {
      TmuxInjector.killSession(session);
      console.log(`   ✓ ${session}`);
    });
  }

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
    console.log(`   ✓ Cleaned ${cleaned} mesh state file(s)`);
  }

  // Clean up watcher state files
  console.log('\nCleaning up watcher state files...');
  const watcherDir = '.ai/tx/state/watchers';
  let watchersCleaned = 0;

  try {
    if (fs.existsSync(watcherDir)) {
      const watcherFiles = fs.readdirSync(watcherDir);

      watcherFiles.forEach(file => {
        if (file.endsWith('.json')) {
          const watcherFile = path.join(watcherDir, file);
          try {
            fs.removeSync(watcherFile);
            console.log(`   ✓ Removed watcher: ${file}`);
            watchersCleaned++;
          } catch (e) {
            Logger.warn('stop', `Failed to remove watcher file: ${watcherFile}`, { error: e.message });
          }
        }
      });
    }
  } catch (e) {
    Logger.warn('stop', `Failed to scan watcher directory: ${e.message}`);
  }

  if (watchersCleaned > 0) {
    console.log(`   ✓ Cleaned ${watchersCleaned} watcher(s)`);
  }

  // Clean up SQLite database
  console.log('\nCleaning up SQLite database...');
  let dbCleaned = false;

  try {
    const db = StateDB.init();

    // Get counts before cleanup
    const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
    const meshCount = db.prepare('SELECT COUNT(*) as count FROM mesh_states').get().count;

    if (agentCount > 0 || taskCount > 0 || meshCount > 0) {
      // Clear all tables
      db.prepare('DELETE FROM agents').run();
      db.prepare('DELETE FROM tasks').run();
      db.prepare('DELETE FROM mesh_states').run();
      // state_transitions and agent_metadata are CASCADE deleted

      console.log(`   ✓ Cleared ${agentCount} agent(s), ${taskCount} task(s), ${meshCount} mesh(es)`);
      dbCleaned = true;
    }

    // Close and optionally remove the database file
    StateDB.close();

    // Remove the database file for a complete cleanup
    const dbPath = '.ai/tx/state.db';
    if (fs.existsSync(dbPath)) {
      fs.removeSync(dbPath);
      console.log(`   ✓ Removed database file: ${dbPath}`);
      // Also remove WAL files
      if (fs.existsSync(`${dbPath}-wal`)) fs.removeSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.removeSync(`${dbPath}-shm`);
    }
  } catch (e) {
    Logger.warn('stop', `Failed to clean SQLite database: ${e.message}`);
  }

  // Stop heartbeat first
  console.log('\nStopping heartbeat...');
  Heartbeat.stop();
  console.log('   ✓ Heartbeat stopped');

  // Stop system (if this is being called from within a tx start process)
  console.log('\nStopping system...');
  await SystemManager.stop();

  // Clean up PID file if it still exists
  if (fs.existsSync(pidFile)) {
    fs.removeSync(pidFile);
  }

  // Kill the entire tmux server
  console.log('\nKilling tmux server...');
  try {
    const { execSync } = require('child_process');
    execSync('tmux kill-server', { stdio: 'pipe' });
    console.log('   ✓ tmux server killed');
  } catch (e) {
    // Server might already be dead or no sessions exist
    Logger.warn('stop', 'tmux server already stopped or not running');
  }

  console.log('\n✅ TX stopped\n');
  Logger.log('stop', 'System stopped', {
    sessionCount: sessions.length,
    stateFilesCleared: cleaned,
    watchersCleared: watchersCleaned,
    databaseCleaned: dbCleaned
  });
}

module.exports = { stop };

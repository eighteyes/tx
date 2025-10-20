const fs = require('fs-extra');
const path = require('path');
const { SystemManager } = require('../system-manager');
const { TmuxInjector } = require('../tmux-injector');
const { Logger } = require('../logger');

async function stop() {
  try {
    console.log('⏹️  Stopping TX...\n');

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

    // Stop system
    console.log('\nStopping system...');
    await SystemManager.stop();

    console.log('\n✅ TX stopped\n');
    Logger.log('stop', 'System stopped', { sessionCount: sessions.length, stateFilesCleared: cleaned });
  } catch (error) {
    console.error('❌ Failed to stop:', error.message);
    Logger.error('stop', `Failed to stop: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { stop };

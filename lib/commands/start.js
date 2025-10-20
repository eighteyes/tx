const { SystemManager } = require('../system-manager');
const { spawn } = require('./spawn');
const { TmuxInjector } = require('../tmux-injector');
const { Logger } = require('../logger');
const { Validator } = require('../validator');

async function cleanup(exitCode = 0) {
  try {
    console.log('\n🧹 Cleaning up...');
    await SystemManager.stop();
    console.log('✅ Cleanup complete');
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
    Logger.error('start', `Cleanup error: ${error.message}`, {
      error: error.stack
    });
  } finally {
    process.exit(exitCode);
  }
}

async function start(options = {}) {
  try {
    console.log('🚀 Starting TX system...\n');

    // Validate system before starting
    const validationResults = Validator.validateSystem();

    if (!validationResults.valid) {
      console.error('❌ System validation failed - cannot start');
      console.error('   Fix the errors above and try again\n');
      await cleanup(1);
      return;
    }

    console.log('✅ System validation passed\n');

    // Setup signal handlers for graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n📡 Received SIGTERM signal');
      cleanup(0);
    });

    process.on('SIGINT', () => {
      console.log('\n⏸️  Received SIGINT signal');
      cleanup(0);
    });

    process.on('SIGHUP', () => {
      console.log('\n📡 Received SIGHUP signal (terminal closed)');
      cleanup(0);
    });

    // Start system (queue + watcher)
    await SystemManager.start();
    console.log('✅ System started\n');

    // Check if tmux available
    const sessions = TmuxInjector.listSessions();
    const hasCore = sessions.includes('core');

    if (!hasCore) {
      // Spawn core agent using the same logic as regular spawn
      await spawn('core', 'core', {});
    }

    // Attach to core unless detached mode specified
    if (!options.detach) {
      console.log('🔗 Attaching to core session...\n');
      try {
        require('child_process').execSync('tmux attach -t core', {
          stdio: 'inherit'
        });
      } catch (e) {
        // User detached or session ended
        console.log('\n✅ Detached from core session');
      }
      // Exit after detaching from Tmux
      await cleanup(0);
    } else {
      console.log('✅ System running in detached mode');
      console.log('📌 Attach to core with: tx attach\n');
      // Keep running in detached mode
    }
  } catch (error) {
    console.error('❌ Failed to start:', error.message);
    Logger.error('start', `Failed to start: ${error.message}`, {
      error: error.stack
    });
    await cleanup(1);
  }
}

module.exports = { start };

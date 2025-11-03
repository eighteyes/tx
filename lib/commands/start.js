const { SystemManager } = require('../system-manager');
const { spawn } = require('./spawn');
const { TmuxInjector } = require('../tmux-injector');
const { Logger } = require('../logger');
const { Validator } = require('../validator');

async function cleanup(exitCode = 0) {
  const fs = require('fs-extra');
  const pidFile = '.ai/tx/.tx-start.pid';

  try {
    console.log('\n🧹 Cleaning up...');
    await SystemManager.stop();

    // Remove PID file
    if (fs.existsSync(pidFile)) {
      fs.removeSync(pidFile);
    }

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
  const fs = require('fs-extra');
  const pidFile = '.ai/tx/.tx-start.pid';

  try {
    // Kill any orphaned tx start processes
    const { execSync } = require('child_process');
    try {
      // Find all tx start processes except this one
      // Matches both: "node bin/tx.js start" and "node /path/to/tx start"
      const psOutput = execSync('ps aux | grep -E "node.*(bin/tx\\.js|/tx) start" | grep -v grep', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const orphans = psOutput.trim().split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const parts = line.trim().split(/\s+/);
          return { pid: parts[1], ppid: parts[2] };
        })
        .filter(proc => proc.pid !== String(process.pid));

      if (orphans.length > 0) {
        console.log(`🧹 Found ${orphans.length} orphaned tx start process(es), cleaning up...\n`);
        orphans.forEach(proc => {
          try {
            process.kill(proc.pid, 'SIGTERM');
            console.log(`   ✓ Killed PID ${proc.pid}`);
          } catch (e) {
            // Process might have already died
          }
        });
        // Wait a moment for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log();
      }
    } catch (e) {
      // ps command failed or no processes found - that's fine
    }

    // Clean up stale PID file if it exists
    if (fs.existsSync(pidFile)) {
      fs.removeSync(pidFile);
    }

    // Write our PID
    fs.ensureDirSync('.ai/tx');
    fs.writeFileSync(pidFile, String(process.pid));

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

    // Clean up any leftover messages from previous runs
    const coreMsgsDir = '.ai/tx/mesh/core/agents/core/msgs';
    if (fs.existsSync(coreMsgsDir)) {
      console.log('🧹 Cleaning up old messages from core...');
      try {
        const files = fs.readdirSync(coreMsgsDir);
        let cleanedCount = 0;
        files.forEach(file => {
          const filePath = `${coreMsgsDir}/${file}`;
          try {
            fs.removeSync(filePath);
            cleanedCount++;
          } catch (e) {
            console.log(`   ⚠️  Could not remove ${file}: ${e.message}`);
          }
        });
        if (cleanedCount > 0) {
          console.log(`   ✅ Removed ${cleanedCount} old message file(s)\n`);
        } else {
          console.log(`   ✅ No messages to clean\n`);
        }
      } catch (e) {
        console.log(`   ⚠️  Could not clean messages directory: ${e.message}\n`);
      }
    }

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

    // Start system (queue + watcher for centralized routing)
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

      // Use spawn instead of execSync to avoid blocking the event loop
      // This allows the watcher to continue processing file events while attached
      const { spawn: spawnProcess } = require('child_process');
      const tmuxProcess = spawnProcess('tmux', ['attach', '-t', 'core'], {
        stdio: 'inherit'
      });

      // Wait for tmux process to exit (when user detaches)
      await new Promise((resolve) => {
        tmuxProcess.on('exit', resolve);
      });

      console.log('\n✅ Detached from core session');

      // Keep the system running instead of exiting
      // This way watcher continues to work after detaching
      console.log('✅ System still running in background');
      console.log('📌 Attach again with: tx attach');
      console.log('🛑 Stop system with: tx stop\n');

      // Keep running - wait indefinitely like detached mode
      await new Promise(() => {});
    } else {
      console.log('✅ System running in detached mode');
      console.log('📌 Attach to core with: tx attach\n');
      // Keep running in detached mode - wait indefinitely
      // The watcher needs to stay alive, so we wait for signals
      await new Promise(() => {}); // Never resolves - keeps process alive until signal received
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

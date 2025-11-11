const { SystemManager } = require('../system-manager');
const { spawn } = require('./spawn');
const { TmuxInjector } = require('../tmux-injector');
const { SessionCapture } = require('../session-capture');
const { Logger } = require('../logger');
const { Validator } = require('../validator');
const { Heartbeat } = require('../heartbeat');

async function cleanup(exitCode = 0) {
  const fs = require('fs-extra');
  const pidFile = '.ai/tx/.tx-start.pid';

  try {
    console.log('\n🧹 Cleaning up...');

    // Stop heartbeat first
    Heartbeat.stop();

    // Capture and kill core session if it exists
    const sessions = TmuxInjector.listSessions();
    if (sessions.includes('core')) {
      console.log('Capturing core session...');
      await SessionCapture.captureSession('core', 'core', 'core');
      console.log('   ✓ Core session captured');

      console.log('Killing core session...');
      TmuxInjector.killSession('core');
      console.log('   ✓ Core session killed');
    }

    // Stop system manager (watcher/queue)
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

    // If detached mode, re-spawn as truly detached daemon, then exit
    if (options.detach && !process.env.TX_DAEMON_CHILD) {
      const { spawn: nodeSpawn } = require('child_process');
      const path = require('path');

      // Determine the correct script path
      const scriptPath = process.argv[1]; // bin/tx.js or full path

      console.log('🚀 Starting TX system in detached mode...\n');

      // Ensure log directory exists
      fs.ensureDirSync('.ai/tx');

      // Spawn as truly detached daemon with stdio redirected to log file
      // The child will open its own file descriptors
      const daemon = nodeSpawn(process.execPath, [scriptPath, 'start'], {
        detached: true,
        stdio: 'ignore', // Child will handle its own logging
        env: {
          ...process.env,
          TX_DAEMON_CHILD: '1',
          TX_DAEMON_LOG: path.join(process.cwd(), '.ai/tx/daemon.log')
        },
        cwd: process.cwd()
      });

      daemon.unref(); // Allow parent to exit

      console.log('✅ Daemon process started');
      console.log(`📍 PID will be written to: ${pidFile}`);
      console.log(`📝 Logs will be written to: .ai/tx/daemon.log`);
      console.log('📌 Attach to core with: tx attach\n');

      // Parent exits, daemon continues
      process.exit(0);
    }

    // If we're the daemon child, redirect stdout/stderr to log file
    if (process.env.TX_DAEMON_CHILD && process.env.TX_DAEMON_LOG) {
      const logStream = fs.createWriteStream(process.env.TX_DAEMON_LOG, { flags: 'a' });
      process.stdout.write = (chunk) => logStream.write(chunk);
      process.stderr.write = (chunk) => logStream.write(chunk);
      console.log = (...args) => logStream.write(args.join(' ') + '\n');
      console.error = (...args) => logStream.write('[ERROR] ' + args.join(' ') + '\n');
      console.log(`[${new Date().toISOString()}] Daemon child started, PID: ${process.pid}`);
    }

    // Write our PID (daemon child or non-detached)
    fs.ensureDirSync('.ai/tx');
    fs.writeFileSync(pidFile, String(process.pid));

    if (!process.env.TX_DAEMON_CHILD) {
      console.log('🚀 Starting TX system...\n');
    }

    // Check if core session already exists
    const sessions = TmuxInjector.listSessions();
    const hasCore = sessions.includes('core');

    if (hasCore) {
      console.error('❌ A core session is already active');
      console.error('   Either attach to it with: tx attach');
      console.error('   Or stop it first with: tx stop\n');
      process.exit(1);
    }

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

    // Spawn core agent using the same logic as regular spawn
    // keepAlive: true prevents spawn from calling process.exit()
    await spawn('core', 'core', { keepAlive: true });

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

      // Keep running - wait indefinitely
      await new Promise(() => {});
    } else if (process.env.TX_DAEMON_CHILD) {
      // Daemon child: keep running silently
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

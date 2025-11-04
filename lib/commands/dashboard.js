const { TmuxInjector } = require('../tmux-injector');
const { execSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('../logger');

const DASHBOARD_SESSION = 'tx-dashboard';
const PIPE_DIR = '/tmp/tx-dashboard-pipes';

/**
 * Create or update the TX dashboard
 * Shows all active agents in a tiled tmux layout
 * Core agent gets far-left pane (full height, larger)
 */
function dashboard(options = {}) {
  try {
    // Ensure pipe directory exists
    fs.ensureDirSync(PIPE_DIR);

    // Get all active sessions (exclude dashboard itself)
    const allSessions = TmuxInjector.listSessions();
    Logger.log('dashboard', 'All tmux sessions', { sessions: allSessions });

    const agentSessions = allSessions.filter(s => s !== DASHBOARD_SESSION);
    Logger.log('dashboard', 'Agent sessions (excluding dashboard)', { sessions: agentSessions });

    if (agentSessions.length === 0) {
      console.log('❌ No active agent sessions found');
      console.log('   Use: tx spawn <mesh> <agent>\n');
      Logger.log('dashboard', 'No agent sessions found, exiting');
      return;
    }

    // Separate core from other agents
    const coreSession = agentSessions.find(s => s === 'core' || s.startsWith('core-'));
    const otherSessions = agentSessions.filter(s => s !== coreSession);

    Logger.log('dashboard', 'Session breakdown', {
      total: agentSessions.length,
      core: coreSession || 'none',
      others: otherSessions
    });

    console.log(`📊 Setting up dashboard for ${agentSessions.length} agent(s)...\n`);

    // Check if dashboard session exists
    const dashboardExists = allSessions.includes(DASHBOARD_SESSION);

    if (dashboardExists) {
      console.log('🔄 Dashboard session exists, rebuilding layout...\n');
      // Kill and recreate for clean rebuild
      TmuxInjector.killSession(DASHBOARD_SESSION);
    }

    // Create fresh dashboard session (no command, just default shell)
    console.log('📦 Creating dashboard session...');
    execSync(`tmux new-session -d -s ${DASHBOARD_SESSION}`, { stdio: 'pipe' });
    console.log('✅ Dashboard session created\n');

    // No need to set up pipe-pane, we'll use tmux capture-pane directly
    console.log('🔌 Configuring live session display...');
    console.log('✅ Display configured\n');

    // Build dashboard layout
    console.log('🏗️  Building dashboard layout...');
    buildDashboardLayout(coreSession, otherSessions);
    console.log('✅ Layout complete\n');

    // Start background watcher for auto-refresh
    if (!options.noWatch) {
      console.log('👁️  Starting auto-refresh watcher...');
      startDashboardWatcher();
      console.log('✅ Watcher started\n');
    }

    console.log('✅ Dashboard ready!\n');
    console.log(`   Attach: tmux attach -t ${DASHBOARD_SESSION}`);
    console.log(`   Detach: Ctrl-b d`);
    console.log(`   Rebuild: tx dashboard\n`);

    // Auto-attach unless --no-attach
    if (!options.noAttach) {
      console.log('🔗 Attaching to dashboard...\n');
      try {
        execSync(`tmux attach -t ${DASHBOARD_SESSION}`, { stdio: 'inherit' });
      } catch (e) {
        // User detached
      }
    }

    Logger.log('dashboard', 'Dashboard created', {
      sessions: agentSessions.length,
      core: !!coreSession,
      others: otherSessions.length
    });
  } catch (error) {
    console.error('❌ Failed to create dashboard:', error.message);
    Logger.error('dashboard', `Failed to create dashboard: ${error.message}`, {
      error: error.stack
    });
    process.exit(1);
  }
}


/**
 * Build the dashboard layout by attaching to agent sessions in each pane
 * Core on far left (full height), others tiled on right
 */
function buildDashboardLayout(coreSession, otherSessions) {
  // Build session list for pane assignment
  const allSessions = coreSession ? [coreSession, ...otherSessions] : otherSessions;

  if (allSessions.length === 0) {
    Logger.warn('dashboard', 'No sessions to attach to');
    return;
  }

  // Step 1: Send attach command to first pane (window 1, pane 1 due to base-index)
  // Type command character by character to avoid dropping
  // Unset TMUX to allow nesting sessions
  const cmd = `TMUX= tmux attach -t ${allSessions[0]}`;
  for (const char of cmd) {
    execSync(`tmux send-keys -t ${DASHBOARD_SESSION}:1.1 -l '${char}'`, { stdio: 'pipe' });
  }
  execSync(`tmux send-keys -t ${DASHBOARD_SESSION}:1.1 Enter`, { stdio: 'pipe' });
  execSync(`tmux select-pane -t ${DASHBOARD_SESSION}:1.1 -T '${allSessions[0]}'`, { stdio: 'pipe' });
  Logger.log('dashboard', `Pane 1 attached to ${allSessions[0]}`);

  // Step 2: Create panes for remaining agents
  for (let i = 1; i < allSessions.length; i++) {
    const session = allSessions[i];

    // Determine split direction based on core/others
    if (i === 1 && coreSession) {
      // Split horizontally for first other agent (right of core)
      execSync(`tmux split-window -t ${DASHBOARD_SESSION}:1.1 -h -p 60`, { stdio: 'pipe' });
    } else {
      // Split vertically for additional agents
      execSync(`tmux split-window -t ${DASHBOARD_SESSION} -v`, { stdio: 'pipe' });
    }

    // Get the new pane index (last pane)
    const panes = execSync(`tmux list-panes -t ${DASHBOARD_SESSION} -F '#{pane_index}'`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim().split('\n').map(p => parseInt(p, 10));
    const newPaneIndex = Math.max(...panes);

    // Send attach command character by character to avoid dropping
    // Unset TMUX to allow nesting sessions
    const attachCmd = `TMUX= tmux attach -t ${session}`;
    for (const char of attachCmd) {
      execSync(`tmux send-keys -t ${DASHBOARD_SESSION}:1.${newPaneIndex} -l '${char}'`, { stdio: 'pipe' });
    }
    execSync(`tmux send-keys -t ${DASHBOARD_SESSION}:1.${newPaneIndex} Enter`, { stdio: 'pipe' });
    execSync(`tmux select-pane -t ${DASHBOARD_SESSION}:1.${newPaneIndex} -T '${session}'`, { stdio: 'pipe' });
    Logger.log('dashboard', `Pane ${newPaneIndex} attached to ${session}`);
  }

  // Step 3: Apply layout
  if (coreSession && otherSessions.length > 0) {
    execSync(`tmux select-layout -t ${DASHBOARD_SESSION} main-vertical`, { stdio: 'pipe' });
    execSync(`tmux resize-pane -t ${DASHBOARD_SESSION}:1.1 -x 40%`, { stdio: 'pipe' });
  } else {
    execSync(`tmux select-layout -t ${DASHBOARD_SESSION} tiled`, { stdio: 'pipe' });
  }

  Logger.log('dashboard', 'Dashboard layout built with attached panes', {
    core: !!coreSession,
    others: otherSessions.length,
    total: allSessions.length
  });
}

/**
 * Start background watcher to dynamically add/remove panes as sessions change
 */
function startDashboardWatcher() {
  const watcherScript = path.join(__dirname, '../dashboard-watcher.js');

  // Create watcher script if it doesn't exist
  const watcherCode = `
const { TmuxInjector } = require('./tmux-injector');
const { execSync } = require('child_process');
const { Logger } = require('./logger');
const path = require('path');
const fs = require('fs-extra');

const DASHBOARD_SESSION = 'tx-dashboard';
const PIPE_DIR = '/tmp/tx-dashboard-pipes';
let lastSessions = [];
let paneMap = new Map(); // Map session name to pane index

/**
 * Get current dashboard pane configuration
 */
function getCurrentPanes() {
  try {
    const output = execSync(\`tmux list-panes -t \${DASHBOARD_SESSION} -F '#{pane_index}:#{pane_title}'\`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();

    const paneMap = new Map();
    output.split('\\n').forEach(line => {
      const [index, title] = line.split(':');
      if (title) {
        paneMap.set(title, parseInt(index, 10));
      }
    });
    return paneMap;
  } catch (error) {
    return new Map();
  }
}

/**
 * Add a new pane for a session
 */
function addPane(session, coreSession) {
  try {
    // Split window to create new pane
    // If this is core, it should be on the left (split current pane 1)
    // Otherwise, split from the last pane
    if (session === coreSession) {
      // Split far left (pane 1) horizontally, core gets left side
      execSync(\`tmux split-window -t \${DASHBOARD_SESSION}:1.1 -h -b -p 40\`, { stdio: 'pipe' });
      // The new pane will be at index 1, everything else shifts right
      const newPaneIndex = 1;

      // Send attach command character by character to avoid dropping
      // Unset TMUX to allow nesting sessions
      const attachCmd = \`TMUX= tmux attach -t \${session}\`;
      for (const char of attachCmd) {
        execSync(\`tmux send-keys -t \${DASHBOARD_SESSION}:1.\${newPaneIndex} -l '\${char}'\`, { stdio: 'pipe' });
      }
      execSync(\`tmux send-keys -t \${DASHBOARD_SESSION}:1.\${newPaneIndex} Enter\`, { stdio: 'pipe' });
      execSync(\`tmux select-pane -t \${DASHBOARD_SESSION}:1.\${newPaneIndex} -T '\${session}'\`, { stdio: 'pipe' });
    } else {
      // Split from the last pane
      execSync(\`tmux split-window -t \${DASHBOARD_SESSION}\`, { stdio: 'pipe' });

      // Get the new pane index (should be the last one)
      const panes = execSync(\`tmux list-panes -t \${DASHBOARD_SESSION} -F '#{pane_index}'\`, {
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim().split('\\n').map(p => parseInt(p, 10));
      const newPaneIndex = Math.max(...panes);

      // Send attach command character by character to avoid dropping
      // Unset TMUX to allow nesting sessions
      const attachCmd = \`TMUX= tmux attach -t \${session}\`;
      for (const char of attachCmd) {
        execSync(\`tmux send-keys -t \${DASHBOARD_SESSION}:1.\${newPaneIndex} -l '\${char}'\`, { stdio: 'pipe' });
      }
      execSync(\`tmux send-keys -t \${DASHBOARD_SESSION}:1.\${newPaneIndex} Enter\`, { stdio: 'pipe' });
      execSync(\`tmux select-pane -t \${DASHBOARD_SESSION}:1.\${newPaneIndex} -T '\${session}'\`, { stdio: 'pipe' });
    }

    // Reapply layout
    applyLayout(coreSession);

    Logger.log('dashboard-watcher', \`Added pane for \${session}\`);
  } catch (error) {
    Logger.error('dashboard-watcher', \`Failed to add pane for \${session}: \${error.message}\`);
  }
}

/**
 * Remove a pane for a session
 */
function removePane(session, paneIndex) {
  try {
    execSync(\`tmux kill-pane -t \${DASHBOARD_SESSION}.\${paneIndex}\`, { stdio: 'pipe' });
    Logger.log('dashboard-watcher', \`Removed pane \${paneIndex} for \${session}\`);
  } catch (error) {
    Logger.error('dashboard-watcher', \`Failed to remove pane for \${session}: \${error.message}\`);
  }
}

/**
 * Apply appropriate layout based on whether core exists
 */
function applyLayout(coreSession) {
  try {
    const currentPanes = getCurrentPanes();
    const hasCorePane = Array.from(currentPanes.keys()).includes(coreSession);

    if (hasCorePane && currentPanes.size > 1) {
      // Core exists with other panes - use main-vertical layout
      execSync(\`tmux select-layout -t \${DASHBOARD_SESSION} main-vertical\`, { stdio: 'pipe' });
      // Resize core (pane 1) to 40%
      execSync(\`tmux resize-pane -t \${DASHBOARD_SESSION}.1 -x 40%\`, { stdio: 'pipe' });
    } else {
      // No core or only one pane - use tiled layout
      execSync(\`tmux select-layout -t \${DASHBOARD_SESSION} tiled\`, { stdio: 'pipe' });
    }
  } catch (error) {
    Logger.warn('dashboard-watcher', \`Failed to apply layout: \${error.message}\`);
  }
}

function checkAndUpdate() {
  try {
    const allSessions = TmuxInjector.listSessions();
    const agentSessions = allSessions.filter(s => s !== DASHBOARD_SESSION).sort();

    Logger.log('dashboard-watcher', 'Check cycle', {
      allSessions,
      agentSessions,
      dashboardExists: allSessions.includes(DASHBOARD_SESSION)
    });

    // Check if dashboard still exists
    if (!allSessions.includes(DASHBOARD_SESSION)) {
      Logger.log('dashboard-watcher', 'Dashboard session no longer exists, exiting');
      process.exit(0);
    }

    // No agents left, kill dashboard
    if (agentSessions.length === 0) {
      Logger.log('dashboard-watcher', 'No agents left, killing dashboard', {
        allSessions,
        agentSessions
      });
      TmuxInjector.killSession(DASHBOARD_SESSION);
      process.exit(0);
    }

    // Get current panes
    const currentPanes = getCurrentPanes();
    const currentSessions = Array.from(currentPanes.keys());

    // Find new sessions (need to add panes)
    const newSessions = agentSessions.filter(s => !currentSessions.includes(s));

    // Find removed sessions (need to remove panes)
    const removedSessions = currentSessions.filter(s => !agentSessions.includes(s));

    // Determine core session
    const coreSession = agentSessions.find(s => s === 'core' || s.startsWith('core-'));

    Logger.log('dashboard-watcher', 'Change detection', {
      currentSessions,
      agentSessions,
      newSessions,
      removedSessions,
      coreSession: coreSession || 'none'
    });

    // Add new panes
    newSessions.forEach(session => {
      Logger.log('dashboard-watcher', \`Detected new session: \${session}\`);
      addPane(session, coreSession);
    });

    // Remove old panes
    removedSessions.forEach(session => {
      const paneIndex = currentPanes.get(session);
      if (paneIndex !== undefined) {
        Logger.log('dashboard-watcher', \`Detected removed session: \${session}\`);
        removePane(session, paneIndex);
        // Reapply layout after removal
        applyLayout(coreSession);
      }
    });

    lastSessions = agentSessions;
  } catch (error) {
    Logger.error('dashboard-watcher', \`Error checking sessions: \${error.message}\`);
  }
}

// Initial setup
const initialSessions = TmuxInjector.listSessions();
lastSessions = initialSessions.filter(s => s !== DASHBOARD_SESSION).sort();

Logger.log('dashboard-watcher', 'Dashboard watcher starting', {
  allSessions: initialSessions,
  agentSessions: lastSessions,
  dashboardExists: initialSessions.includes(DASHBOARD_SESSION)
});

// Check every 2 seconds
setInterval(checkAndUpdate, 2000);

Logger.log('dashboard-watcher', 'Dashboard watcher started (dynamic mode)');
`.trim();

  fs.writeFileSync(watcherScript, watcherCode);

  // Spawn watcher as background process
  const watcher = spawn('node', [watcherScript], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..')
  });

  watcher.unref();

  // Save watcher PID
  const pidFile = path.join(PIPE_DIR, 'watcher.pid');
  fs.writeFileSync(pidFile, watcher.pid.toString());

  Logger.log('dashboard', 'Dashboard watcher started', { pid: watcher.pid });
}

/**
 * Stop the dashboard and clean up
 */
function stopDashboard() {
  try {
    // Kill dashboard session
    if (TmuxInjector.listSessions().includes(DASHBOARD_SESSION)) {
      TmuxInjector.killSession(DASHBOARD_SESSION);
      console.log('✅ Dashboard session stopped');
    }

    // Kill watcher process
    const pidFile = path.join(PIPE_DIR, 'watcher.pid');
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
        console.log('✅ Dashboard watcher stopped');
      } catch (e) {
        // Process may already be dead
      }
      fs.removeSync(pidFile);
    }

    // Clean up temp directory if it exists
    if (fs.existsSync(PIPE_DIR)) {
      fs.removeSync(PIPE_DIR);
      console.log('✅ Cleaned up temp files\n');
    }

    Logger.log('dashboard', 'Dashboard stopped and cleaned up');
  } catch (error) {
    console.error('❌ Failed to stop dashboard:', error.message);
    Logger.error('dashboard', `Failed to stop dashboard: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { dashboard, stopDashboard };

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
    const output = execSync(`tmux list-panes -t ${DASHBOARD_SESSION} -F '#{pane_index}:#{pane_title}'`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();

    const paneMap = new Map();
    output.split('\n').forEach(line => {
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
      execSync(`tmux split-window -t ${DASHBOARD_SESSION}:1.1 -h -b -p 40`, { stdio: 'pipe' });
      // The new pane will be at index 1, everything else shifts right
      const newPaneIndex = 1;

      // Send attach command character by character to avoid dropping
      // Unset TMUX to allow nesting sessions
      const attachCmd = `TMUX= tmux attach -t ${session}`;
      for (const char of attachCmd) {
        execSync(`tmux send-keys -t ${DASHBOARD_SESSION}:1.${newPaneIndex} -l '${char}'`, { stdio: 'pipe' });
      }
      execSync(`tmux send-keys -t ${DASHBOARD_SESSION}:1.${newPaneIndex} Enter`, { stdio: 'pipe' });
      execSync(`tmux select-pane -t ${DASHBOARD_SESSION}:1.${newPaneIndex} -T '${session}'`, { stdio: 'pipe' });
    } else {
      // Split from the last pane
      execSync(`tmux split-window -t ${DASHBOARD_SESSION}`, { stdio: 'pipe' });

      // Get the new pane index (should be the last one)
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
    }

    // Reapply layout
    applyLayout(coreSession);

    Logger.log('dashboard-watcher', `Added pane for ${session}`);
  } catch (error) {
    Logger.error('dashboard-watcher', `Failed to add pane for ${session}: ${error.message}`);
  }
}

/**
 * Remove a pane for a session
 */
function removePane(session, paneIndex) {
  try {
    execSync(`tmux kill-pane -t ${DASHBOARD_SESSION}.${paneIndex}`, { stdio: 'pipe' });
    Logger.log('dashboard-watcher', `Removed pane ${paneIndex} for ${session}`);
  } catch (error) {
    Logger.error('dashboard-watcher', `Failed to remove pane for ${session}: ${error.message}`);
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
      execSync(`tmux select-layout -t ${DASHBOARD_SESSION} main-vertical`, { stdio: 'pipe' });
      // Resize core (pane 1) to 40%
      execSync(`tmux resize-pane -t ${DASHBOARD_SESSION}.1 -x 40%`, { stdio: 'pipe' });
    } else {
      // No core or only one pane - use tiled layout
      execSync(`tmux select-layout -t ${DASHBOARD_SESSION} tiled`, { stdio: 'pipe' });
    }
  } catch (error) {
    Logger.warn('dashboard-watcher', `Failed to apply layout: ${error.message}`);
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
      Logger.log('dashboard-watcher', `Detected new session: ${session}`);
      addPane(session, coreSession);
    });

    // Remove old panes
    removedSessions.forEach(session => {
      const paneIndex = currentPanes.get(session);
      if (paneIndex !== undefined) {
        Logger.log('dashboard-watcher', `Detected removed session: ${session}`);
        removePane(session, paneIndex);
        // Reapply layout after removal
        applyLayout(coreSession);
      }
    });

    lastSessions = agentSessions;
  } catch (error) {
    Logger.error('dashboard-watcher', `Error checking sessions: ${error.message}`);
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

// Export for heartbeat to call
module.exports = { checkAndUpdate };

// If run directly (legacy mode), start interval
if (require.main === module) {
  // Check every 2 seconds
  setInterval(checkAndUpdate, 2000);
  Logger.log('dashboard-watcher', 'Dashboard watcher started (dynamic mode - standalone)');
} else {
  Logger.log('dashboard-watcher', 'Dashboard watcher module loaded (will be called by heartbeat)');
}
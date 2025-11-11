const Table = require('cli-table3');
const { StateManager } = require('../state-manager');
const TaskRegistry = require('../task-registry');
const { Logger } = require('../logger');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  redBright: '\x1b[91m'
};

// Color helper functions
const chalk = {
  red: (text) => `${colors.red}${text}${colors.reset}`,
  yellow: (text) => `${colors.yellow}${text}${colors.reset}`,
  blue: (text) => `${colors.blue}${text}${colors.reset}`,
  cyan: (text) => `${colors.cyan}${text}${colors.reset}`,
  green: (text) => `${colors.green}${text}${colors.reset}`,
  magenta: (text) => `${colors.magenta}${text}${colors.reset}`,
  white: (text) => `${colors.white}${text}${colors.reset}`,
  gray: (text) => `${colors.gray}${text}${colors.reset}`,
  redBright: (text) => `${colors.redBright}${text}${colors.reset}`,
  dim: (text) => `${colors.dim}${text}${colors.reset}`,
  bold: (text) => `${colors.bright}${text}${colors.reset}`
};

// Additional nested color functions
chalk.dim.gray = (text) => `${colors.dim}${colors.gray}${text}${colors.reset}`;
chalk.bold.white = (text) => `${colors.bright}${colors.white}${text}${colors.reset}`;
chalk.bold.cyan = (text) => `${colors.bright}${colors.cyan}${text}${colors.reset}`;

/**
 * Format duration from milliseconds to human readable
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Display agent state information
 */
class StateCommand {
  /**
   * Execute state command
   */
  static async execute(args, options) {
    try {
      // Parse command format: tx state [mesh] [agent]
      const mesh = args[0];
      const agent = args[1];

      if (options.distracted) {
        // Show only distracted agents
        return await StateCommand.showDistractedAgents();
      }

      if (options.watch) {
        // Watch mode - auto-refresh
        return await StateCommand.watchAllStates();
      }

      if (agent) {
        // Show specific agent state
        return await StateCommand.showAgentState(mesh, agent);
      } else if (mesh) {
        // Show mesh state summary
        return await StateCommand.showMeshState(mesh);
      } else {
        // Show all states
        return await StateCommand.showAllStates();
      }
    } catch (error) {
      Logger.error('state-command', `Failed to display state: ${error.message}`);
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * Show all agent states
   */
  static async showAllStates() {
    const states = await StateManager.getAllStates();

    if (Object.keys(states).length === 0) {
      console.log(chalk.yellow('No agents found'));
      return;
    }

    // Get tasks from registry
    const taskStats = TaskRegistry.getStats();

    // Group by mesh
    const meshes = {};
    for (const [agentId, state] of Object.entries(states)) {
      const [mesh] = agentId.split('/');
      if (!meshes[mesh]) {
        meshes[mesh] = [];
      }
      meshes[mesh].push({ agentId, state });
    }

    // Display by mesh
    for (const [mesh, agents] of Object.entries(meshes)) {
      // Get mesh state from database
      const db = require('../state-db').init();
      const meshState = db.prepare('SELECT * FROM mesh_states WHERE mesh_name = ?').get(mesh);

      let meshStatus = '';
      if (meshState) {
        const metadata = meshState.metadata ? JSON.parse(meshState.metadata) : {};
        if (meshState.current_agent) {
          meshStatus = chalk.gray(` (current: ${meshState.current_agent})`);
        }
      }

      console.log(chalk.bold.white(`\n📦 ${mesh}`) + meshStatus);

      for (const { agentId, state } of agents) {
        const [, agentName] = agentId.split('/');
        const lastActivity = formatDuration(Date.now() - new Date(state.lastActivity).getTime());
        const stateColor = StateCommand.getStateColor(state.state);
        const stateIcon = StateCommand.getStateIcon(state.state);

        // Get tasks for this agent from registry
        const agentTasks = TaskRegistry.getTasksForAgent(agentId);
        let taskInfo = '';

        if (agentTasks.length > 0) {
          const task = agentTasks[0]; // Show first/current task
          const priorityIcon = task.priority === 'critical' ? '🔴' : task.priority === 'high' ? '🟡' : '';
          taskInfo = chalk.white(` → ${priorityIcon}${task.summary.substring(0, 60)}`);
        } else if (state.currentTask) {
          // Fallback to state.currentTask if no registry tasks
          taskInfo = chalk.white(` → ${state.currentTask}`);
        }

        console.log(`   ${stateColor(stateIcon + ' ' + agentName)} ${chalk.gray(`(${state.state}, ${lastActivity} ago)`)}${taskInfo}`);
      }
    }

    // Show task summary
    console.log('');
    console.log(chalk.bold('Task Registry:'));
    console.log(`  Pending: ${taskStats.byStatus.pending}`);
    console.log(`  In Progress: ${taskStats.byStatus['in-progress']}`);
    console.log(`  Completed: ${taskStats.byStatus.completed}`);
    if (taskStats.orphaned > 0) {
      console.log(chalk.yellow(`  Orphaned: ${taskStats.orphaned}`));
    }

    // Show agent summary
    console.log('');
    StateCommand.showSummary(states);
  }

  /**
   * Show state for specific mesh
   */
  static async showMeshState(mesh) {
    const allStates = await StateManager.getAllStates();
    const meshStates = Object.entries(allStates)
      .filter(([id]) => id.startsWith(`${mesh}/`))
      .reduce((acc, [id, state]) => ({ ...acc, [id]: state }), {});

    if (Object.keys(meshStates).length === 0) {
      console.log(chalk.yellow(`No agents found for mesh: ${mesh}`));
      return;
    }

    // Get mesh state
    const meshStateValue = await StateManager.getMeshState(mesh);
    const meshColor = StateCommand.getMeshStateColor(meshStateValue);

    console.log(chalk.bold.white(`\n📦 Mesh: ${mesh}`));
    console.log(meshColor(`   State: ${meshStateValue.toUpperCase()}`));
    console.log();

    const table = new Table({
      head: [
        chalk.cyan('Agent'),
        chalk.cyan('State'),
        chalk.cyan('Duration'),
        chalk.cyan('Task'),
        chalk.cyan('Activity')
      ],
      colWidths: [20, 15, 12, 25, 20]
    });

    for (const [agentId, state] of Object.entries(meshStates)) {
      const [, agentName] = agentId.split('/');
      const duration = formatDuration(Date.now() - new Date(state.since).getTime());
      const stateColor = StateCommand.getStateColor(state.state);
      const stateIcon = StateCommand.getStateIcon(state.state);
      const activity = StateCommand.formatActivity(state);

      table.push([
        agentName,
        stateColor(`${stateIcon} ${state.state}`),
        duration,
        state.currentTask || chalk.gray('-'),
        activity
      ]);
    }

    console.log(table.toString());
  }

  /**
   * Show detailed state for specific agent
   */
  static async showAgentState(mesh, agent) {
    const agentId = `${mesh}/${agent}`;
    const state = await StateManager.getState(agentId);

    if (!state) {
      console.log(chalk.yellow(`Agent not found: ${agentId}`));
      return;
    }

    const stateColor = StateCommand.getStateColor(state.state);
    const stateIcon = StateCommand.getStateIcon(state.state);

    console.log(chalk.bold.white(`\n🤖 Agent: ${agentId}`));
    console.log();

    // Basic info
    console.log(chalk.cyan('Current State:'), stateColor(`${stateIcon} ${state.state}`));
    console.log(chalk.cyan('Since:'), new Date(state.since).toLocaleString());
    console.log(chalk.cyan('Duration:'), formatDuration(Date.now() - new Date(state.since).getTime()));
    console.log(chalk.cyan('Session:'), state.sessionName || chalk.gray('none'));
    console.log();

    // Task info
    console.log(chalk.bold('Task Information:'));
    console.log(chalk.cyan('  Current Task:'), state.currentTask || chalk.gray('none'));
    if (state.metadata.taskStarted) {
      console.log(chalk.cyan('  Task Started:'), new Date(state.metadata.taskStarted).toLocaleString());
      console.log(chalk.cyan('  Task Duration:'), formatDuration(Date.now() - new Date(state.metadata.taskStarted).getTime()));
    }
    console.log();

    // Activity info
    console.log(chalk.bold('Activity:'));
    console.log(chalk.cyan('  Last Activity:'), new Date(state.lastActivity).toLocaleString());
    console.log(chalk.cyan('  Inactive For:'), formatDuration(Date.now() - new Date(state.lastActivity).getTime()));
    console.log(chalk.cyan('  Distraction Count:'), state.metadata.distractionCount || 0);
    console.log();

    // Transition history
    console.log(chalk.bold('State Transitions:'));
    const recentTransitions = state.transitions.slice(-5);
    for (const transition of recentTransitions) {
      const time = new Date(transition.at).toLocaleTimeString();
      const from = transition.from || 'init';
      const to = transition.to;
      const arrow = chalk.gray('→');
      console.log(`  ${chalk.gray(time)} ${chalk.white(from)} ${arrow} ${StateCommand.getStateColor(to)(to)}`);
    }

    // Metadata
    if (Object.keys(state.metadata).length > 0) {
      console.log();
      console.log(chalk.bold('Metadata:'));
      for (const [key, value] of Object.entries(state.metadata)) {
        if (!['taskStarted', 'distractionCount', 'lastTransition'].includes(key)) {
          console.log(`  ${chalk.cyan(key)}:`, value);
        }
      }
    }
  }

  /**
   * Show only distracted agents
   */
  static async showDistractedAgents() {
    const states = await StateManager.getAllStates();
    const distracted = Object.entries(states)
      .filter(([, state]) => state.state === StateManager.STATES.DISTRACTED);

    if (distracted.length === 0) {
      console.log(chalk.green('✅ No distracted agents'));
      return;
    }

    console.log(chalk.yellow(`\n🐿️ ${distracted.length} Distracted Agent${distracted.length > 1 ? 's' : ''}:\n`));

    const table = new Table({
      head: [
        chalk.cyan('Agent'),
        chalk.cyan('Inactive For'),
        chalk.cyan('Task'),
        chalk.cyan('Distraction #')
      ],
      colWidths: [25, 15, 30, 15]
    });

    for (const [agentId, state] of distracted) {
      const inactiveFor = formatDuration(Date.now() - new Date(state.lastActivity).getTime());
      table.push([
        agentId,
        chalk.red(inactiveFor),
        state.currentTask || chalk.gray('unknown'),
        chalk.yellow(state.metadata.distractionCount || 1)
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim('\nTip: Use `tx reset <mesh> <agent>` to reset stuck agents'));
  }

  /**
   * Watch all states with auto-refresh
   */
  static async watchAllStates() {
    const interval = 2000; // 2 second refresh

    const refresh = async () => {
      console.clear();
      console.log(chalk.bold.cyan('📊 TX State Monitor'), chalk.gray(`(refreshing every ${interval/1000}s)`));
      console.log(chalk.gray('Press Ctrl+C to exit\n'));

      await StateCommand.showAllStates();
    };

    // Initial display
    await refresh();

    // Set up refresh interval
    setInterval(refresh, interval);

    // Keep process alive
    process.stdin.resume();
  }

  /**
   * Get color for state
   */
  static getStateColor(state) {
    const colors = {
      [StateManager.STATES.SPAWNED]: chalk.gray,
      [StateManager.STATES.INITIALIZING]: chalk.blue,
      [StateManager.STATES.READY]: chalk.green,
      [StateManager.STATES.WORKING]: chalk.cyan,
      [StateManager.STATES.BLOCKED]: chalk.yellow,
      [StateManager.STATES.DISTRACTED]: chalk.redBright,
      [StateManager.STATES.COMPLETING]: chalk.magenta,
      [StateManager.STATES.ERROR]: chalk.red,
      [StateManager.STATES.SUSPENDED]: chalk.gray,
      [StateManager.STATES.KILLED]: chalk.dim.gray
    };
    return colors[state] || chalk.white;
  }

  /**
   * Get icon for state
   */
  static getStateIcon(state) {
    const icons = {
      [StateManager.STATES.SPAWNED]: '🥚',
      [StateManager.STATES.INITIALIZING]: '🔄',
      [StateManager.STATES.READY]: '✅',
      [StateManager.STATES.WORKING]: '⚡',
      [StateManager.STATES.BLOCKED]: '⏸️',
      [StateManager.STATES.DISTRACTED]: '🐿️',
      [StateManager.STATES.COMPLETING]: '📝',
      [StateManager.STATES.ERROR]: '❌',
      [StateManager.STATES.SUSPENDED]: '💤',
      [StateManager.STATES.KILLED]: '💀'
    };
    return icons[state] || '❓';
  }

  /**
   * Get color for mesh state
   */
  static getMeshStateColor(state) {
    const colors = {
      active: chalk.cyan,
      ready: chalk.green,
      degraded: chalk.yellow,
      dead: chalk.red,
      mixed: chalk.white,
      unknown: chalk.gray
    };
    return colors[state] || chalk.white;
  }

  /**
   * Format activity info
   */
  static formatActivity(state) {
    const inactive = Date.now() - new Date(state.lastActivity).getTime();
    const formatted = formatDuration(inactive);

    if (inactive < 5000) {
      return chalk.green(`Active (${formatted})`);
    } else if (inactive < 10000) {
      return chalk.yellow(`Idle ${formatted}`);
    } else {
      return chalk.red(`Inactive ${formatted}`);
    }
  }

  /**
   * Show legend
   */
  static showLegend() {
    console.log('\n' + chalk.bold('State Legend:'));
    const states = [
      { state: StateManager.STATES.READY, desc: 'Available for tasks' },
      { state: StateManager.STATES.WORKING, desc: 'Processing task' },
      { state: StateManager.STATES.BLOCKED, desc: 'Waiting for input' },
      { state: StateManager.STATES.DISTRACTED, desc: 'Stuck/needs help' },
      { state: StateManager.STATES.ERROR, desc: 'Crashed/failed' }
    ];

    for (const { state, desc } of states) {
      const color = StateCommand.getStateColor(state);
      const icon = StateCommand.getStateIcon(state);
      console.log(`  ${icon} ${color(state.padEnd(12))} ${chalk.gray(desc)}`);
    }
  }

  /**
   * Show summary statistics
   */
  static showSummary(states) {
    const counts = {};
    for (const state of Object.values(states)) {
      counts[state.state] = (counts[state.state] || 0) + 1;
    }

    console.log('\n' + chalk.bold('Summary:'));
    console.log(`  Total agents: ${Object.keys(states).length}`);

    if (counts[StateManager.STATES.WORKING] > 0) {
      console.log(chalk.cyan(`  Working: ${counts[StateManager.STATES.WORKING] || 0}`));
    }
    if (counts[StateManager.STATES.DISTRACTED] > 0) {
      console.log(chalk.redBright(`  Distracted: ${counts[StateManager.STATES.DISTRACTED] || 0} 🐿️`));
    }
    if (counts[StateManager.STATES.ERROR] > 0) {
      console.log(chalk.red(`  Errors: ${counts[StateManager.STATES.ERROR] || 0}`));
    }
  }
}

module.exports = {
  StateCommand,
  state: (args = [], options = {}) => StateCommand.execute(args, options)
};
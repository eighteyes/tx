const { EventLogger } = require('../event-logger');
const { EventPublisher } = require('../event-publisher');
const { EventFormatter } = require('../event-formatter');
const { Logger } = require('../logger');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m'
};

/**
 * View event log
 */
async function eventsView(options = {}) {
  try {
    let events = [];

    // Get events based on filters
    if (options.since) {
      events = EventLogger.getSince(options.since);
    } else if (options.type) {
      events = EventLogger.getByType(options.type, options.limit || 50);
    } else if (options.agent) {
      events = EventLogger.getHistory(options.agent, options.limit || 50);
    } else {
      events = EventLogger.getHistory(null, options.limit || 50);
    }

    if (events.length === 0) {
      console.log(`${colors.dim}No events found${colors.reset}\n`);
      return;
    }

    // Display events
    console.log(`\n${colors.bright}${colors.cyan}Event Log${colors.reset} ${colors.dim}(${events.length} events)${colors.reset}\n`);

    events.forEach(event => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const icon = getEventIcon(event.eventType);
      const typeColor = getEventColor(event.eventType);

      console.log(`${colors.dim}${time}${colors.reset} ${icon} ${typeColor}${event.eventType.padEnd(10)}${colors.reset} ${event.agentId}`);

      if (options.verbose && event.content) {
        const preview = event.content.substring(0, 80).replace(/\n/g, ' ');
        console.log(`  ${colors.dim}${preview}${colors.reset}`);
      }
    });

    console.log();
  } catch (error) {
    console.error(`${colors.red}Error viewing events: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Show event statistics
 */
async function eventsStats() {
  try {
    const stats = EventLogger.getStats();

    console.log(`\n${colors.bright}${colors.cyan}Event Statistics${colors.reset}\n`);
    console.log(`Total Events: ${colors.bright}${stats.totalEvents}${colors.reset}`);

    if (Object.keys(stats.byType).length > 0) {
      console.log(`\n${colors.bright}By Type:${colors.reset}`);
      Object.entries(stats.byType)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          const icon = getEventIcon(type);
          const typeColor = getEventColor(type);
          console.log(`  ${icon} ${typeColor}${type.padEnd(10)}${colors.reset} ${count}`);
        });
    }

    if (Object.keys(stats.byAgent).length > 0) {
      console.log(`\n${colors.bright}By Agent:${colors.reset}`);
      Object.entries(stats.byAgent)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10) // Top 10
        .forEach(([agent, count]) => {
          console.log(`  ${agent.padEnd(30)} ${count}`);
        });
    }

    console.log();
  } catch (error) {
    console.error(`${colors.red}Error getting stats: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Send test event
 */
async function eventsSend(agent, type, content) {
  try {
    if (!agent || !type || !content) {
      console.error(`${colors.red}Usage: tx events send --agent <agent-id> --type <type> --content <content>${colors.reset}`);
      process.exit(1);
    }

    const success = EventPublisher.publish(agent, type, content);

    if (success) {
      console.log(`${colors.green}✓${colors.reset} Event sent to ${colors.cyan}${agent}${colors.reset}\n`);
    } else {
      console.log(`${colors.red}✗${colors.reset} Failed to send event\n`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`${colors.red}Error sending event: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Clear event log
 */
async function eventsClear(options = {}) {
  if (!options.confirm) {
    console.log(`${colors.yellow}⚠${colors.reset} Use --confirm to clear event log\n`);
    return;
  }

  try {
    EventLogger.clear();
    console.log(`${colors.green}✓${colors.reset} Event log cleared\n`);
  } catch (error) {
    console.error(`${colors.red}Error clearing log: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Get event icon
 */
function getEventIcon(eventType) {
  const icons = {
    nudge: '🔔',
    reminder: '⏰',
    error: '❌',
    status: 'ℹ️'
  };
  return icons[eventType] || '📢';
}

/**
 * Get event color
 */
function getEventColor(eventType) {
  const eventColors = {
    nudge: colors.yellow,
    reminder: colors.blue,
    error: colors.red,
    status: colors.green
  };
  return eventColors[eventType] || colors.reset;
}

/**
 * Main events command
 */
async function events(argv) {
  const args = argv.slice(3); // Remove node, script, command

  // Parse command
  const command = args[0];

  if (command === 'stats') {
    return eventsStats();
  }

  if (command === 'send') {
    const agent = getArg(args, '--agent');
    const type = getArg(args, '--type');
    const content = getArg(args, '--content');
    return eventsSend(agent, type, content);
  }

  if (command === 'clear') {
    const confirm = hasFlag(args, '--confirm');
    return eventsClear({ confirm });
  }

  // Default: view events
  const options = {
    agent: getArg(args, '--agent'),
    type: getArg(args, '--type'),
    since: getArg(args, '--since'),
    limit: parseInt(getArg(args, '--limit') || '50'),
    verbose: hasFlag(args, '-v') || hasFlag(args, '--verbose')
  };

  return eventsView(options);
}

/**
 * Get argument value
 */
function getArg(args, flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return null;
}

/**
 * Check if flag exists
 */
function hasFlag(args, flag) {
  return args.includes(flag);
}

module.exports = { events };

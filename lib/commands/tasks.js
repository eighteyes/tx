/**
 * Tasks command - Show task registry information
 */

const TaskRegistry = require('../task-registry');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  bold: '\x1b[1m'
};

const chalk = {
  red: (text) => `${colors.red}${text}${colors.reset}`,
  yellow: (text) => `${colors.yellow}${text}${colors.reset}`,
  green: (text) => `${colors.green}${text}${colors.reset}`,
  cyan: (text) => `${colors.cyan}${text}${colors.reset}`,
  gray: (text) => `${colors.gray}${text}${colors.reset}`,
  white: (text) => `${colors.white}${text}${colors.reset}`,
  bold: (text) => `${colors.bold}${text}${colors.reset}`
};

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getPriorityIcon(priority) {
  switch (priority) {
    case 'critical': return '🔴';
    case 'high': return '🟡';
    case 'normal': return '🟢';
    case 'low': return '⚪';
    default: return '';
  }
}

function getStatusIcon(status) {
  switch (status) {
    case 'pending': return '⏳';
    case 'assigned': return '📋';
    case 'in-progress': return '🔨';
    case 'completed': return '✅';
    case 'failed': return '❌';
    default: return '';
  }
}

async function tasks(options = {}) {
  const stats = TaskRegistry.getStats();

  console.log(chalk.bold('\n📋 Task Registry\n'));

  // Summary
  console.log(chalk.bold('Summary:'));
  console.log(`  Total: ${stats.total}`);
  console.log(`  Pending: ${chalk.yellow(stats.byStatus.pending)}`);
  console.log(`  Assigned: ${chalk.cyan(stats.byStatus.assigned)}`);
  console.log(`  In Progress: ${chalk.cyan(stats.byStatus['in-progress'])}`);
  console.log(`  Completed: ${chalk.green(stats.byStatus.completed)}`);
  console.log(`  Failed: ${chalk.red(stats.byStatus.failed)}`);

  if (stats.orphaned > 0) {
    console.log(chalk.yellow(`  ⚠️  Orphaned: ${stats.orphaned}`));
  }

  // Show pending tasks if any
  if (options.pending || stats.byStatus.pending > 0) {
    console.log(chalk.bold('\n⏳ Pending Tasks:'));
    const pending = TaskRegistry.getPending(20);

    if (pending.length === 0) {
      console.log(chalk.gray('  No pending tasks'));
    } else {
      for (const task of pending) {
        const icon = getPriorityIcon(task.priority);
        const age = formatDuration(Date.now() - new Date(task.createdAt).getTime());
        console.log(`  ${icon} ${task.summary}`);
        console.log(chalk.gray(`     Created by ${task.createdBy} • ${age} ago`));
      }
    }
  }

  // Show in-progress tasks
  const inProgress = stats.byStatus['in-progress'];
  if (inProgress > 0) {
    console.log(chalk.bold('\n🔨 In Progress:'));

    const db = require('../state-db').init();
    const tasks = db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'in-progress'
      ORDER BY started_at DESC
      LIMIT 20
    `).all();

    for (const task of tasks) {
      const icon = getPriorityIcon(task.priority);
      const duration = task.started_at
        ? formatDuration(Date.now() - task.started_at)
        : 'unknown';
      console.log(`  ${icon} ${task.summary}`);
      console.log(chalk.gray(`     Agent: ${task.assigned_to} • Duration: ${duration}`));
    }
  }

  // Show orphaned tasks
  if (stats.orphaned > 0) {
    console.log(chalk.bold(chalk.yellow('\n⚠️  Orphaned Tasks:')));
    const orphaned = TaskRegistry.findOrphanedTasks();

    for (const task of orphaned) {
      const icon = getPriorityIcon(task.priority);
      console.log(`  ${icon} ${task.summary}`);
      console.log(chalk.gray(`     Was assigned to: ${task.assignedTo} (${task.status})`));
    }
  }

  console.log('');
}

module.exports = { tasks };

const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const { Logger } = require('../logger');

/**
 * Clear TX operational data
 * Removes messages, logs, and state files
 * Preserves mesh workspaces
 */
async function clear(options = {}) {
  const txDir = path.join(process.cwd(), '.ai/tx');
  const msgsDir = path.join(txDir, 'msgs');
  const logsDir = path.join(txDir, 'logs');
  const stateDir = path.join(txDir, 'state');

  // Check if TX directory exists
  if (!fs.existsSync(txDir)) {
    console.log('✅ Nothing to clear - .ai/tx/ directory does not exist');
    return;
  }

  // Count what will be deleted
  const messages = fs.existsSync(msgsDir) ? fs.readdirSync(msgsDir).length : 0;
  const logs = fs.existsSync(logsDir) ? fs.readdirSync(logsDir).length : 0;
  const states = fs.existsSync(stateDir) ? fs.readdirSync(stateDir).length : 0;

  console.log('\n⚠️  WARNING: This will permanently delete:');
  console.log(`   - All messages in queue (${messages} files)`);
  console.log(`   - All logs (${logs} files)`);
  console.log(`   - All state files (${states} files)`);
  console.log('\n   Mesh workspaces will be preserved\n');

  // Skip confirmation if --force flag
  if (options.force) {
    console.log('🔥 Force flag detected - clearing without confirmation...\n');
    await performClear({ msgsDir, logsDir, stateDir });
    return;
  }

  // Prompt for confirmation
  const confirmed = await confirm('Are you sure you want to clear TX operational data? (yes/no): ');

  if (!confirmed) {
    console.log('❌ Clear cancelled');
    return;
  }

  await performClear({ msgsDir, logsDir, stateDir });
}

/**
 * Perform the actual clear operation
 */
async function performClear({ msgsDir, logsDir, stateDir }) {
  try {
    console.log('🗑️  Clearing TX operational data...');

    // Empty each directory but keep them
    const dirs = [
      { path: msgsDir, name: 'messages' },
      { path: logsDir, name: 'logs' },
      { path: stateDir, name: 'state files' }
    ];

    for (const dir of dirs) {
      if (fs.existsSync(dir.path)) {
        fs.emptyDirSync(dir.path);
        console.log(`   ✓ Cleared ${dir.name}`);
      }
    }

    console.log('✅ Successfully cleared TX operational data');
    Logger.log('clear', 'TX operational data cleared', {
      directories: [msgsDir, logsDir, stateDir]
    });
  } catch (error) {
    console.error(`❌ Error clearing TX data: ${error.message}`);
    Logger.error('clear', `Failed to clear TX data: ${error.message}`, {
      error: error.stack
    });
    process.exit(1);
  }
}

/**
 * Prompt user for yes/no confirmation
 */
function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'yes' || normalized === 'y');
    });
  });
}

module.exports = { clear };

const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const { Logger } = require('../logger');

/**
 * Clear all TX orchestration data
 * Removes everything in .ai/tx/ directory
 */
async function clear(options = {}) {
  const txDir = path.join(process.cwd(), '.ai/tx');

  // Check if directory exists
  if (!fs.existsSync(txDir)) {
    console.log('✅ Nothing to clear - .ai/tx/ directory does not exist');
    return;
  }

  // Count what will be deleted
  const meshes = fs.existsSync(path.join(txDir, 'mesh'))
    ? fs.readdirSync(path.join(txDir, 'mesh')).length
    : 0;
  const logs = fs.existsSync(path.join(txDir, 'logs'))
    ? fs.readdirSync(path.join(txDir, 'logs')).length
    : 0;

  console.log('\n⚠️  WARNING: This will permanently delete:');
  console.log(`   - All mesh data (${meshes} meshes)`);
  console.log(`   - All logs (${logs} files)`);
  console.log(`   - All state files`);
  console.log(`   - All agent workspaces and messages`);
  console.log(`\n   Directory: ${txDir}\n`);

  // Skip confirmation if --force flag
  if (options.force) {
    console.log('🔥 Force flag detected - clearing without confirmation...\n');
    await performClear(txDir);
    return;
  }

  // Prompt for confirmation
  const confirmed = await confirm('Are you sure you want to clear all TX data? (yes/no): ');

  if (!confirmed) {
    console.log('❌ Clear cancelled');
    return;
  }

  await performClear(txDir);
}

/**
 * Perform the actual clear operation
 */
async function performClear(txDir) {
  try {
    console.log('🗑️  Clearing .ai/tx/ directory...');

    // Remove the entire directory
    fs.removeSync(txDir);

    console.log('✅ Successfully cleared all TX orchestration data');
    Logger.log('clear', 'TX data cleared', { directory: txDir });
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

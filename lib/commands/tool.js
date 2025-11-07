const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { Notifier } = require('../notifier');

/**
 * Execute external tool commands
 * Currently supports: know (knowledge graph manager)
 */
async function tool(toolName, args = []) {
  if (!toolName) {
    console.error('Usage: tx tool <name> [args...]');
    console.error('Available tools:');
    console.error('  know   - Knowledge graph manager for spec graphs');
    console.error('  notify - Send system notification');
    process.exit(1);
  }

  switch (toolName.toLowerCase()) {
    case 'know':
      return executeKnow(args);
    case 'notify':
      return executeNotify(args);
    default:
      console.error(`Unknown tool: ${toolName}`);
      console.error('Available tools: know, notify');
      process.exit(1);
  }
}

/**
 * Execute know CLI via npm binary resolution
 * Uses know-cli package from npm
 */
function executeKnow(args) {
  let knowPath;

  try {
    // Try to resolve know binary from node_modules
    const knowPackage = require.resolve('know-cli/package.json');
    const knowDir = path.dirname(knowPackage);
    knowPath = path.join(knowDir, 'bin', 'know.js');

    if (!fs.existsSync(knowPath)) {
      throw new Error('Binary not found in package');
    }
  } catch (err) {
    // Fallback: try multiple possible paths (for Docker/symlink scenarios)
    const fallbackPaths = [
      path.join(process.cwd(), 'node_modules', 'know-cli', 'bin', 'know.js'),
      path.join(__dirname, '..', '..', 'node_modules', 'know-cli', 'bin', 'know.js'),
      path.join(__dirname, '..', '..', '..', 'know-cli', 'bin', 'know.js'),
      path.join(__dirname, '..', '..', '..', 'know-cli', 'know', 'know') // Python script directly
    ];

    for (const fallbackPath of fallbackPaths) {
      if (fs.existsSync(fallbackPath)) {
        knowPath = fallbackPath;
        break;
      }
    }

    if (!knowPath) {
      console.error('Error: know-cli package not found');
      console.error('Run: npm install');
      console.error(`Details: ${err.message}`);
      console.error('\nTried paths:');
      fallbackPaths.forEach(p => {
        const exists = fs.existsSync(p);
        console.error(`  ${exists ? '✓' : '✗'} ${p}`);
      });
      console.error('\nDebugging info:');
      console.error(`  __dirname: ${__dirname}`);
      console.error(`  process.cwd(): ${process.cwd()}`);

      // Check what's actually available
      const knowCliCheck = path.join(__dirname, '..', '..', '..', 'know-cli');
      console.error(`\nChecking ${knowCliCheck}:`);
      if (fs.existsSync(knowCliCheck)) {
        const contents = fs.readdirSync(knowCliCheck);
        console.error(`  Contents: ${contents.join(', ')}`);
      } else {
        console.error(`  Does not exist`);
      }

      // Check /workspace
      console.error(`\nChecking /workspace:`);
      if (fs.existsSync('/workspace')) {
        const contents = fs.readdirSync('/workspace');
        console.error(`  Contents: ${contents.join(', ')}`);
      } else {
        console.error(`  Does not exist`);
      }

      process.exit(1);
    }
  }

  // Spawn know (with node for .js files, directly for Python scripts)
  const isJsFile = knowPath.endsWith('.js');
  const command = isJsFile ? 'node' : knowPath;
  const commandArgs = isJsFile ? [knowPath, ...args] : args;

  const child = spawn(command, commandArgs, {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        process.exit(code || 1);
      }
    });

    child.on('error', (err) => {
      console.error(`Failed to execute know: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Execute notify tool
 * Send system notification with optional title, message, and priority
 *
 * Usage:
 *   tx tool notify "title" "message" [priority]
 *   tx tool notify "title" "message"
 *   tx tool notify "message"
 *
 * Priority: low, medium, high (default: medium)
 */
async function executeNotify(args) {
  if (args.length === 0) {
    console.error('Usage: tx tool notify <title> [message] [priority]');
    console.error('');
    console.error('Examples:');
    console.error('  tx tool notify "Task Complete" "Analysis finished" "high"');
    console.error('  tx tool notify "Task Complete" "Analysis finished"');
    console.error('  tx tool notify "Quick notification"');
    console.error('');
    console.error('Priority levels: low, medium, high (default: medium)');
    process.exit(1);
  }

  let title, message, priority;

  if (args.length === 1) {
    // Single argument - use as message with default title
    title = 'TX Notification';
    message = args[0];
    priority = 'medium';
  } else if (args.length === 2) {
    // Two arguments - title and message
    title = args[0];
    message = args[1];
    priority = 'medium';
  } else {
    // Three or more arguments - title, message, priority
    title = args[0];
    message = args[1];
    priority = args[2] || 'medium';
  }

  // Validate priority
  const validPriorities = ['low', 'medium', 'high'];
  if (!validPriorities.includes(priority.toLowerCase())) {
    console.error(`Invalid priority: ${priority}`);
    console.error(`Valid priorities: ${validPriorities.join(', ')}`);
    process.exit(1);
  }

  try {
    console.log(`Sending notification: ${title}`);
    await Notifier.send(title, message, { priority: priority.toLowerCase() });
    console.log('Notification sent successfully');
  } catch (error) {
    console.error(`Failed to send notification: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { tool };

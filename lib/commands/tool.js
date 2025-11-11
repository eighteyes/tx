const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { Notifier } = require('../notifier');

/**
 * Execute external tool commands
 * Currently supports: know (knowledge graph manager), worktree, merge
 */
async function tool(toolName, args = []) {
  if (!toolName) {
    console.error('Usage: tx tool <name> [args...]');
    console.error('Available tools:');
    console.error('  know     - Knowledge graph manager for spec graphs');
    console.error('  notify   - Send system notification');
    console.error('  worktree - Git worktree management (add, list, remove, prune)');
    console.error('  merge    - Git merge operations (start, status, conflicts, resolve, abort)');
    process.exit(1);
  }

  switch (toolName.toLowerCase()) {
    case 'know':
      return executeKnow(args);
    case 'notify':
      return executeNotify(args);
    case 'worktree':
      return executeWorktree(args);
    case 'merge':
      return executeMerge(args);
    default:
      console.error(`Unknown tool: ${toolName}`);
      console.error('Available tools: know, notify, worktree, merge');
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

/**
 * Execute worktree operations
 * Usage:
 *   tx tool worktree add <branch> [--base=branch] [--log] [--from=agent] [--to=agent]
 *   tx tool worktree list [--json]
 *   tx tool worktree remove <branch> [--log]
 *   tx tool worktree prune [--log]
 */
async function executeWorktree(args) {
  const { Worktree } = require('../git/worktree');
  const { GitEventLogger } = require('../git/event-logger');

  if (args.length === 0) {
    console.error('Usage: tx tool worktree <command> [args...]');
    console.error('');
    console.error('Commands:');
    console.error('  add <branch> [--base=branch] [--log]  - Create new worktree');
    console.error('  list [--json]                         - List worktrees');
    console.error('  remove <branch> [--log]               - Remove worktree');
    console.error('  prune [--log]                         - Clean up stale worktrees');
    console.error('');
    console.error('Options:');
    console.error('  --log         - Log operation to event log');
    console.error('  --from=agent  - Set from agent for event log');
    console.error('  --to=agent    - Set to agent for event log');
    process.exit(1);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  // Parse logging options
  let shouldLog = false;
  let fromAgent = 'user';
  let toAgent = 'user';

  for (const arg of args) {
    if (arg === '--log') shouldLog = true;
    if (arg.startsWith('--from=')) fromAgent = arg.split('=')[1];
    if (arg.startsWith('--to=')) toAgent = arg.split('=')[1];
  }

  try {
    const result = await Worktree.execute(command, commandArgs);

    // Log to event log if requested
    if (shouldLog) {
      GitEventLogger.logWorktreeOperation(command, result, { from: fromAgent, to: toAgent });
    }

    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(`Worktree error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Execute merge operations
 * Usage:
 *   tx tool merge start <branch> [--log] [--from=agent] [--to=agent]
 *   tx tool merge status [--json] [--log]
 *   tx tool merge conflicts [--json] [--log]
 *   tx tool merge resolve <file> [--strategy=ours|theirs|ai] [--log]
 *   tx tool merge abort [--log]
 */
async function executeMerge(args) {
  const { Merge } = require('../git/merge');
  const { GitEventLogger } = require('../git/event-logger');
  const { ConflictResolver } = require('../git/conflict-resolver');

  if (args.length === 0) {
    console.error('Usage: tx tool merge <command> [args...]');
    console.error('');
    console.error('Commands:');
    console.error('  start <branch> [--log]                - Start merge operation');
    console.error('  status [--json] [--log]               - Show merge status');
    console.error('  conflicts [--json] [--log]            - List conflicts');
    console.error('  resolve <file> [--strategy=strategy]  - Resolve conflict (ours|theirs|ai)');
    console.error('  abort [--log]                         - Abort merge');
    console.error('');
    console.error('Options:');
    console.error('  --log         - Log operation to event log');
    console.error('  --from=agent  - Set from agent for event log');
    console.error('  --to=agent    - Set to agent for event log');
    process.exit(1);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  // Parse logging options
  let shouldLog = false;
  let fromAgent = 'user';
  let toAgent = 'user';

  for (const arg of args) {
    if (arg === '--log') shouldLog = true;
    if (arg.startsWith('--from=')) fromAgent = arg.split('=')[1];
    if (arg.startsWith('--to=')) toAgent = arg.split('=')[1];
  }

  try {
    const result = await Merge.execute(command, commandArgs);

    // Log to event log if requested
    if (shouldLog) {
      GitEventLogger.logMergeOperation(command, result, { from: fromAgent, to: toAgent });

      // For AI-assisted resolution, also log conflict analysis
      if (command === 'resolve' && result.strategy === 'ai' && result.analysis) {
        GitEventLogger.logConflictAnalysis(result.file, result.analysis, {
          from: fromAgent,
          to: toAgent
        });
      }
    }

    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(`Merge error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { tool };

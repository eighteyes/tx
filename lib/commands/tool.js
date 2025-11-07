const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

/**
 * Execute external tool commands
 * Currently supports: know (knowledge graph manager)
 */
async function tool(toolName, args = []) {
  if (!toolName) {
    console.error('Usage: tx tool <name> [args...]');
    console.error('Available tools:');
    console.error('  know - Knowledge graph manager for spec graphs');
    process.exit(1);
  }

  switch (toolName.toLowerCase()) {
    case 'know':
      return executeKnow(args);
    default:
      console.error(`Unknown tool: ${toolName}`);
      console.error('Available tools: know');
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

module.exports = { tool };

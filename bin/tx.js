#!/usr/bin/env node

const { program } = require('commander');
const { start } = require('../lib/commands/start');
const { spawn } = require('../lib/commands/spawn');
const { attach } = require('../lib/commands/attach');
const { kill } = require('../lib/commands/kill');
const { status } = require('../lib/commands/status');
const { stop } = require('../lib/commands/stop');
const { prompt } = require('../lib/commands/prompt');
const { Logger } = require('../lib/logger');

// Initialize logger
Logger.init();

program.name('tx').description('TX Watch - Claude agent orchestration').version('2.0.0');

// tx start
program
  .command('start')
  .option('-d, --detach', 'Run in detached mode (don\'t attach to core)')
  .description('Start TX Watch system and spawn core mesh')
  .action(async (options) => {
    await start({ detach: options.detach });
  });

// tx spawn <mesh> [agent]
program
  .command('spawn <mesh> [agent]')
  .option('-i, --init <task>', 'Initial task to send')
  .option('-m, --model <model>', 'Model to use (default: claude-opus)')
  .description('Spawn a new agent in a mesh')
  .action(async (mesh, agent, options) => {
    await spawn(mesh, agent, {
      init: options.init,
      model: options.model
    });
  });

// tx attach
program
  .command('attach')
  .description('Attach to active tmux session')
  .action(() => {
    attach();
  });

// tx kill <mesh> [agent]
program
  .command('kill <mesh> [agent]')
  .description('Kill a mesh or agent session')
  .action((mesh, agent) => {
    kill(mesh, agent);
  });

// tx status
program
  .command('status')
  .description('Show TX Watch status and queue info')
  .action(() => {
    status();
  });

// tx stop
program
  .command('stop')
  .description('Stop TX Watch and kill all sessions')
  .action(async () => {
    await stop();
  });

// tx prompt <mesh> [agent]
program
  .command('prompt <mesh> [agent]')
  .description('Display generated prompt for a mesh/agent')
  .action((mesh, agent) => {
    prompt(mesh, agent);
  });

// tx tool <name> [args...]
program
  .command('tool <name> [args...]')
  .description('Run a capability/tool')
  .action((name, args) => {
    handleTool(name, args);
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command
if (process.argv.length < 3) {
  program.outputHelp();
}

/**
 * Handle tool/capability commands
 */
async function handleTool(name, args) {
  try {
    switch (name) {
      case 'search':
        const { Search } = require('../lib/tools/search');
        if (args.length === 0) {
          console.error('❌ Usage: tx tool search "query"');
          process.exit(1);
        }
        const query = args.join(' ');
        const results = await Search.query(query);
        console.log(`\n📚 Search results for: "${query}"\n`);
        if (results.length === 0) {
          console.log('No results found');
        } else {
          results.forEach((r, i) => {
            console.log(`${i + 1}. ${r.title}`);
            console.log(`   URL: ${r.url}`);
            if (r.content) {
              console.log(`   ${r.content.substring(0, 80)}...`);
            }
            console.log();
          });
        }
        break;

      default:
        console.error(`❌ Unknown tool: ${name}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Tool error: ${error.message}`);
    process.exit(1);
  }
}

// Global error handler
process.on('uncaughtException', (error) => {
  Logger.error('cli', `Uncaught exception: ${error.message}`, {
    error: error.stack
  });
  console.error('❌ Error:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('cli', `Unhandled rejection: ${reason}`);
  console.error('❌ Error:', reason);
  process.exit(1);
});

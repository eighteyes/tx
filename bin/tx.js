#!/usr/bin/env node

const { program } = require('commander');
const { start } = require('../lib/commands/start');
const { spawn } = require('../lib/commands/spawn');
const { attach } = require('../lib/commands/attach');
const { status } = require('../lib/commands/status');
const { stop } = require('../lib/commands/stop');
const { prompt } = require('../lib/commands/prompt');
const { logs } = require('../lib/commands/logs');
const { list } = require('../lib/commands/list');
const { clear } = require('../lib/commands/clear');
const { watch } = require('../lib/commands/watch');
const { dashboard, stopDashboard } = require('../lib/commands/dashboard');
const { msg } = require('../lib/commands/msg');
const { session } = require('../lib/commands/session');
const { stats } = require('../lib/commands/stats');
const { health } = require('../lib/commands/health');
const { reset } = require('../lib/commands/reset');
const { Logger } = require('../lib/logger');

// Initialize logger
Logger.init();

program.name('tx').description('TX - Claude agent orchestration').version('2.0.0');

// tx start
program
  .command('start')
  .option('-d, --detach', 'Run in detached mode (don\'t attach to core)')
  .description('Start agent orchestration system and spawn core mesh')
  .action(async (options) => {
    await start({ detach: options.detach });
  });

// tx spawn <mesh> [agent]
program
  .command('spawn <mesh> [agent]')
  .option('-i, --init <task>', 'Initial task to send')
  .option('--id <summary>', 'Generate mesh ID from task summary (first letters of 4-8 words)')
  .option('-m, --model <model>', 'Model to use (default: sonnet)')
  .description('Spawn a new agent in a mesh')
  .action(async (mesh, agent, options) => {
    await spawn(mesh, agent, {
      init: options.init,
      id: options.id,
      model: options.model
    });
  });

// tx watch <file> --mesh <mesh>
program
  .command('watch <file>')
  .option('--mesh <mesh>', 'Mesh to process file changes')
  .option('-d, --detach', 'Run in background (detached mode)')
  .description('Watch a file and process changes through a mesh')
  .action(async (file, options) => {
    if (!options.mesh) {
      console.error('❌ --mesh option is required');
      console.error('   Usage: tx watch <file> --mesh <mesh-name> [-d]');
      process.exit(1);
    }
    await watch(file, options.mesh, { detach: options.detach });
  });

// tx attach
program
  .command('attach')
  .description('Attach to active tmux session')
  .action(() => {
    attach();
  });

// tx dashboard
program
  .command('dashboard')
  .option('--no-attach', 'Don\'t auto-attach to dashboard after creation')
  .option('-w, --watch', 'Enable auto-refresh watcher (experimental)')
  .description('Interactive mesh selector - view agents from a specific mesh (excludes core)')
  .action(async (options) => {
    await dashboard(options);
  });

// tx status
program
  .command('status')
  .option('-p, --prompt', 'Generate prompt-ready status summary')
  .description('Show orchestration system status and queue info')
  .action((options) => {
    status({ prompt: options.prompt });
  });

// tx stop [mesh] [agent]
program
  .command('stop [mesh] [agent]')
  .description('Stop orchestration system, mesh, or specific agent')
  .action(async (mesh, agent) => {
    await stop(mesh, agent);
  });

// tx prompt <mesh> [agent]
program
  .command('prompt <mesh> [agent]')
  .description('Display generated prompt for a mesh/agent')
  .action((mesh, agent) => {
    prompt(mesh, agent);
  });

// tx logs
program
  .command('logs')
  .option('-n, --lines <n>', 'Number of log lines to display (default: 50)')
  .option('-c, --component <component>', 'Filter by component name (non-interactive mode only)')
  .option('-l, --level <level>', 'Filter by log level (non-interactive mode only)')
  .option('--no-interactive', 'Disable interactive mode (use static view with follow)')
  .option('--no-follow', 'Disable follow mode (non-interactive mode only)')
  .description('Display orchestration system logs with interactive filters (default: interactive mode)')
  .action((options) => {
    logs(options);
  });

// tx msg
program
  .command('msg')
  .option('--limit <n>', 'Number of messages to display (default: 50)')
  .option('--follow', 'Start with follow mode enabled in interactive viewer')
  .option('--type <type>', 'Filter by message type (task, ask, delta, etc.)')
  .option('--agent <agent>', 'Filter by agent (matches from or to)')
  .option('--mesh <mesh>', 'Filter by mesh')
  .option('--errors', 'Show only error messages')
  .option('--since <time>', 'Messages since time (e.g., "1h", "30m", "2025-11-03")')
  .option('--before <time>', 'Messages before time')
  .option('--json', 'Output as JSON')
  .option('--no-interactive', 'Disable interactive mode (simple list)')
  .option('-v, --verbose', 'Show message content preview (non-interactive mode only)')
  .description('Interactive event log viewer (↑↓ navigate, Enter view, a attach to agent, f toggle follow, q quit)')
  .action((options) => {
    msg(options);
  });

// tx session
program
  .command('session [mesh] [agent]')
  .option('--list', 'List all sessions')
  .option('--latest', 'Show latest session (default: true)', true)
  .option('--mesh <mesh>', 'Filter by mesh')
  .option('--agent <agent>', 'Filter by agent')
  .option('--today', 'Show only today\'s sessions')
  .option('--since <date>', 'Sessions since date')
  .description('View captured session output')
  .action((mesh, agent, options) => {
    const args = mesh ? (agent ? [mesh, agent] : [mesh]) : [];
    if (options.list) {
      args.splice(0, 0, 'list');
    }
    session(args, options);
  });

// tx stats
program
  .command('stats')
  .option('--mesh <mesh>', 'Filter by mesh')
  .option('--agent <agent>', 'Filter by agent')
  .option('--since <date>', 'Stats since date')
  .option('--json', 'Output as JSON')
  .description('Display event log statistics')
  .action((options) => {
    stats(options);
  });

// tx health
program
  .command('health')
  .option('--watch', 'Watch mode (refresh periodically)')
  .option('--interval <seconds>', 'Refresh interval for watch mode (default: 5)')
  .option('--json', 'Output as JSON')
  .description('Display system health status')
  .action((options) => {
    health(options);
  });

// tx list <type>
program
  .command('list <type>')
  .option('-p, --prompt', 'Generate prompt-ready output for template injection')
  .description('List meshes, agents, or capabilities (types: meshes, agents, caps)')
  .action((type, options) => {
    list(type, { prompt: options.prompt });
  });

// tx clear
program
  .command('clear')
  .option('-f, --force', 'Skip confirmation prompt')
  .description('Clear all TX orchestration data (.ai/tx/ directory)')
  .action(async (options) => {
    await clear({ force: options.force });
  });

// tx reset <mesh> [agent]
program
  .command('reset <mesh> [agent]')
  .description('Clear agent session and re-inject original prompt. If no agent specified, resets all agents in mesh.')
  .action(async (mesh, agent) => {
    await reset(mesh, agent);
  });

// tx tool <name> [args...]
program
  .command('tool <name> [args...]')
  .option('-s, --source <source>', 'Search specific source(s) (can be used multiple times)')
  .option('-t, --topic <topic>', 'Search topic area (dev, docs, info, news, packages, repos, science, files, media)')
  .option('--js', 'Enable JavaScript rendering (for get-www tool)')
  .option('-a, --archive', 'Use archive services only (archive.is, archive.org, etc.)')
  .allowUnknownOption()
  .description('Run a capability/tool (search, get-www, know, notify)')
  .action((name, args, options) => {
    handleTool(name, args, options);
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
async function handleTool(name, args, options = {}) {
  try {
    switch (name) {
      case 'search':
        const { Search } = require('../lib/tools/search');
        if (args.length === 0) {
          console.error('❌ Usage: tx tool search [options] "query"');
          console.error('   Options:');
          console.error('     -s <source> - Search specific source(s) (can use multiple times)');
          console.error('     -t <topic>  - Search topic area (dev, docs, info, news, packages, repos, science, files, media)');
          process.exit(1);
        }

        const query = args.join(' ');
        if (!query.trim()) {
          console.error('❌ Usage: tx tool search [options] "query"');
          process.exit(1);
        }

        // Map topic to SearXNG categories using ! prefix
        const topicMap = {
          'dev': '!it',
          'docs': '!it',
          'info': '!general',
          'news': '!news',
          'packages': '!it',
          'repos': '!it',
          'science': '!science',
          'files': '!general',
          'media': '!general'
        };

        const categories = options.topic ? [topicMap[options.topic] || '!general'] : undefined;

        // Let Search handle the options
        const results = await Search.query(query, options.source, categories);

        const sourceLabel = options.source ?
          ` (${Array.isArray(options.source) ? options.source.join(', ') : options.source})` : '';
        const topicLabel = options.topic ? ` [${options.topic}]` : '';
        console.log(`\n📚 Search results for: "${query}"${sourceLabel}${topicLabel}\n`);
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

      case 'get-www':
        const { GetWWW } = require('../lib/tools/get-www');
        if (args.length === 0) {
          console.error('❌ Usage: tx tool get-www [-js] [-a] <url> [url2] [url3] ...');
          process.exit(1);
        }
        const urls = args;
        const wwwResults = await GetWWW.fetch(urls, {
          js: options.js,
          archive: options.archive
        });
        console.log(JSON.stringify(wwwResults, null, 2));
        break;

      case 'know':
        const { tool } = require('../lib/commands/tool');
        await tool('know', args);
        break;

      case 'notify':
        const { tool: toolCmd } = require('../lib/commands/tool');
        await toolCmd('notify', args);
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

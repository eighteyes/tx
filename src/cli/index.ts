#!/usr/bin/env node
/**
 * TX V4 CLI
 */

import dotenv from 'dotenv';
import { start, stop } from './start.ts';
import { status, printStatus } from './status.ts';
import { msg } from './msg.ts';
import { logs } from './logs.ts';
import { spy } from './spy.ts';
import { tasks } from './tasks.ts';
import { prompt } from './prompt.ts';
import { tool } from './tool.ts';
import { run } from './run.ts';
import { validateMesh } from './validate-mesh.ts';
import { log } from '../shared/logger.ts';

// Load environment variables from .env file (suppress dotenv promo spam)
dotenv.config({ quiet: true });

// Initialize logger with correct work directory early (before error handlers)
const workDir = process.env.TX_CWD || process.cwd();
log.init(workDir, 'debug');

// Ignore EPIPE on stdout (happens when tmux detaches or terminal closes)
process.stdout.on('error', (err: any) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

// Global exception handlers
process.on('uncaughtException', (error: Error) => {
  log.error('process', 'Uncaught exception', {
    error: error.message,
    stack: error.stack,
    name: error.name
  });
  console.error('\n[FATAL] Uncaught exception:', error.message);
  console.error('See logs for details: .ai/tx/logs/v4.jsonl\n');
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const errorMsg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;

  log.error('process', 'Unhandled promise rejection', {
    error: errorMsg,
    stack
  });
  // Don't exit - log the error and continue running
  // FSM state mismatches and other recoverable errors shouldn't kill the process
  console.error('\n[ERROR] Unhandled promise rejection:', errorMsg);
  console.error('Process continues. See logs: .ai/tx/logs/v4.jsonl\n');
});

const command = process.argv[2];
const args = process.argv.slice(3);

// Parse simple flags
function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.startsWith('no-')) {
        flags[toCamelCase(key)] = true;
      } else if (args[i + 1] && !args[i + 1].startsWith('-')) {
        flags[toCamelCase(key)] = args[++i];
      } else {
        flags[toCamelCase(key)] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Command help texts
const HELP = {
  main: `TX V4 - Multi-agent orchestration CLI

Commands:
  tx start          Start core agent (attaches to tmux)
  tx stop           Stop core agent
  tx status         Show system status
  tx run            Headless mesh REPL (no core)
  tx msg            View messages
  tx logs           View logs
  tx spy            Real-time activity stream
  tx tasks          View task queue
  tx prompt         Show built prompt for agent
  tx tool           Search and web utilities
  tx validate-mesh  Validate mesh configuration

Run 'tx <command> -h' for command-specific options.`,

  run: `tx run - Headless mesh REPL (no core agent)

Usage: tx run <mesh> <agent> [options] "<prompt>"

Arguments:
  mesh      Name of the mesh to use
  agent     Name of the agent in the mesh
  prompt    Initial prompt to send (quoted)

Options:
  --front key=value   Pass frontmatter to worker (repeatable)
                      e.g., --front feature=my-feature --front msg-id=123

Examples:
  tx run research sourcer "find papers on transformers"
  tx run dev worker "implement user auth"
  tx run dev-worktree worker --front feature=auth-system "build login page"

REPL Commands:
  /help, /?         Show available commands
  /agents           List agents in mesh
  /status           Show session status
  /quit             Exit session

Message Targeting:
  @agent-name msg   Send to specific agent
  message           Send to current agent`,

  start: `tx start - Start core agent

Usage: tx start [options]

Options:
  -c, --continue     Resume previous Claude session
  --model <model>    Model to use (e.g., opus, sonnet)
  --low              Use cost-effective models (replaces opus with sonnet)
  --ultra-low        Use ultra low cost mode (forces haiku for everything)`,

  msg: `tx msg - View messages

Usage: tx msg [options]

Options:
  -t, --type <type>     Filter by message type
  -a, --agent <agent>   Filter by agent
  -m, --mesh <mesh>     Filter by mesh
  -n, --limit <n>       Limit messages (default: 50)
  -f, --follow          Follow mode (real-time)
  --since <time>        Since time (e.g., "1h", "30m")
  --before <time>       Before time
  -v, --verbose         Show message previews
  -e, --errors          Show only errors
  -p, --show-prompts    Show injected prompts
  --json                JSON output
  --no-interactive      Disable interactive mode

Keys: Tab=switch tabs  ↑↓/jk=navigate  Enter=view  p=prompt  f=follow  q=quit`,

  logs: `tx logs - View logs

Usage: tx logs [options]

Options:
  -n, --lines <n>       Number of lines (default: 50)
  -c, --component <c>   Filter by component
  -l, --level <level>   Filter: info, warn, error, debug
  --last                View previous session logs
  --no-interactive      Disable interactive mode
  --no-follow           Disable follow mode

Keys: w=worker d=dispatch n=consumer u=queue o=core t=watcher
      1=info 2=warn 3=error 4=debug  a=clear  c=clear-logs  q=quit`,

  spy: `tx spy - Real-time activity stream

Usage: tx spy [options]

Options:
  -a, --agent <agent>   Filter by agent
  -m, --messages        Messages only (no SDK output)
  -o, --output          SDK output only (no messages)
  -f, --full            Show full output without truncation
  --json                JSON output`,

  tasks: `tx tasks - View task queue

Usage: tx tasks [options]

Options:
  -s, --status <s>      Filter: open, complete
  -a, --agent <agent>   Filter by agent
  -m, --mesh <mesh>     Filter by mesh
  -n, --limit <n>       Limit tasks (default: 50)
  --no-watch            Print once, no live updates
  --json                JSON output`,

  prompt: `tx prompt - Show built prompt for agent

Usage: tx prompt <mesh> <agent> [options]

Options:
  --with-task <msg-id>  Include task context
  --raw                 Raw output (no formatting)`,

  tool: `tx tool - Search and web utilities

Commands:
  tx tool search <query>            Search multiple sources
  tx tool get-www <url>             Fetch URL (archive fallback)
  tx tool youtube-transcript <id>   Fetch YouTube transcript
  tx tool health [provider]         Check provider health

Search options:
  -s, --source <src>    Source: stackoverflow, github, etc.
  -n, --limit <n>       Limit results (default: 10)
  --providers           List available providers
  --json                JSON output

get-www options:
  -a, --archive         Try archive.is/archive.org first

youtube-transcript options:
  -l, --lang <lang>     Language code (e.g., "en")
  -T, --timestamps      Include timestamps`,

  'validate-mesh': `tx validate-mesh - Validate mesh configuration

Usage: tx validate-mesh <mesh-name|path> [options]

Arguments:
  mesh-name     Name of mesh in meshes/ directory
  path          Direct path to config.yaml file

Options:
  --strict      Treat warnings as errors

Examples:
  tx validate-mesh mesh-builder
  tx validate-mesh meshes/dev/config.yaml
  tx validate-mesh my-mesh --strict

Validates:
  - Required fields (mesh, agents, entry_point)
  - Agent configuration (name, model, prompt)
  - Routing block structure and targets
  - FSM states and transitions (if present)
  - Config field types and values
  - Unknown/deprecated fields

Exit codes:
  0 - Valid configuration
  1 - Validation failed (errors or warnings in strict mode)`,
};

function showHelp(cmd: string): void {
  console.log(HELP[cmd as keyof typeof HELP] || HELP.main);
}

async function main() {
  const flags = parseFlags(args);
  const wantsHelp = Boolean(flags.h || flags.help);

  switch (command) {
    case 'start':
      if (wantsHelp) { showHelp('start'); break; }
      await start(undefined, {
        continue: Boolean(flags.c || flags.continue),
        model: flags.model as string | undefined,
        low: Boolean(flags.low),
        ultraLow: Boolean(flags.ultraLow)
      });
      break;

    case 'status':
      if (wantsHelp) { console.log('tx status - Show system status\n\nOptions:\n  --json    Output as JSON (for programmatic use)'); break; }
      const result = await status();
      printStatus(result, Boolean(flags.json));
      break;

    case 'run':
      if (wantsHelp) { showHelp('run'); break; }
      // Args: mesh agent "prompt" with optional --front key=value (repeatable)
      const nonFlagArgs = args.filter((a, i) => {
        // Skip args that are --front or values after --front
        if (a === '--front') return false;
        if (i > 0 && args[i-1] === '--front') return false;
        // Skip other flags and their values
        if (a.startsWith('-')) return false;
        if (i > 0 && args[i-1].startsWith('-') && args[i-1] !== '--front') return false;
        return true;
      });
      // Collect all --front values
      const frontArgs: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--front' && args[i+1]) {
          frontArgs.push(args[++i]);
        }
      }
      const meshArg = nonFlagArgs[0];
      const agentArg = nonFlagArgs[1];
      const promptArg = nonFlagArgs[2];
      await run({
        mesh: meshArg,
        agent: agentArg,
        prompt: promptArg,
        model: flags.model as string | undefined,
        front: frontArgs.length > 0 ? frontArgs : undefined,
      });
      break;

    case 'msg':
      if (wantsHelp) { showHelp('msg'); break; }
      await msg({
        type: flags.t as string || flags.type as string,
        agent: flags.a as string || flags.agent as string,
        mesh: flags.m as string || flags.mesh as string,
        since: flags.since as string,
        before: flags.before as string,
        limit: flags.n as string || flags.limit as string,
        json: Boolean(flags.json),
        interactive: !flags.noInteractive,
        verbose: Boolean(flags.v || flags.verbose),
        errors: Boolean(flags.e || flags.errors),
        showPrompts: Boolean(flags.p || flags.showPrompts)
      });
      break;

    case 'logs':
      if (wantsHelp) { showHelp('logs'); break; }
      await logs({
        lines: flags.n as string || flags.lines as string,
        component: flags.c as string || flags.component as string,
        level: flags.l as string || flags.level as string,
        follow: Boolean(flags.f || flags.follow),
        noInteractive: Boolean(flags.noInteractive),
        noFollow: Boolean(flags.noFollow),
        last: Boolean(flags.last)
      });
      break;

    case 'spy':
      if (wantsHelp) { showHelp('spy'); break; }
      await spy({
        messages: Boolean(flags.m || flags.messages),
        output: Boolean(flags.o || flags.output),
        agent: flags.a as string || flags.agent as string,
        json: Boolean(flags.json),
        full: Boolean(flags.f || flags.full)
      });
      break;

    case 'tasks':
      if (wantsHelp) { showHelp('tasks'); break; }
      await tasks({
        status: flags.s as string || flags.status as string,
        agent: flags.a as string || flags.agent as string,
        mesh: flags.m as string || flags.mesh as string,
        limit: flags.n as string || flags.limit as string,
        json: Boolean(flags.json),
        noWatch: Boolean(flags.noWatch)
      });
      break;

    case 'prompt':
      if (wantsHelp) { showHelp('prompt'); break; }
      await prompt({
        mesh: args[0],
        agent: args[1],
        withTask: flags.withTask as string,
        raw: Boolean(flags.raw)
      });
      break;

    case 'stop':
      if (wantsHelp) { console.log('tx stop - Stop core agent'); break; }
      await stop();
      break;

    case 'tool':
      if (wantsHelp || !args[0]) { showHelp('tool'); break; }
      const subcommand = args[0];
      const toolArgs = args.slice(1).filter(a => !a.startsWith('-'));
      await tool({
        subcommand,
        args: toolArgs,
        source: flags.s as string || flags.source as string,
        topic: flags.t as string || flags.topic as string,
        limit: flags.n as string || flags.limit as string,
        archive: Boolean(flags.a || flags.archive),
        json: Boolean(flags.json),
        lang: flags.l as string || flags.lang as string,
        timestamps: Boolean(flags.T || flags.timestamps),
        providers: Boolean(flags.providers)
      });
      break;

    case 'validate-mesh':
      if (wantsHelp || !args[0]) { showHelp('validate-mesh'); break; }
      await validateMesh(args[0], {
        strict: Boolean(flags.strict)
      });
      break;

    default:
      showHelp('main');
  }
}

main().catch((error) => {
  log.error('cli', 'Unhandled error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});

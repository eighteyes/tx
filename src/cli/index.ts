#!/usr/bin/env node
/**
 * TX V4 CLI
 */

import dotenv from 'dotenv';
import { start, stop, restart } from './start.ts';
import { status, printStatus } from './status.ts';
import { msg } from './msg.ts';
import { logs } from './logs.ts';
import { spy } from './spy.ts';
import { tasks } from './tasks.ts';
import { prompt } from './prompt.ts';
import { tool } from './tool.ts';
import { run } from './run.ts';
import { server } from './server.ts';
import { login } from './login.ts';
import { logout } from './logout.ts';
import { deploy } from './deploy.ts';
import { session } from './session.ts';
import { recover } from './recover.ts';
import { mesh } from './mesh.ts';
import { inbox } from './inbox.ts';
import { forensics } from './forensics.ts';
import { agentHelp } from './agent-help.ts';
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
  tx restart        Restart services (keeps Claude session)
  tx stop           Stop core agent
  tx status         Show system status
  tx recover        View and resume interrupted work from crashes
  tx server         Start HTTP/WebSocket server (multi-tenant)
  tx run            Headless mesh REPL (no core)
  tx msg            View messages
  tx logs           View logs
  tx spy            Real-time activity stream
  tx tasks          View task queue
  tx session        View and search agent sessions
  tx inbox          Show pending messages for core (unread file paths)
  tx mesh           Manage mesh state (list, status, kill, clear, validate)
  tx prompt         Show built prompt for agent
  tx tool           Search and web utilities
  tx forensics      Analyze mesh execution sessions
  tx agent-help      Agent-friendly reference (messages, parallel, routing, workflows, debugging)
  tx login          Authenticate with tx-server
  tx logout         Clear stored credentials
  tx deploy         Deploy mesh to Cloud Run

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
  --ultra-low        Use ultra low cost mode (forces haiku for everything)
  --debug            Enable forensics analysis for all meshes
  --inbox <mode>     Message delivery mode: hook (default), inject, ask
  --no-inject        Alias for --inbox ask (backward compat)`,

  restart: `tx restart - Restart backend services (keeps Claude session alive)

Usage: tx restart [options]

Stops running TX services via SIGTERM, then starts fresh services
and reattaches to the existing tmux/Claude session.

Options: Same as 'tx start' (--model, --low, --ultra-low, --debug, --inbox, etc.)

If no tmux session exists, behaves like 'tx start'.`,

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

  server: `tx server - Start HTTP/WebSocket server (multi-tenant)

Usage: tx server [options]

Options:
  -p, --port <port>     Port to listen on (default: 6000)
  -H, --host <host>     Host to bind to (default: 0.0.0.0)
  -m, --mesh <mesh>     Default mesh for sessions
  --no-db               Disable database (static serving + mesh CRUD only)

Environment:
  TX_STORAGE_TYPE       'local' or 'redis' (default: local)
  TX_REDIS_URL          Redis connection URL
  TX_REDIS_PREFIX       Redis key prefix (default: tx)
  TX_BASE_DIR           Base directory for local storage

Modes:
  Full mode (default):  Sessions, workers, storage, auth
  No-DB mode:           Static files + mesh management only

API Endpoints:
  POST   /v1/sessions              Create session
  GET    /v1/sessions/:id          Get session
  DELETE /v1/sessions/:id          Destroy session
  POST   /v1/sessions/:id/hibernate
  POST   /v1/sessions/:id/resume
  POST   /v1/sessions/:id/messages Send message
  GET    /v1/sessions/:id/messages List messages
  WS     /v1/sessions/:id/stream   Real-time stream

  GET    /v1/meshes                List all meshes (no-db compatible)
  GET    /v1/meshes/:name          Get mesh config (no-db compatible)
  PUT    /v1/meshes/:name          Update mesh (no-db compatible)
  POST   /v1/meshes/:name/validate Validate mesh (no-db compatible)`,

  login: `tx login - Authenticate with tx-server

Usage: tx login [options]

Options:
  --email <email>       Email address (prompts if not provided)
  --password <pass>     Password (prompts if not provided)
  --server <url>        tx-server URL (default: TX_SERVER_URL or https://api.tx.dev)

Examples:
  tx login
  tx login --email user@example.com
  tx login --server https://custom.tx.dev

Environment:
  TX_SERVER_URL         Default server URL
  TX_CREDENTIALS_PATH   Override credentials path (default: ~/.tx/credentials.json)

Credentials are saved with 0600 permissions for security.`,

  logout: `tx logout - Clear stored credentials

Usage: tx logout

Clears locally stored credentials and invalidates the refresh token
on the server (if reachable).

Example:
  tx logout`,

  deploy: `tx deploy - Deploy mesh to Cloud Run

Usage: tx deploy <mesh> [options]

Arguments:
  mesh          Name of mesh in meshes/ directory

Options:
  --region <region>     GCP region (default: us-central1)
  --version <version>   Version tag (auto-generated if not provided)

Examples:
  tx deploy research
  tx deploy my-mesh --region europe-west1
  tx deploy dev --version v1.2.0

Prerequisites:
  - Must be logged in (run "tx login" first)
  - Mesh must exist in meshes/ directory with config.yaml

The command packages your mesh, uploads it to tx-server, and waits
for the deployment to complete. On success, displays the service URL.`,

  session: `tx session - View and search agent sessions

Usage: tx session <mesh> <action> [selector] [options]

Actions:
  list                    List recent sessions
  get <selector>          Get specific session
  search <query>          Search sessions
  prune                   Clean old sessions

Selectors:
  3                       3rd most recent session
  3bad3                   Session ID containing "3bad3"

Options:
  --limit N               Limit results (default: 10)
  --since 7d              Filter by date
  --summary               Condensed summary (~200 tokens)
  --final-answer          Just the final output
  --full                  Complete transcript
  --split-summary         Intro + summarized latter half
  --json                  Output as JSON
  --older-than 365d       For prune: age threshold
  --dry-run               Preview without deleting

Examples:
  tx session brain list
  tx session brain get 3 --summary
  tx session brain search "auth flow"
  tx session brain prune --older-than 365d --dry-run`,

  recover: `tx recover - View and resume interrupted work from crashes

Usage: tx recover [action] [options]

Actions:
  (none)    Show recovery status (default)
  list      Detailed recovery info with queue stats
  resume    Re-queue interrupted messages as pending
  discard   Mark interrupted as failed, clear suspended sessions

Options:
  --json    Output as JSON

Examples:
  tx recover              # Show status
  tx recover list         # Detailed view
  tx recover resume       # Re-queue work
  tx recover discard      # Discard and clear

Crash Recovery:
  When TX crashes or is killed unexpectedly, the system:
  1. Detects the unclean shutdown on next start (via PID file)
  2. Marks pending messages as 'interrupted' (not 'failed')
  3. Preserves session IDs for worker resume

  Use 'tx recover resume' to re-queue interrupted messages,
  or 'tx recover discard' to abandon them.`,

  mesh: `tx mesh - Manage mesh state

Usage: tx mesh <action> [mesh] [options]

Actions:
  list                    List meshes with activity
  status <mesh>           Show mesh state snapshot
  kill <mesh>             Kill all workers for a mesh (via tmux)
  reload [mesh]           Hot-reload mesh config(s) at runtime
  clear <mesh>            Clear SQLite state (suspended sessions, pending asks, FSM)
  drain <mesh>            Drain all pending messages (mark delivered, unblock queue)
  validate <mesh>         Validate mesh configuration
  fsm-chain <mesh>        Show FSM state transition chain with validation

Options:
  --json                  Output as JSON
  --force                 Force clear even if workers are running
  --strict                Treat warnings as errors (validate only)

Examples:
  tx mesh list
  tx mesh list --json
  tx mesh status narrative-engine
  tx mesh kill narrative-engine
  tx mesh clear test-mesh
  tx mesh clear test-mesh --force
  tx mesh validate narrative-engine
  tx mesh validate my-mesh --strict
  tx mesh fsm-chain narrative-engine-fsm

Notes:
  - 'kill' stops active workers via tmux session termination
  - 'clear' removes suspended sessions, pending asks, and FSM state from SQLite
  - 'validate' checks config.yaml for errors, warnings, and structural issues
  - 'fsm-chain' shows state→agents→targets flow for FSM meshes`,

  forensics: `tx forensics - Analyze mesh execution sessions

Usage: tx forensics [mesh] [options]

Arguments:
  mesh              Mesh name to analyze (default: most recent sessions)

Options:
  -s, --session <id>   Specific session ID to analyze
  -a, --agent <name>   Specific agent to analyze
  -n, --last <n>       Analyze last N sessions (default: 1)
  -o, --output <path>  Output path (default: .ai/tx/forensics/)
  --json               Output as JSON

Examples:
  tx forensics                    # Analyze most recent session
  tx forensics dev                # Analyze most recent dev mesh session
  tx forensics --last 5           # Analyze last 5 sessions
  tx forensics -a dev/implementer # Analyze specific agent
  tx forensics --json             # Output as JSON

Analysis Categories:
  - Routing failures: violations, dead ends, wrong targets
  - Stale state: old asks never answered, session sync issues
  - Off-script agents: unexpected message types, hallucinated targets
  - Success patterns: effective handoffs, correct state management

Output:
  Reports are written to .ai/tx/forensics/ in both JSON and Markdown formats.
  CLI output includes a formatted summary with issues and recommendations.`,
};

function showHelp(cmd: string): void {
  console.log(HELP[cmd as keyof typeof HELP] || HELP.main);
}

async function main() {
  const flags = parseFlags(args);
  const wantsHelp = Boolean(flags.h || flags.help);

  // Block AI agents from running commands that spawn mesh workers
  // --force bypasses this guard (for supervised Claude Code sessions)
  const blockedCommands = ['start', 'run', 'msg', 'restart'];
  if (process.env.CLAUDECODE === '1' && blockedCommands.includes(command) && !flags.force) {
    console.error('\n🚫 AI USE NOT ALLOWED\n');
    console.error(`The "${command}" command cannot be run from Claude Code.`);
    console.error('These commands spawn mesh workers that would create recursive AI calls.');
    console.error('Use --force to override (supervised sessions only).\n');
    process.exit(1);
  }

  switch (command) {
    case 'start':
      if (wantsHelp) { showHelp('start'); break; }
      await start(undefined, {
        continue: Boolean(flags.c || flags.continue),
        model: flags.model as string | undefined,
        low: Boolean(flags.low),
        ultraLow: Boolean(flags.ultraLow),
        serve: Boolean(flags.serve),
        servePort: flags.p ? parseInt(flags.p as string, 10) : (flags.port ? parseInt(flags.port as string, 10) : undefined),
        serveHost: flags.H as string || flags.host as string,
        debug: Boolean(flags.debug),
        noInject: Boolean(flags.noInject),
        inbox: (flags.inbox as 'inject' | 'hook' | 'ask' | undefined),
      });
      break;

    case 'restart':
      if (wantsHelp) { showHelp('restart'); break; }
      await restart(undefined, {
        model: flags.model as string | undefined,
        low: Boolean(flags.low),
        ultraLow: Boolean(flags.ultraLow),
        serve: Boolean(flags.serve),
        servePort: flags.p ? parseInt(flags.p as string, 10) : (flags.port ? parseInt(flags.port as string, 10) : undefined),
        serveHost: flags.H as string || flags.host as string,
        debug: Boolean(flags.debug),
        inbox: (flags.inbox as 'inject' | 'hook' | 'ask' | undefined),
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

    case 'server':
      if (wantsHelp) { showHelp('server'); break; }
      await server({
        port: flags.p ? parseInt(flags.p as string, 10) : (flags.port ? parseInt(flags.port as string, 10) : undefined),
        host: flags.H as string || flags.host as string,
        mesh: flags.m as string || flags.mesh as string,
        noDb: Boolean(flags.noDb),
      });
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
      console.log('\n⚠ "tx validate-mesh" is deprecated. Use "tx mesh validate" instead.\n');
      console.log(`  tx mesh validate ${args[0] || '<mesh>'} ${flags.strict ? '--strict' : ''}\n`);
      process.exit(1);
      break;

    case 'login':
      if (wantsHelp) { showHelp('login'); break; }
      await login({
        email: flags.email as string,
        password: flags.password as string,
        server: flags.server as string,
      });
      break;

    case 'logout':
      if (wantsHelp) { showHelp('logout'); break; }
      await logout();
      break;

    case 'deploy':
      if (wantsHelp) { showHelp('deploy'); break; }
      const deployMeshName = args.filter(a => !a.startsWith('-'))[0];
      await deploy(deployMeshName, {
        region: flags.region as string,
        version: flags.version as string,
      });
      break;

    case 'session':
      if (wantsHelp) { showHelp('session'); break; }
      await session(args);
      break;

    case 'recover':
      if (wantsHelp) { showHelp('recover'); break; }
      await recover(args.filter(a => !a.startsWith('-')), {
        json: Boolean(flags.json),
      });
      break;

    case 'inbox':
      if (wantsHelp) { console.log('tx inbox - Show pending messages for core\n\nOptions:\n  --all   Show all messages, not just unread\n  --peek  Don\'t mark as read'); break; }
      await inbox({
        all: Boolean(flags.all),
        peek: Boolean(flags.peek),
      });
      break;

    case 'mesh':
      if (wantsHelp) { showHelp('mesh'); break; }
      await mesh(args);
      break;

    case 'agent-help':
      const helpTopic = args.filter(a => !a.startsWith('-'))[0];
      agentHelp(helpTopic);
      break;

    case 'forensics':
      if (wantsHelp) { showHelp('forensics'); break; }
      const forensicsMesh = args.filter(a => !a.startsWith('-'))[0];
      await forensics(forensicsMesh, {
        session: flags.s as string || flags.session as string,
        agent: flags.a as string || flags.agent as string,
        last: flags.n as string || flags.last as string,
        output: flags.o as string || flags.output as string,
        json: Boolean(flags.json),
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

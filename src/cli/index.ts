#!/usr/bin/env node
/**
 * TX V4 CLI
 */

import { start, stop } from './start.ts';
import { status, printStatus } from './status.ts';
import { msg } from './msg.ts';
import { logs } from './logs.ts';
import { spy } from './spy.ts';
import { tasks } from './tasks.ts';
import { prompt } from './prompt.ts';
import { log } from '../shared/logger.ts';

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

async function main() {
  const flags = parseFlags(args);

  switch (command) {
    case 'start':
      await start(undefined, { continue: Boolean(flags.c || flags.continue) });
      break;

    case 'status':
      const result = await status();
      printStatus(result);
      break;

    case 'msg':
      await msg({
        type: flags.t as string || flags.type as string,
        agent: flags.a as string || flags.agent as string,
        mesh: flags.m as string || flags.mesh as string,
        since: flags.since as string,
        before: flags.before as string,
        limit: flags.n as string || flags.limit as string,
        follow: Boolean(flags.f || flags.follow),
        json: Boolean(flags.json),
        interactive: !flags.noInteractive,
        verbose: Boolean(flags.v || flags.verbose),
        errors: Boolean(flags.e || flags.errors),
        showPrompts: Boolean(flags.p || flags.showPrompts)
      });
      break;

    case 'logs':
      await logs({
        lines: flags.n as string || flags.lines as string,
        component: flags.c as string || flags.component as string,
        level: flags.l as string || flags.level as string,
        follow: Boolean(flags.f || flags.follow),
        noInteractive: Boolean(flags.noInteractive),
        noFollow: Boolean(flags.noFollow)
      });
      break;

    case 'spy':
      await spy({
        messages: Boolean(flags.m || flags.messages),
        output: Boolean(flags.o || flags.output),
        agent: flags.a as string || flags.agent as string,
        json: Boolean(flags.json)
      });
      break;

    case 'tasks':
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
      await prompt({
        mesh: args[0],
        agent: args[1],
        withTask: flags.withTask as string,
        raw: Boolean(flags.raw)
      });
      break;

    case 'stop':
      await stop();
      break;

    default:
      console.log(`
TX V4 CLI

Usage:
  tx start [-c]         Start core agent (auto-attaches to tmux)
                        -c, --continue  Resume previous Claude session
  tx status             Show system status
  tx msg [options]      View messages (interactive by default)
  tx logs [options]     View logs (interactive by default)
  tx spy [options]      Real-time activity stream
  tx tasks [options]    View task queue
  tx prompt <mesh> <agent> [options]  Show built prompt for agent
  tx stop               Stop core agent

Message options:
  -t, --type <type>     Filter by message type
  -a, --agent <agent>   Filter by agent (also filters sessions)
  -m, --mesh <mesh>     Filter by mesh
  -n, --limit <n>       Limit number of messages (default: 50)
  -f, --follow          Follow mode (real-time updates)
  --since <time>        Messages since time (e.g., "1h", "30m")
  --before <time>       Messages before time
  --json                JSON output
  --no-interactive      Disable interactive mode
  -v, --verbose         Show message previews
  -e, --errors          Show only errors
  -p, --show-prompts    Show injected prompts for each message

Interactive navigation:
  Tab/s                 Switch between Messages and Sessions tabs
  ↑↓/jk                 Navigate list / scroll in detail view
  Enter/→/l             View selected item
  p                     Show injected prompt (messages only)
  f                     Toggle follow mode (messages only)
  ←/h/Esc               Go back
  q                     Quit

Log options:
  -n, --lines <n>       Number of lines (default: 50)
  -c, --component <c>   Filter by component
  -l, --level <level>   Filter by level (info, warn, error, debug)
  --no-interactive      Disable interactive mode
  --no-follow           Disable follow mode

Interactive log keys:
  w worker  d dispatch  n consumer  u queue  o core  t watcher
  1 info    2 warn      3 error     4 debug
  a clear-filters       c clear-logs          q quit

Spy options:
  -a, --agent <agent>   Filter by agent
  -m, --messages        Show message traffic only (no agent output)
  -o, --output          Show agent output only (no messages)
  --json                JSON output

Task options:
  -s, --status <status> Filter by status (open/complete)
  -a, --agent <agent>   Filter by agent
  -n, --limit <n>       Limit number of tasks (default: 50)
  --no-watch            Disable live updates (print once and exit)
  --json                JSON output

Prompt options:
  --with-task <msg-id>  Include task context from message
  --raw                 Raw output (just the prompt, no formatting)
`);
  }
}

main().catch((error) => {
  log.error('cli', 'Unhandled error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});

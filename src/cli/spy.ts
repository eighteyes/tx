/**
 * TX V4 CLI - spy command
 * Real-time stream of messages and activity
 */

import fs from 'node:fs';
import path from 'node:path';
import { MessageQueue } from '../queue/index.ts';
import { chalk } from '../shared/colors.ts';
import { formatTimeAgo } from '../shared/time.ts';

interface SpyOptions {
  messages?: boolean;
  agent?: string;
  json?: boolean;
  output?: boolean;  // Show agent output only
}

const TYPE_ICONS: Record<string, string> = {
  'task': '📋',
  'task-complete': '✅',
  'ask': '❓',
  'ask-response': '💬',
  'ask-human': '👤',
  'update': '📝',
  'error': '❌'
};

const TYPE_COLORS: Record<string, (s: string) => string> = {
  'task': chalk.blue,
  'task-complete': chalk.green,
  'ask': chalk.yellow,
  'ask-response': chalk.cyan,
  'ask-human': chalk.magenta,
  'update': chalk.dim,
  'error': chalk.red
};

function getTypeIcon(type: string): string {
  return TYPE_ICONS[type] || '📨';
}

function colorType(type: string): string {
  const colorFn = TYPE_COLORS[type] || chalk.dim;
  return colorFn(type);
}

interface ActivityEntry {
  timestamp: string;
  event: string;
  agentId: string;
  content: string;
}

export async function spy(options: SpyOptions): Promise<void> {
  const workDir = process.env.TX_CWD || process.cwd();
  const dbPath = process.env.TX_DB_PATH || path.join(workDir, '.ai/tx/data/queue.db');
  const activityFile = path.join(workDir, '.ai/tx/logs/activity.jsonl');
  const queue = new MessageQueue(dbPath);

  const mode = options.output ? 'output' : options.messages ? 'messages' : 'all';
  console.log(chalk.cyan(`🔍 Spying on TX activity [${mode}]... (Ctrl+C to exit)\n`));

  let lastMessageId = queue.getLatestMessageId();
  let lastActivityLine = 0;

  // Count existing activity lines and show recent activity
  if (fs.existsSync(activityFile)) {
    const content = fs.readFileSync(activityFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    lastActivityLine = lines.length;

    // Show recent activity (unless messages-only mode)
    if (!options.messages && lines.length > 0) {
      const recentCount = Math.min(10, lines.length);
      const recentLines = lines.slice(-recentCount);
      console.log(chalk.dim('--- Recent SDK output ---'));
      for (const line of recentLines) {
        try {
          const entry = JSON.parse(line) as ActivityEntry;
          if (options.agent && !entry.agentId.includes(options.agent)) continue;
          printActivity(entry, options.json);
        } catch {
          // Skip invalid lines
        }
      }
    }
  }

  // Show recent messages (unless output-only mode)
  if (!options.output) {
    const recent = queue.queryMessages({
      limit: 10,
      ...(options.agent ? { from_agent: options.agent } : {})
    });

    if (recent.length > 0) {
      console.log(chalk.dim('--- Recent messages ---'));
      for (const msg of recent.reverse()) {
        printMessage(msg, options.json);
      }
    }
  }

  console.log(chalk.dim('--- Live stream ---\n'));

  // Poll for new messages and activity
  const poll = async () => {
    while (true) {
      // Check for new messages (unless output-only mode)
      if (!options.output) {
        const newMessages = queue.queryMessages({
          since_id: lastMessageId,
          ...(options.agent ? { from_agent: options.agent } : {})
        });

        for (const msg of newMessages.reverse()) {
          printMessage(msg, options.json);
          if (msg.id && msg.id > lastMessageId) {
            lastMessageId = msg.id;
          }
        }
      }

      // Check for new activity (agent output)
      if (!options.messages && fs.existsSync(activityFile)) {
        const content = fs.readFileSync(activityFile, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        if (lines.length > lastActivityLine) {
          const newLines = lines.slice(lastActivityLine);
          for (const line of newLines) {
            try {
              const entry = JSON.parse(line) as ActivityEntry;
              if (options.agent && !entry.agentId.includes(options.agent)) continue;
              printActivity(entry, options.json);
            } catch {
              // Skip invalid lines
            }
          }
          lastActivityLine = lines.length;
        }
      }

      await sleep(100);
    }
  };

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\nStopping spy...'));
    queue.close();
    process.exit(0);
  });

  await poll();
}

function printMessage(msg: {
  id?: number;
  type: string;
  from_agent: string;
  to_agent: string;
  payload: Record<string, unknown>;
  created_at?: number;
}, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(msg));
    return;
  }

  const icon = getTypeIcon(msg.type);
  const type = colorType(msg.type);
  const time = msg.created_at ? formatTimeAgo(msg.created_at) : '';
  const headline = msg.payload.headline as string || '';

  console.log(`${icon} ${chalk.bold(`[${type}]`)} ${chalk.cyan(msg.from_agent)} ${chalk.dim('→')} ${chalk.green(msg.to_agent)} ${chalk.dim(time)}`);

  if (headline) {
    console.log(`   ${headline}`);
  }
  console.log();
}

function printActivity(entry: ActivityEntry, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(entry));
    return;
  }

  const time = formatTimeAgo(new Date(entry.timestamp).getTime());
  const agent = chalk.magenta(entry.agentId);

  if (entry.event === 'output') {
    // Truncate long output, show first line or first 200 chars
    const lines = entry.content.split('\n');
    const preview = lines[0].length > 200 ? lines[0].substring(0, 200) + '...' : lines[0];
    const moreLines = lines.length > 1 ? chalk.dim(` (+${lines.length - 1} lines)`) : '';

    console.log(`💭 ${agent} ${chalk.dim(time)}`);
    console.log(`   ${preview}${moreLines}`);
    console.log();
  } else if (entry.event === 'tools') {
    console.log(`🔧 ${agent} ${chalk.dim(time)} ${chalk.cyan(entry.content)}\n`);
  } else {
    console.log(`📍 ${agent} ${chalk.dim(time)} [${entry.event}] ${entry.content}\n`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

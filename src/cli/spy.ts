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
  full?: boolean;    // Show full output without truncation
}

const TYPE_ICONS: Record<string, string> = {
  'task': '📋',
  'task-complete': '✅',
  'message': '💬',         // New canonical type
  'info': 'ℹ️',            // System info messages
  'ask': '❓',             // DEPRECATED
  'ask-response': '💬',    // DEPRECATED
  'ask-human': '👤',       // DEPRECATED
  'update': '📝',
  'error': '❌'
};

const TYPE_COLORS: Record<string, (s: string) => string> = {
  'task': chalk.blue,
  'task-complete': chalk.green,
  'message': chalk.cyan,   // New canonical type
  'info': chalk.dim,       // System info messages
  'ask': chalk.yellow,     // DEPRECATED
  'ask-response': chalk.cyan,  // DEPRECATED
  'ask-human': chalk.magenta,  // DEPRECATED
  'update': chalk.dim,
  'error': chalk.red
};

// Color palette for agent IDs - distinct, terminal-friendly colors
const AGENT_COLORS: Array<(s: string) => string> = [
  chalk.cyan,
  chalk.green,
  chalk.yellow,
  chalk.blue,
  chalk.magenta,
  chalk.red,
  chalk.white,
  chalk.blueBright,
];

// Cache agent ID → color function for consistency within session
const agentColorCache = new Map<string, (s: string) => string>();

/**
 * Hash a string to a number using djb2 algorithm
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Get a consistent color for an agent ID
 */
function getAgentColor(agentId: string): (s: string) => string {
  if (agentColorCache.has(agentId)) {
    return agentColorCache.get(agentId)!;
  }

  const colorIndex = hashString(agentId) % AGENT_COLORS.length;
  const colorFn = AGENT_COLORS[colorIndex];
  agentColorCache.set(agentId, colorFn);
  return colorFn;
}

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
  const dbWalFile = `${dbPath}-wal`; // SQLite Write-Ahead Log
  const queue = new MessageQueue(dbPath);

  const mode = options.output ? 'output' : options.messages ? 'messages' : 'all';
  console.log(chalk.cyan(`🔍 Spying on TX activity [${mode}]... (Ctrl+C to exit)\n`));

  let lastMessageId = 0;
  let lastActivityLine = 0;
  let usingFallback = false;
  let watchers: fs.FSWatcher[] = [];
  let dbErrorCount = 0;

  // Try to get initial message ID
  try {
    lastMessageId = queue.getLatestMessageId();
  } catch {
    console.log(chalk.yellow('⚠️  Waiting for TX to start...\n'));
  }

  // Count existing activity lines and show recent activity
  if (fs.existsSync(activityFile)) {
    const content = fs.readFileSync(activityFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    lastActivityLine = lines.length;

    // Show recent activity (unless messages-only mode)
    if (!options.messages && lines.length > 0) {
      const recentCount = Math.min(25, lines.length);
      const recentLines = lines.slice(-recentCount);
      console.log(chalk.dim('--- Recent SDK output ---'));
      for (const line of recentLines) {
        try {
          const entry = JSON.parse(line) as ActivityEntry;
          if (options.agent && !entry.agentId.includes(options.agent)) continue;
          printActivity(entry, options.json, options.full);
        } catch {
          // Skip invalid lines
        }
      }
    }
  }

  // Show recent messages (unless output-only mode)
  if (!options.output) {
    try {
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
    } catch {
      // Database not ready yet
    }
  }

  console.log(chalk.dim('--- Live stream ---\n'));

  // Check for updates (called by watchers or polling)
  const checkUpdates = () => {
    try {
      // Check for new messages (unless output-only mode)
      if (!options.output) {
        try {
          // Detect if database was reset (message IDs went backwards)
          const currentLatest = queue.getLatestMessageId();
          if (currentLatest < lastMessageId) {
            console.log(chalk.yellow('\n⚠️  Database reset detected, reconnecting...\n'));
            lastMessageId = 0;
            dbErrorCount = 0;
          }

          const newMessages = queue.queryMessages({
            since_id: lastMessageId,
            ...(options.agent ? { from_agent: options.agent } : {})
          });

          // Show reconnection success if recovering from errors
          if (dbErrorCount > 0) {
            console.log(chalk.green('✅ Reconnected to TX\n'));
          }

          for (const msg of newMessages.reverse()) {
            printMessage(msg, options.json);
            if (msg.id && msg.id > lastMessageId) {
              lastMessageId = msg.id;
            }
          }

          dbErrorCount = 0; // Reset error count on success
        } catch (error) {
          dbErrorCount++;
          if (dbErrorCount === 1) {
            console.log(chalk.yellow('\n⚠️  Database connection lost, waiting for TX to restart...\n'));
          }
          // Continue polling, don't exit
        }
      }

      // Check for new activity (agent output)
      if (!options.messages && fs.existsSync(activityFile)) {
        try {
          const content = fs.readFileSync(activityFile, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());

          // Detect if activity file was reset (shrunk)
          if (lines.length < lastActivityLine) {
            console.log(chalk.yellow('\n⚠️  Activity file reset detected\n'));
            lastActivityLine = 0;
          }

          if (lines.length > lastActivityLine) {
            const newLines = lines.slice(lastActivityLine);
            for (const line of newLines) {
              try {
                const entry = JSON.parse(line) as ActivityEntry;
                if (options.agent && !entry.agentId.includes(options.agent)) continue;
                printActivity(entry, options.json, options.full);
              } catch {
                // Skip invalid lines
              }
            }
            lastActivityLine = lines.length;
          }
        } catch {
          // File might be being written, skip this iteration
        }
      }
    } catch (error) {
      console.error(chalk.red(`\n⚠️  Error checking updates: ${error instanceof Error ? error.message : String(error)}`));
      console.error(chalk.dim('Falling back to polling mode...\n'));
      enableFallbackPolling();
    }
  };

  // Fallback polling at 1 second intervals
  let fallbackInterval: NodeJS.Timeout | null = null;
  const enableFallbackPolling = () => {
    if (usingFallback) return;
    usingFallback = true;

    // Close all watchers
    watchers.forEach(w => w.close());
    watchers = [];

    fallbackInterval = setInterval(checkUpdates, 1000);
  };

  // Setup file watchers
  try {
    // Watch activity log file
    if (!options.messages && fs.existsSync(activityFile)) {
      const activityWatcher = fs.watch(activityFile, { persistent: true }, (eventType) => {
        if (eventType === 'change') {
          checkUpdates();
        }
      });

      activityWatcher.on('error', (error) => {
        console.error(chalk.yellow(`\n⚠️  Activity watcher error: ${error.message}`));
        enableFallbackPolling();
      });

      watchers.push(activityWatcher);
    }

    // Watch database WAL file for changes (indicates DB writes)
    if (!options.output && fs.existsSync(dbWalFile)) {
      const dbWatcher = fs.watch(dbWalFile, { persistent: true }, (eventType) => {
        if (eventType === 'change') {
          checkUpdates();
        }
      });

      dbWatcher.on('error', (error) => {
        console.error(chalk.yellow(`\n⚠️  Database watcher error: ${error.message}`));
        enableFallbackPolling();
      });

      watchers.push(dbWatcher);
    }

    // If no watchers could be established, use fallback immediately
    if (watchers.length === 0) {
      console.log(chalk.dim('No file watchers available, using polling mode (1/sec)\n'));
      enableFallbackPolling();
    }
  } catch (error) {
    console.error(chalk.yellow(`⚠️  Failed to setup watchers: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.dim('Using polling mode (1/sec)\n'));
    enableFallbackPolling();
  }

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log(chalk.dim('\n\nStopping spy...'));
    watchers.forEach(w => w.close());
    if (fallbackInterval) clearInterval(fallbackInterval);
    queue.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

function printMessage(msg: {
  id?: number;
  from_agent: string;
  to_agent: string;
  payload: Record<string, unknown>;
  created_at?: number;
}, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(msg));
    return;
  }

  const inferredType = (msg.payload?.headline as string) || 'message';
  const icon = getTypeIcon(inferredType);
  const type = colorType(inferredType);
  const time = msg.created_at ? formatTimeAgo(msg.created_at) : '';
  const headline = msg.payload.headline as string || '';

  console.log(`${icon} ${chalk.bold(`[${type}]`)} ${chalk.cyan(msg.from_agent)} ${chalk.dim('→')} ${chalk.green(msg.to_agent)} ${chalk.dim(time)}`);

  if (headline) {
    console.log(`   ${headline}`);
  }
  console.log();
}

function printActivity(entry: ActivityEntry, json?: boolean, full?: boolean): void {
  if (json) {
    console.log(JSON.stringify(entry));
    return;
  }

  const time = formatTimeAgo(new Date(entry.timestamp).getTime());
  const agentColorFn = getAgentColor(entry.agentId);
  const agent = agentColorFn(entry.agentId);

  if (entry.event === 'output') {
    console.log(`💭 ${agent} ${chalk.dim(time)}`);

    if (full) {
      // Show full output with proper indentation
      const lines = entry.content.split('\n');
      for (const line of lines) {
        console.log(`   ${line}`);
      }
    } else {
      // Truncate long output, show first line or first 200 chars
      const lines = entry.content.split('\n');
      const preview = lines[0].length > 200 ? lines[0].substring(0, 200) + '...' : lines[0];
      const moreLines = lines.length > 1 ? chalk.dim(` (+${lines.length - 1} lines)`) : '';
      console.log(`   ${preview}${moreLines}`);
    }
    console.log();
  } else if (entry.event === 'tools') {
    console.log(`🔧 ${agent} ${chalk.dim(time)} ${chalk.cyan(entry.content)}\n`);
  } else if (entry.event.startsWith('quality:')) {
    // Quality hook events - format based on pass/fail/etc
    const eventName = entry.event.replace('quality:', '');
    let icon = '🔬';
    let contentColor = chalk.dim;

    if (entry.content.includes('PASS')) {
      icon = '✅';
      contentColor = chalk.green;
    } else if (entry.content.includes('FAIL')) {
      icon = '❌';
      contentColor = chalk.red;
    } else if (entry.content.includes('HALT')) {
      icon = '🛑';
      contentColor = chalk.red;
    } else if (entry.content.includes('LOOP')) {
      icon = '🔄';
      contentColor = chalk.yellow;
    } else if (entry.content.includes('EXHAUSTED')) {
      icon = '⚠️';
      contentColor = chalk.yellow;
    } else if (entry.content.includes('SKIPPED')) {
      icon = '⏭️';
      contentColor = chalk.dim;
    } else if (entry.content.includes('Starting') || entry.content.includes('Running')) {
      icon = '▶️';
      contentColor = chalk.cyan;
    }

    console.log(`${icon} ${agent} ${chalk.dim(time)} ${chalk.blue(`[${eventName}]`)} ${contentColor(entry.content)}\n`);
  } else if (entry.event === 'bash:failed') {
    console.log(`💥 ${agent} ${chalk.dim(time)} ${chalk.red('[bash]')} ${chalk.red(entry.content)}\n`);
  } else if (entry.event.startsWith('guardrail:')) {
    const eventName = entry.event.replace('guardrail:', '');
    let icon = '🛡️';
    let contentColor = chalk.yellow;

    if (entry.content.includes('HALT')) {
      icon = '🛑';
      contentColor = chalk.red;
    } else if (entry.content.includes('BLOCKED')) {
      icon = '🚫';
      contentColor = chalk.red;
    } else if (entry.content.includes('RETRY')) {
      icon = '🔄';
      contentColor = chalk.yellow;
    }

    console.log(`${icon} ${agent} ${chalk.dim(time)} ${chalk.magenta(`[${eventName}]`)} ${contentColor(entry.content)}\n`);
  } else {
    console.log(`📍 ${agent} ${chalk.dim(time)} [${entry.event}] ${entry.content}\n`);
  }
}


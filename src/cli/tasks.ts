/**
 * TX V4 CLI - tasks command
 * View tasks derived from message queue (task + task-complete pairs)
 */

import path from 'node:path';
import readline from 'node:readline';
import { MessageQueue, type Message } from '../queue/index.ts';
import { chalk, colors } from '../shared/colors.ts';
import { formatTimeAgo } from '../shared/time.ts';

interface TasksOptions {
  status?: string;
  agent?: string;
  mesh?: string;
  limit?: string;
  json?: boolean;
  watch?: boolean;
  noWatch?: boolean;
}

interface TaskView {
  msgId: string;
  headline: string;
  from: string;
  to: string;
  status: 'open' | 'complete';
  createdAt: number;
  completedAt?: number;
  result?: string;
  grade?: string;
}

const STATUS_ICONS: Record<string, string> = {
  'open': '🔄',
  'complete': '✅',
};

const STATUS_COLORS: Record<string, (s: string) => string> = {
  'open': chalk.yellow,
  'complete': chalk.green,
};

function buildTaskViews(queue: MessageQueue, options: TasksOptions): TaskView[] {
  const limit = options.limit ? parseInt(options.limit, 10) : 50;

  // Get all task and task-complete messages
  const taskMsgs = queue.queryMessages({ type: 'task', limit: limit * 2 });
  const completeMsgs = queue.queryMessages({ type: 'task-complete', limit: limit * 2 });

  // Build a map of msg-id -> completion
  const completionMap = new Map<string, Message>();
  for (const msg of completeMsgs) {
    const msgId = msg.payload['msg-id'] as string;
    if (msgId) {
      completionMap.set(msgId, msg);
    }
  }

  // Build task views
  const taskViews: TaskView[] = [];

  for (const msg of taskMsgs) {
    const msgId = msg.payload['msg-id'] as string || `msg-${msg.id}`;
    const completion = completionMap.get(msgId);

    const task: TaskView = {
      msgId,
      headline: (msg.payload.headline as string) || 'No headline',
      from: msg.from_agent,
      to: msg.to_agent,
      status: completion ? 'complete' : 'open',
      createdAt: msg.created_at!,
    };

    if (completion) {
      task.completedAt = completion.created_at;
      task.result = completion.payload.headline as string;
      task.grade = completion.payload.grade as string;
    }

    // Apply filters
    if (options.status && task.status !== options.status) continue;
    if (options.agent && task.to !== options.agent && task.from !== options.agent) continue;

    taskViews.push(task);
  }

  // Sort by created_at descending
  taskViews.sort((a, b) => b.createdAt - a.createdAt);

  return taskViews.slice(0, limit);
}

export async function tasks(options: TasksOptions): Promise<void> {
  const workDir = process.env.TX_CWD || process.cwd();
  const dbPath = process.env.TX_DB_PATH || path.join(workDir, '.ai/tx/data/queue.db');
  const queue = new MessageQueue(dbPath);

  // JSON mode - no watch
  if (options.json) {
    const taskViews = buildTaskViews(queue, options);
    console.log(JSON.stringify(taskViews, null, 2));
    queue.close();
    return;
  }

  // Non-interactive mode
  if (options.noWatch) {
    const taskViews = buildTaskViews(queue, options);
    if (taskViews.length === 0) {
      console.log(chalk.dim('No tasks found'));
    } else {
      printTaskList(taskViews);
    }
    queue.close();
    return;
  }

  // Watch mode (default) - live updating view
  let watchInterval: NodeJS.Timeout | null = null;

  function display(): void {
    console.clear();
    const taskViews = buildTaskViews(queue, options);

    const openCount = taskViews.filter(t => t.status === 'open').length;
    const completeCount = taskViews.filter(t => t.status === 'complete').length;

    console.log(`${colors.dim}tx tasks${colors.reset}  ${colors.yellow}${openCount} open${colors.reset}  ${colors.green}${completeCount} complete${colors.reset}  ${colors.dim}q quit${colors.reset}\n`);

    if (taskViews.length === 0) {
      console.log(chalk.dim('No tasks found'));
    } else {
      printTaskList(taskViews);
    }
  }

  function cleanup(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    if (watchInterval) clearInterval(watchInterval);
    queue.close();
  }

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on('keypress', (_str, key) => {
    if ((key.ctrl && key.name === 'c') || key.name === 'q') {
      cleanup();
      process.exit(0);
    }
  });

  process.on('SIGINT', cleanup);

  display();

  // Refresh every 500ms
  watchInterval = setInterval(display, 500);
}

function printTaskList(tasks: TaskView[]): void {
  for (const task of tasks) {
    const icon = STATUS_ICONS[task.status] || '📋';
    const statusColor = STATUS_COLORS[task.status] || chalk.dim;
    const time = formatTimeAgo(task.createdAt);

    console.log(`${icon} ${chalk.bold(`[${statusColor(task.status === 'complete' ? 'complete' : 'task')}]`)} ${chalk.cyan(task.from)} ${chalk.dim('→')} ${chalk.green(task.to)} ${chalk.dim(time)}`);
    console.log(`   ${task.headline}`);

    // Show result if complete
    if (task.status === 'complete' && task.result && task.result !== task.headline) {
      console.log(`   ${chalk.dim('└─')} ${task.result}`);
    }

    console.log();
  }
}

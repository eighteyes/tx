/**
 * tx recover - Crash recovery CLI
 *
 * View and resume interrupted work from unclean shutdowns.
 */

import path from 'node:path';
import fs from 'node:fs';
import { MessageQueue, type Message, type SuspendedSessionData } from '../queue/index.ts';
import { log } from '../shared/logger.ts';

export interface RecoverOptions {
  json?: boolean;
}

/**
 * Format a timestamp as relative time
 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

/**
 * Format message for display
 */
function formatMessage(msg: Message): string {
  const headline = msg.payload?.headline as string || msg.type;
  const from = msg.from_agent;
  const to = msg.to_agent;
  const created = msg.created_at ? formatRelativeTime(msg.created_at) : 'unknown';

  return `  [${msg.id}] ${from} -> ${to} (${headline}) - ${created}`;
}

/**
 * Format suspended session for display
 */
function formatSuspendedSession(s: SuspendedSessionData): string {
  const suspended = formatRelativeTime(s.suspendedAt);
  const targets = s.targetAgents?.join(', ') || 'unknown';

  return `  ${s.agentId}
    Session: ${s.sessionId.slice(0, 12)}...
    Reason: ${s.reason}
    Mesh: ${s.meshName}
    Awaiting: ${targets}
    Pending responses: ${s.pendingCount}
    Suspended: ${suspended}`;
}

/**
 * Show recovery status - default action
 */
async function showRecoveryStatus(queue: MessageQueue, options: RecoverOptions): Promise<void> {
  const interrupted = queue.getInterruptedMessages();
  const suspended = queue.listSuspendedSessions();
  const sessions = queue.getActiveSessions();

  if (options.json) {
    console.log(JSON.stringify({
      interrupted: interrupted.map(m => ({
        id: m.id,
        from: m.from_agent,
        to: m.to_agent,
        type: m.type,
        headline: m.payload?.headline,
        createdAt: m.created_at,
      })),
      suspended: suspended.map(s => ({
        agentId: s.agentId,
        sessionId: s.sessionId,
        reason: s.reason,
        meshName: s.meshName,
        targetAgents: s.targetAgents,
        pendingCount: s.pendingCount,
        suspendedAt: s.suspendedAt,
      })),
      sessions: sessions.map(s => ({
        agentId: s.agentId,
        sessionId: s.sessionId,
      })),
    }, null, 2));
    return;
  }

  console.log('\n=== TX Crash Recovery Status ===\n');

  // Interrupted messages
  console.log(`Interrupted messages: ${interrupted.length}`);
  if (interrupted.length > 0) {
    for (const msg of interrupted.slice(0, 10)) {
      console.log(formatMessage(msg));
    }
    if (interrupted.length > 10) {
      console.log(`  ... and ${interrupted.length - 10} more`);
    }
    console.log('');
  }

  // Suspended sessions
  console.log(`Suspended sessions: ${suspended.length}`);
  if (suspended.length > 0) {
    for (const s of suspended) {
      console.log(formatSuspendedSession(s));
    }
    console.log('');
  }

  // Active session IDs (for resume)
  console.log(`Stored session IDs: ${sessions.length}`);
  if (sessions.length > 0) {
    for (const s of sessions.slice(0, 10)) {
      console.log(`  ${s.agentId}: ${s.sessionId.slice(0, 12)}...`);
    }
    if (sessions.length > 10) {
      console.log(`  ... and ${sessions.length - 10} more`);
    }
    console.log('');
  }

  // Recovery actions
  if (interrupted.length > 0 || suspended.length > 0) {
    console.log('Recovery actions:');
    console.log('  tx recover resume   - Re-queue interrupted messages');
    console.log('  tx recover discard  - Mark as failed, clear suspended sessions');
    console.log('');
  } else {
    console.log('No recoverable work found.\n');
  }
}

/**
 * Resume interrupted work
 */
async function resumeInterrupted(queue: MessageQueue): Promise<void> {
  const interrupted = queue.getInterruptedMessages();

  if (interrupted.length === 0) {
    console.log('No interrupted messages to resume.');
    return;
  }

  const count = queue.requeueInterruptedMessages();
  console.log(`Re-queued ${count} interrupted message(s) as pending.`);
  console.log('Messages will be processed on next tx start.');

  log.info('recover', `Resumed ${count} interrupted messages`);
}

/**
 * Discard interrupted work
 */
async function discardInterrupted(queue: MessageQueue): Promise<void> {
  const interrupted = queue.getInterruptedMessages();
  const suspended = queue.listSuspendedSessions();

  if (interrupted.length === 0 && suspended.length === 0) {
    console.log('No interrupted work to discard.');
    return;
  }

  let total = 0;

  if (interrupted.length > 0) {
    const count = queue.markInterruptedAsFailed();
    console.log(`Marked ${count} interrupted message(s) as failed.`);
    total += count;
  }

  if (suspended.length > 0) {
    const count = queue.clearAllSuspendedSessions();
    console.log(`Cleared ${count} suspended session(s).`);
    total += count;
  }

  log.info('recover', `Discarded ${total} interrupted items`);
}

/**
 * List all recovery info (detailed view)
 */
async function listRecoveryInfo(queue: MessageQueue, options: RecoverOptions): Promise<void> {
  await showRecoveryStatus(queue, { ...options, json: false });

  // Also show some queue stats
  const stats = queue.getStats();
  console.log('Queue stats:');
  console.log(`  Total: ${stats.total}`);
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Delivered: ${stats.delivered}`);

  if (Object.keys(stats.byAgent).length > 0) {
    console.log('  By agent:');
    for (const [agent, count] of Object.entries(stats.byAgent)) {
      console.log(`    ${agent}: ${count}`);
    }
  }
  console.log('');
}

/**
 * Main recover command
 */
export async function recover(args: string[], options: RecoverOptions = {}): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const dataDir = path.join(cwd, '.ai', 'tx', 'data');
  const dbPath = path.join(dataDir, 'queue.db');

  if (!fs.existsSync(dbPath)) {
    console.log('No TX database found. Nothing to recover.');
    return;
  }

  const queue = new MessageQueue(dbPath);

  try {
    const [action] = args;

    switch (action) {
      case 'list':
        await listRecoveryInfo(queue, options);
        break;

      case 'resume':
        await resumeInterrupted(queue);
        break;

      case 'discard':
        await discardInterrupted(queue);
        break;

      default:
        // Default: show status report
        await showRecoveryStatus(queue, options);
    }
  } finally {
    queue.close();
  }
}

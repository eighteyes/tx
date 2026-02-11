/**
 * tx inbox - Show pending messages for core
 *
 * Reads pending-for-core.json and hook-state.json to show unread
 * message file paths. Designed for piping and scripting.
 *
 * Flags:
 *   --all   Show all messages, not just unread
 *   --peek  Don't mark as read (don't update hook-state.json)
 */

import fs from 'node:fs';
import path from 'node:path';

export interface InboxOptions {
  all?: boolean;
  peek?: boolean;
}

export async function inbox(options?: InboxOptions): Promise<void> {
  const cwd = process.env.TX_CWD || process.cwd();
  const dataDir = path.join(cwd, '.ai', 'tx', 'data');

  const pendingPath = path.join(dataDir, 'pending-for-core.json');
  const hookStatePath = path.join(dataDir, 'hook-state.json');

  // Read pending messages
  let pending: { messages: Array<{ id: number; from: string; type: string; file: string; timestamp?: string }>; lastWritten: number };
  try {
    if (!fs.existsSync(pendingPath)) return;
    pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
  } catch {
    return;
  }

  if (!pending.messages || pending.messages.length === 0) return;

  // Read hook state for lastSeenId
  let lastSeenId = 0;
  try {
    if (fs.existsSync(hookStatePath)) {
      const hookState = JSON.parse(fs.readFileSync(hookStatePath, 'utf-8'));
      lastSeenId = hookState.lastSeenId || 0;
    }
  } catch {
    // Default to 0
  }

  // Filter messages
  const messages = options?.all
    ? pending.messages
    : pending.messages.filter(m => m.id > lastSeenId);

  if (messages.length === 0) return;

  // Print file paths (one per line, clean for piping)
  for (const msg of messages) {
    console.log(msg.file);
  }

  // Mark as read (update hook-state.json) unless --peek
  if (!options?.peek && !options?.all) {
    const maxId = Math.max(...messages.map(m => m.id));
    try {
      fs.writeFileSync(hookStatePath, JSON.stringify({
        lastSeenId: maxId,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {
      // Non-fatal
    }
  }
}

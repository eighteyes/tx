#!/usr/bin/env npx tsx
/**
 * TX Context Hook
 *
 * Dual-mode script:
 *   --status   Output tmux status bar string (called by tmux every 5s)
 *   (default)  Claude Code UserPromptSubmit hook — injects TX state as context
 *
 * Single source of truth for reading TX system state files.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Use CLAUDE_PROJECT_DIR if available, otherwise cwd
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const dataDir = join(projectDir, '.ai', 'tx', 'data');

// ─── Shared data readers ───────────────────────────────────────────────

function readRuntime(): { inbox?: string; inject?: boolean; startedAt?: string; sessionName?: string } | null {
  const runtimePath = join(dataDir, 'runtime.json');
  if (!existsSync(runtimePath)) return null;
  try {
    return JSON.parse(readFileSync(runtimePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readStatus(): {
  meshes: Record<string, { activeWorkers: number; state: string; suspendedAgent?: string; haltReason?: string; pendingMessages?: number }>;
  workers: string[];
  pendingAsks: number;
  pendingQueue?: Record<string, number>;
  timestamp?: string;
} {
  const statusPath = join(dataDir, 'status.json');
  try {
    return existsSync(statusPath)
      ? JSON.parse(readFileSync(statusPath, 'utf-8'))
      : { meshes: {}, workers: [], pendingAsks: 0 };
  } catch {
    return { meshes: {}, workers: [], pendingAsks: 0 };
  }
}

function readPending(): {
  messages: Array<{ id: number; from: string; type: string; file: string; timestamp?: string }>;
  lastWritten: number;
} {
  const pendingPath = join(dataDir, 'pending-for-core.json');
  try {
    return existsSync(pendingPath)
      ? JSON.parse(readFileSync(pendingPath, 'utf-8'))
      : { messages: [], lastWritten: 0 };
  } catch {
    return { messages: [], lastWritten: 0 };
  }
}

function readHookState(): { lastSeenId: number; updatedAt?: string } {
  const hookStatePath = join(dataDir, 'hook-state.json');
  try {
    return existsSync(hookStatePath)
      ? JSON.parse(readFileSync(hookStatePath, 'utf-8'))
      : { lastSeenId: 0 };
  } catch {
    return { lastSeenId: 0 };
  }
}

function readOutgoingTasks(): number {
  const outgoingPath = join(dataDir, 'outgoing-tasks.json');
  try {
    if (!existsSync(outgoingPath)) return 0;
    const data = JSON.parse(readFileSync(outgoingPath, 'utf-8'));
    return Object.values(data).reduce((sum: number, tasks) => sum + (tasks as unknown[]).length, 0);
  } catch {
    return 0;
  }
}

function getUnreadCount(
  pending: ReturnType<typeof readPending>,
  hookState: ReturnType<typeof readHookState>,
): number {
  return pending.messages.filter(m => m.id > hookState.lastSeenId).length;
}

// ─── Status bar mode (--status) ────────────────────────────────────────

function outputStatusBar(): void {
  const status = readStatus();
  const pending = readPending();
  const hookState = readHookState();
  const messagesForCore = getUnreadCount(pending, hookState);
  const outgoingTasks = readOutgoingTasks();

  // Count active and suspended workers from status.json
  let activeWorkers = 0;
  let suspendedCount = 0;
  activeWorkers = status.workers?.length || 0;
  suspendedCount = status.pendingAsks || 0;

  const parts: string[] = [];

  // State: IDLE unless workers are active
  if (activeWorkers > 0) {
    parts.push('BUSY');
  } else if (suspendedCount > 0) {
    parts.push('AWAIT');
  } else {
    parts.push('IDLE');
  }

  // Extract agent names for later use
  const agentNames = (status.workers || [])
    .map(w => w.split('/').pop() || w)
    .join(',');

  // Messages for core (unread)
  if (messagesForCore > 0) {
    parts.push(`${messagesForCore}📨`);
  }

  // Outgoing tasks from core awaiting completion
  if (outgoingTasks > 0) {
    parts.push(`${outgoingTasks}📤`);
  }

  // Pending ask-human messages
  if (status.pendingAsks > 0) {
    parts.push(`${status.pendingAsks}❓`);
  }

  // Active workers with agent names
  if (activeWorkers > 0) {
    parts.push(`${activeWorkers}🔧 ${agentNames}`);
  }

  // Suspended/awaiting
  if (suspendedCount > 0) {
    parts.push(`${suspendedCount}💤`);
  }

  // Pending queue messages (waiting for dispatch)
  const pendingQueue = status.pendingQueue || {};
  const totalPending = Object.values(pendingQueue).reduce((sum, n) => sum + n, 0);
  if (totalPending > 0) {
    parts.push(`${totalPending}⏳`);
  }

  console.log(parts.join(' │ '));
}

// ─── Hook context mode (default) ──────────────────────────────────────

function outputHookContext(): void {
  // 1. Check runtime config — only fire for 'hook' inbox mode
  const runtime = readRuntime();
  if (!runtime) {
    process.exit(0);
  }
  // Backward compat: old runtime.json has inject:true/false, new has inbox:'hook'|'inject'|'ask'
  const inboxMode = runtime.inbox ?? (runtime.inject ? 'hook' : 'ask');
  if (inboxMode !== 'hook') {
    process.exit(0);
  }

  // 2. Read state files
  const status = readStatus();
  const pending = readPending();
  const hookState = readHookState();

  // 3. Filter to new messages
  const newMessages = pending.messages.filter(m => m.id > hookState.lastSeenId);

  // If no new messages and no active meshes, exit silently
  if (newMessages.length === 0 && Object.keys(status.meshes).length === 0) {
    process.exit(0);
  }

  // 4. Update hook state with max seen ID (only if this is the TX core session)
  const isCoreSession = process.env.TX_CORE_SESSION === '1';
  if (isCoreSession && newMessages.length > 0) {
    const maxId = Math.max(...newMessages.map(m => m.id));
    const updatedState = { lastSeenId: maxId, updatedAt: new Date().toISOString() };
    try {
      writeFileSync(join(dataDir, 'hook-state.json'), JSON.stringify(updatedState, null, 2));
    } catch {
      // Non-fatal
    }
  }

  // 5. Format status line
  const meshSummary = Object.entries(status.meshes)
    .map(([name, data]) => {
      const meshData = data as Record<string, unknown>;
      if (meshData.state === 'halted' && meshData.suspendedAgent) {
        return `${name}(halted:${meshData.suspendedAgent})`;
      }
      return `${name}(${data.activeWorkers})`;
    })
    .join(', ') || 'none';

  // 6. Build and output XML context
  const messagesXml = newMessages.length > 0
    ? newMessages.map(m =>
        `    <message from="${escapeXml(m.from)}" type="${escapeXml(m.type)}" file="${escapeXml(m.file)}" />`
      ).join('\n')
    : '';

  // 7. Build pending queue summary (agents with queued but undispatched messages)
  const pendingQueue = status.pendingQueue || {};
  const pendingEntries = Object.entries(pendingQueue).filter(([, n]) => n > 0);
  const pendingQueueXml = pendingEntries.length > 0
    ? `\n  <pending-queue count="${pendingEntries.reduce((s, [, n]) => s + n, 0)}">\n` +
      pendingEntries.map(([agent, count]) =>
        `    <agent id="${escapeXml(agent)}" pending="${count}" />`
      ).join('\n') +
      `\n  </pending-queue>`
    : '';

  const output = `<tx-context>
  <status meshes="${escapeXml(meshSummary)}" pending-asks="${status.pendingAsks}" />
  <messages count="${newMessages.length}">
${messagesXml}
  </messages>${pendingQueueXml}
</tx-context>`;

  console.log(output);
}

// ─── Entrypoint ────────────────────────────────────────────────────────

if (process.argv.includes('--status')) {
  outputStatusBar();
} else {
  outputHookContext();
}

// ─── Helpers ───────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

#!/usr/bin/env npx tsx
/**
 * TX Context Hook
 *
 * Claude Code UserPromptSubmit hook that injects TX system state
 * and pending messages before each Claude response.
 *
 * Hook output is printed to stdout and injected as context.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Use CLAUDE_PROJECT_DIR if available, otherwise cwd
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const dataDir = join(projectDir, '.ai', 'tx', 'data');

// 1. Check runtime config - if file doesn't exist or inject is false, exit silently
const runtimePath = join(dataDir, 'runtime.json');
if (!existsSync(runtimePath)) {
  process.exit(0);
}

let runtime: { inject: boolean; startedAt?: string; sessionName?: string };
try {
  runtime = JSON.parse(readFileSync(runtimePath, 'utf-8'));
} catch {
  process.exit(0);  // Invalid JSON, exit silently
}

if (!runtime.inject) {
  process.exit(0);  // --no-inject flag was set
}

// 2. Read status file (optional - may not exist yet)
const statusPath = join(dataDir, 'status.json');
let status: {
  meshes: Record<string, { activeWorkers: number; state: string }>;
  workers: string[];
  pendingAsks: number;
  timestamp?: string;
};
try {
  status = existsSync(statusPath)
    ? JSON.parse(readFileSync(statusPath, 'utf-8'))
    : { meshes: {}, workers: [], pendingAsks: 0 };
} catch {
  status = { meshes: {}, workers: [], pendingAsks: 0 };
}

// 3. Read pending messages
const pendingPath = join(dataDir, 'pending-for-core.json');
let pending: {
  messages: Array<{
    id: number;
    from: string;
    type: string;
    file: string;
    timestamp?: string;
  }>;
  lastWritten: number;
};
try {
  pending = existsSync(pendingPath)
    ? JSON.parse(readFileSync(pendingPath, 'utf-8'))
    : { messages: [], lastWritten: 0 };
} catch {
  pending = { messages: [], lastWritten: 0 };
}

// 4. Get last seen ID from hook state
const hookStatePath = join(dataDir, 'hook-state.json');
let hookState: { lastSeenId: number; updatedAt?: string };
try {
  hookState = existsSync(hookStatePath)
    ? JSON.parse(readFileSync(hookStatePath, 'utf-8'))
    : { lastSeenId: 0 };
} catch {
  hookState = { lastSeenId: 0 };
}

// 5. Filter to only new messages (id > lastSeenId)
const newMessages = pending.messages.filter(m => m.id > hookState.lastSeenId);

// If no new messages and no active meshes, exit silently
if (newMessages.length === 0 && Object.keys(status.meshes).length === 0) {
  process.exit(0);
}

// 6. Update hook state with max seen ID
if (newMessages.length > 0) {
  const maxId = Math.max(...newMessages.map(m => m.id));
  hookState.lastSeenId = maxId;
  hookState.updatedAt = new Date().toISOString();
  try {
    writeFileSync(hookStatePath, JSON.stringify(hookState, null, 2));
  } catch {
    // Non-fatal - continue even if we can't persist state
  }
}

// 7. Format status line
const meshSummary = Object.entries(status.meshes)
  .map(([name, data]) => `${name}(${data.activeWorkers})`)
  .join(', ') || 'none';

// 8. Build and output XML context
const messagesXml = newMessages.length > 0
  ? newMessages.map(m =>
      `    <message from="${escapeXml(m.from)}" type="${escapeXml(m.type)}" file="${escapeXml(m.file)}" />`
    ).join('\n')
  : '';

const output = `<tx-context>
  <status meshes="${escapeXml(meshSummary)}" pending-asks="${status.pendingAsks}" />
  <messages count="${newMessages.length}">
${messagesXml}
  </messages>
</tx-context>`;

console.log(output);

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

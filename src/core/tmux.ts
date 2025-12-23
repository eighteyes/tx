/**
 * TmuxSession - V4 tmux session management
 *
 * Creates tmux sessions and runs Claude inside them.
 */

import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { log } from '../shared/logger.ts';

const execAsync = promisify(exec);

/** Valid tmux session name pattern: alphanumeric, underscore, hyphen */
const VALID_SESSION_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Generate unique tmux session name for a working directory
 * Allows multiple TX instances on one system in different directories
 */
export function getSessionName(workDir: string): string {
  const resolvedPath = path.resolve(workDir);
  const basename = path.basename(resolvedPath);

  // Create short hash of full path for uniqueness
  const hash = crypto
    .createHash('md5')
    .update(resolvedPath)
    .digest('hex')
    .slice(0, 8);

  // Sanitize basename to only valid characters
  const safeName = basename.replace(/[^a-zA-Z0-9_-]/g, '-');

  return `tx-${safeName}-${hash}`;
}

export class TmuxSession {
  readonly name: string;

  constructor(name: string) {
    if (!VALID_SESSION_NAME.test(name)) {
      throw new Error(`Invalid session name: "${name}". Use only alphanumeric, underscore, and hyphen.`);
    }
    this.name = name;
  }

  async create(workDir?: string): Promise<boolean> {
    try {
      const dirFlag = workDir ? ` -c '${workDir}'` : '';
      await execAsync(`tmux new-session -d -s '${this.name}'${dirFlag}`);
      return true;
    } catch {
      return false;
    }
  }

  async exists(): Promise<boolean> {
    try {
      await execAsync(`tmux has-session -t '${this.name}'`);
      return true;
    } catch {
      return false;
    }
  }

  async kill(): Promise<boolean> {
    try {
      await execAsync(`tmux kill-session -t '${this.name}'`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send keys to the tmux session
   */
  send(keys: string): boolean {
    try {
      // Escape single quotes
      const escaped = keys.replace(/'/g, "'\\''");
      execSync(`tmux send-keys -t '${this.name}' '${escaped}'`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send Enter key
   */
  sendEnter(): boolean {
    try {
      execSync(`tmux send-keys -t '${this.name}' Enter`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send literal text (for special characters)
   */
  sendLiteral(text: string): boolean {
    try {
      // -l flag sends literal text
      const escaped = text.replace(/'/g, "'\\''");
      execSync(`tmux send-keys -t '${this.name}' -l '${escaped}'`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Capture current pane content
   */
  capture(lines: number = 100): string {
    try {
      const output = execSync(
        `tmux capture-pane -t '${this.name}' -p -S -${lines}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return output;
    } catch {
      return '';
    }
  }
}

/**
 * Find Claude binary path
 */
export function findClaudePath(): string {
  const possiblePaths = [
    '/usr/local/share/npm-global/bin/claude',
    path.join(os.homedir(), '.claude/local/claude'),
  ];

  for (const claudePath of possiblePaths) {
    if (fs.existsSync(claudePath)) {
      return claudePath;
    }
  }

  // Try which
  try {
    const whichResult = execSync('which claude', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();

    if (whichResult && fs.existsSync(whichResult)) {
      return whichResult;
    }
  } catch {
    // Not in PATH
  }

  throw new Error('Claude binary not found');
}

/**
 * Start Claude in a tmux session
 */
export async function startClaudeInTmux(sessionName: string): Promise<TmuxSession> {
  const tmux = new TmuxSession(sessionName);

  // Kill existing session if present
  if (await tmux.exists()) {
    console.log(`[tmux] Killing existing session: ${sessionName}`);
    await tmux.kill();
  }

  // Create new session
  console.log(`[tmux] Creating session: ${sessionName}`);
  const created = await tmux.create();
  if (!created) {
    throw new Error(`Failed to create tmux session: ${sessionName}`);
  }

  // Small delay for session to be ready
  await new Promise(resolve => setTimeout(resolve, 500));

  // Find and start Claude
  const claudePath = findClaudePath();
  console.log(`[tmux] Starting Claude: ${claudePath}`);
  tmux.send(`${claudePath} --dangerously-skip-permissions`);
  tmux.sendEnter();

  // Wait for Claude to be ready (look for the prompt)
  console.log('[tmux] Waiting for Claude to initialize...');
  const ready = await waitForClaudeReady(tmux, 60000);

  if (!ready) {
    throw new Error('Claude failed to initialize in time');
  }

  console.log('[tmux] Claude is ready');
  return tmux;
}

/**
 * Wait for Claude to be ready by checking pane output
 */
async function waitForClaudeReady(tmux: TmuxSession, timeout: number): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;

  // Patterns that indicate Claude is ready (looking for idle state)
  const readyPatterns = [
    />\s*$/m,  // Prompt ending with >
    /claude/i,  // Claude mentioned
  ];

  // Patterns that indicate we're stuck at a gate
  const gatePatterns = [
    /initial configuration/i,
    /Trust.*project/i,
  ];

  while (Date.now() - startTime < timeout) {
    const output = tmux.capture(30);

    // Check for gate patterns (need user intervention)
    for (const pattern of gatePatterns) {
      if (pattern.test(output)) {
        console.log('[tmux] Claude needs configuration. Attach to session and complete setup.');
        console.log(`[tmux] Run: tmux attach -t ${tmux.name}`);
        return false;
      }
    }

    // Check for ready - look for lack of activity + prompt
    // Simple heuristic: if we see text and it's been stable
    if (output.length > 100) {
      // Wait a bit more to ensure it's stable
      await new Promise(resolve => setTimeout(resolve, 2000));
      const output2 = tmux.capture(30);
      if (output2 === output || output2.length > output.length) {
        // Stable or growing - likely ready
        return true;
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return false;
}

// Debug counter for idle check logging
let idleCheckLogCount = 0;

/**
 * Check if Claude is idle and ready for message injection
 *
 * Returns true if:
 * - Prompt is visible (ends with >)
 * - No active processing indicators
 */
export function isClaudeIdle(tmux: TmuxSession): boolean {
  const output = tmux.capture(5);  // Just last 5 lines

  // Log raw capture for debugging (first 5 attempts only)
  if (idleCheckLogCount < 5) {
    idleCheckLogCount++;
    log.info('tmux', 'Raw capture debug', {
      raw: JSON.stringify(output.slice(-150)),
      bytes: output.length
    });
  }

  const lines = output.split('\n').filter(l => l.trim());
  const lastLine = lines[lines.length - 1] || '';

  // Check for active processing
  if (/esc to interrupt/i.test(lastLine) || /esc to cancel/i.test(lastLine)) {
    log.debug('tmux', 'Claude busy: esc prompt visible');
    return false;
  }

  // Check for idle prompt - Claude Code uses ⏵⏵, also check > and ❯
  const isIdle = /[>❯⏵]\s*$/.test(lastLine) || /bypass permissions/i.test(lastLine);

  if (!isIdle && idleCheckLogCount <= 10) {
    log.info('tmux', 'Claude not idle', {
      lastLine: JSON.stringify(lastLine.slice(-80)),
      lineCount: lines.length
    });
  }

  return isIdle;
}

/**
 * Inject a prompt into a Claude tmux session
 *
 * Returns true if injected, false if Claude was busy (caller should retry)
 */
export function injectPrompt(tmux: TmuxSession, prompt: string): boolean {
  // Check if Claude is ready before injecting
  if (!isClaudeIdle(tmux)) {
    return false;
  }

  // Send the prompt using literal mode for accuracy
  tmux.sendLiteral(prompt);
  tmux.sendEnter();
  return true;
}

/**
 * Inject a file path for Claude to read
 *
 * Returns true if injected, false if Claude was busy (caller should retry)
 */
export function injectFile(tmux: TmuxSession, filepath: string): boolean {
  const message = `Read and follow the instructions in: ${filepath}`;
  return injectPrompt(tmux, message);
}

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

/** Helper to sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
   * Source a tmux configuration file for this session
   */
  async sourceConfig(configPath: string): Promise<boolean> {
    log.debug('tmux', 'sourceConfig called', { session: this.name, configPath });

    try {
      let hostPath = configPath;

      // If path doesn't exist (e.g., Docker path mismatch), try to resolve relative to CLI installation
      if (!fs.existsSync(configPath)) {
        log.debug('tmux', 'Config path does not exist, trying alt path', { configPath });

        // Get CLI installation directory (where this code is actually running)
        const cliRoot = path.resolve(__dirname, '../..');
        const filename = path.basename(configPath);
        const altPath = path.join(cliRoot, filename);

        log.debug('tmux', 'Checking alt path', { cliRoot, filename, altPath });

        if (fs.existsSync(altPath)) {
          hostPath = altPath;
          log.info('tmux', 'Using alt config path', { original: configPath, resolved: hostPath });
        } else {
          log.error('tmux', 'Config file not found', { path: configPath, altPath });
          return false;
        }
      } else {
        log.debug('tmux', 'Config path exists', { hostPath });
      }

      const cmd = `tmux source-file '${hostPath}'`;
      log.debug('tmux', 'Executing source-file command', { cmd, session: this.name });

      const result = await execAsync(cmd);
      log.info('tmux', 'Successfully sourced config', { path: hostPath, stdout: result.stdout, stderr: result.stderr });
      return true;
    } catch (err: any) {
      log.error('tmux', 'Failed to source config', {
        session: this.name,
        path: configPath,
        error: err.message,
        stderr: err.stderr,
        stdout: err.stdout,
        code: err.code
      });
      return false;
    }
  }

  /**
   * Check if pane is in copy-mode (scroll mode)
   * When in copy-mode, send-keys goes to copy-mode instead of the shell
   */
  isInCopyMode(): boolean {
    try {
      const result = execSync(
        `tmux display-message -t '${this.name}' -p '#{pane_in_mode}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      return result === '1';
    } catch {
      return false;
    }
  }

  /**
   * Exit copy-mode if active
   */
  exitCopyMode(): boolean {
    try {
      execSync(`tmux copy-mode -q -t '${this.name}'`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure pane is ready for input (not in copy-mode)
   */
  private ensureInputReady(): void {
    if (this.isInCopyMode()) {
      log.warn('tmux', 'Pane in copy-mode, exiting before send', { session: this.name });
      this.exitCopyMode();
    }
  }

  /**
   * Send keys to the tmux session
   */
  send(keys: string): boolean {
    try {
      this.ensureInputReady();
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
      this.ensureInputReady();
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
      this.ensureInputReady();
      // -l flag sends literal text
      const escaped = text.replace(/'/g, "'\\''");
      execSync(`tmux send-keys -t '${this.name}' -l '${escaped}'`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send BEL to the pane's tty (triggers terminal alert sound)
   */
  bell(): void {
    try {
      const tty = execSync(
        `tmux display-message -t '${this.name}' -p '#{pane_tty}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (tty) {
        fs.writeFileSync(tty, '\x07');
      }
    } catch {
      // Non-fatal — terminal may not support BEL
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

  /**
   * Capture current pane content with escape sequences (colors)
   */
  captureWithColors(lines: number = 100): string {
    try {
      const output = execSync(
        `tmux capture-pane -t '${this.name}' -p -e -S -${lines}`,
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

  // Configure session-specific key bindings
  try {
    // Prefix + r = reset terminal (fixes mouse mode, escape sequence corruption)
    execSync(`tmux bind-key -T prefix r send-keys -R \\; clear-history`, { stdio: 'pipe' });
  } catch {
    // Non-fatal - user can still run reset manually
  }

  // Small delay for session to be ready
  await new Promise(resolve => setTimeout(resolve, 500));

  // Find and start Claude
  const claudePath = findClaudePath();
  console.log(`[tmux] Starting Claude: ${claudePath}`);

  // Permission flags: check TX_GOD_MODE environment variable
  const godMode = process.env.TX_GOD_MODE === '1';
  const permissionFlags = godMode
    ? '--dangerously-skip-permissions'
    : '--permission-mode dontAsk';  // No --allowed-tools here, will use defaults

  tmux.send(`${claudePath} ${permissionFlags}`);
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

// Walked-away detection state
let previousLastLine: string | null = null;
let previousLineFirstSeen: number = 0;
let lastLineChangeTime: number = 0;

// Timeouts for walked-away detection
const WALKED_AWAY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes same line = walked away
const TYPING_THRESHOLD_MS = 2000; // Line changes within 2s = likely typing

/**
 * Reset idle detection state after successful injection
 * Prevents stale walked-away state from carrying over
 */
export function resetIdleState(): void {
  previousLastLine = null;
  previousLineFirstSeen = 0;
  lastLineChangeTime = 0;
  idleCheckLogCount = 0;
}

/**
 * Check if Claude is idle and ready for message injection
 *
 * ONLY inject when:
 * - Empty prompt visible (❯ with nothing after, or only autocomplete/dim text)
 * - No busy indicator
 *
 * Autocomplete detection: text after prompt with dim escape code (\x1b[2m) is OK
 * User-typed text: non-dim text after prompt = NOT OK to inject
 */
export function isClaudeIdle(tmux: TmuxSession): boolean {
  const now = Date.now();

  // Capture WITH escape codes to detect autocomplete (dim text)
  const colorOutput = tmux.captureWithColors(5);

  // Also get plain text for logging
  const plainOutput = tmux.capture(5);

  // Log raw capture for debugging (first 5 attempts only)
  if (idleCheckLogCount < 5) {
    idleCheckLogCount++;
    log.info('tmux', 'Raw capture debug', {
      raw: JSON.stringify(plainOutput.slice(-150)),
      bytes: plainOutput.length
    });
  }

  const lines = plainOutput.split('\n').filter(l => l.trim());

  // Filter out border/visual lines (box-drawing characters)
  const contentLines = lines.filter(l => !/^[─━═┃│┌┐└┘├┤┬┴┼╭╮╯╰\-|+]+$/.test(l.trim()));

  // Check last N lines since UI elements may appear after prompt
  const lastNLines = contentLines.slice(-5);
  const lastLine = lastNLines[lastNLines.length - 1] || '';

  // Track line changes for walked-away logging (informational only)
  if (lastLine !== previousLastLine) {
    lastLineChangeTime = now;
    previousLastLine = lastLine;
    previousLineFirstSeen = now;
  }

  // Check for active processing in any of the last N lines
  const escPattern = /esc to (interrupt|cancel)/i;
  if (lastNLines.some(line => escPattern.test(line))) {
    log.debug('tmux', 'Claude busy: esc prompt visible');
    return false;
  }

  // Check for bypass permissions prompt
  const bypassPattern = /bypass permissions/i;
  if (lastNLines.some(line => bypassPattern.test(line))) {
    return true;
  }

  // Check for known idle hint patterns (Claude's autocomplete suggestions)
  // These appear after the prompt but aren't user input
  const idleHintPatterns = [
    /Press up to edit/i,
    /queued messages/i,
    /Press enter to send/i,
    /Type a message/i,
    /How can I help/i,
    /\d+\s*files?\s*[+\-]\d+/i,     // "12 files +553 -111" git stats
    /[+]\d+\s*[-]\d+/,              // "+553 -111" shorthand
    /\d+\s*insertions?/i,           // "553 insertions"
    /\d+\s*deletions?/i,            // "111 deletions"
  ];

  for (const line of lastNLines) {
    if (line.includes('❯') || line.includes('⏵') || line.includes('>')) {
      // Found prompt line - check if remaining text is a known hint
      for (const pattern of idleHintPatterns) {
        if (pattern.test(line)) {
          log.debug('tmux', 'Claude idle: recognized hint text pattern');
          return true;
        }
      }
    }
  }

  // Check for idle prompt with color-aware autocomplete detection
  // Find prompt line in color output and check if text after is dim (autocomplete)
  const colorLines = colorOutput.split('\n');

  for (const colorLine of colorLines.slice(-10)) {
    // Look for prompt character (❯ encoded as UTF-8 in escape output)
    // The prompt shows as: [reset codes]❯ [cursor][dim]autocomplete_text
    const hasPrompt = colorLine.includes('❯') || colorLine.includes('⏵') ||
                      colorLine.includes('\u276f') || // ❯
                      /M-bM-\^]M-\//.test(colorLine); // UTF-8 encoded ❯

    if (!hasPrompt) continue;

    // Found a prompt line - check what's after it
    // Dim text escape codes: \x1b[2m or \x1b[0;2m
    // If there's text after prompt that's NOT preceded by dim code, user is typing

    // Split on the prompt character position
    const promptMatch = colorLine.match(/([❯⏵>]|M-bM-\^]M-\/)\s*/);
    if (!promptMatch) continue;

    const afterPrompt = colorLine.slice(colorLine.indexOf(promptMatch[0]) + promptMatch[0].length);

    // Strip escape codes to get plain text
    const plainAfter = afterPrompt.replace(/\x1b\[[0-9;]*m/g, '').replace(/\^?\[\[[0-9;]*m/g, '').trim();

    if (!plainAfter) {
      // Nothing after prompt (or only whitespace) - idle
      log.debug('tmux', 'Claude idle: empty prompt');
      return true;
    }

    // Check if the text after prompt is all dim (autocomplete)
    // Dim starts with \x1b[2m or \x1b[0;2m, shown as ^[[2m or ^[[0;2m in cat -v
    const hasDimCode = /(\x1b\[2m|\x1b\[0;2m|\^\[\[2m|\^\[\[0;2m)/.test(afterPrompt);

    // Check for cursor position (reverse video ^[[7m) - text before cursor is typed
    const cursorMatch = afterPrompt.match(/\x1b\[7m|\^\[\[7m/);

    if (cursorMatch) {
      // Cursor is on the line - check if it's at the start (no typed text)
      const beforeCursor = afterPrompt.slice(0, afterPrompt.indexOf(cursorMatch[0]));
      const plainBefore = beforeCursor.replace(/\x1b\[[0-9;]*m/g, '').replace(/\^?\[\[[0-9;]*m/g, '').trim();

      if (!plainBefore) {
        // Cursor at start, everything after is autocomplete - idle
        log.debug('tmux', 'Claude idle: cursor at start, only autocomplete');
        return true;
      } else {
        // User has typed text before cursor - not idle
        log.debug('tmux', 'Claude not idle: typed text detected', {
          plainBefore: plainBefore.slice(0, 30)
        });
        return false;
      }
    }

    // No cursor found - if all text is dim, it's autocomplete
    if (hasDimCode) {
      log.debug('tmux', 'Claude idle: all dim text (autocomplete)');
      return true;
    }

    // Non-dim text after prompt - user typed something
    log.debug('tmux', 'Claude not idle: non-dim text after prompt');
    return false;
  }

  // No prompt found - not idle
  if (idleCheckLogCount <= 10) {
    log.info('tmux', 'Claude not idle: no prompt found', {
      lastLine: JSON.stringify(lastLine.slice(-80)),
      lineCount: lines.length,
    });
  }

  return false;
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
  const sent = tmux.sendLiteral(prompt);
  if (!sent) {
    log.warn('injector', 'Failed to send literal text');
    return false;
  }

  // Pause 500ms before sending Enter to allow tmux to process
  try {
    execSync('sleep 0.5', { stdio: 'pipe' });
  } catch {
    log.warn('injector', 'Sleep failed (non-fatal)');
  }

  const entered = tmux.sendEnter();
  if (!entered) {
    log.warn('injector', 'Failed to send Enter key');
    return false;
  }

  // Reset idle detection state after successful injection
  resetIdleState();

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

/**
 * Get the client activity timestamp from tmux
 * Returns Unix timestamp of last client input
 */
export function getClientActivity(tmux: TmuxSession): number {
  try {
    const result = execSync(
      `tmux display-message -t '${tmux.name}' -p '#{client_activity}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return parseInt(result, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if user is currently typing in the tmux session
 *
 * Samples client_activity, waits for debounce period, then checks if activity changed.
 * If activity timestamp changed during wait, user is still typing.
 */
export async function isUserTyping(tmux: TmuxSession, debounceMs = 5000): Promise<boolean> {
  const activity = getClientActivity(tmux);
  const now = Math.floor(Date.now() / 1000);

  // If last activity was more than debounceMs ago, user is idle
  if ((now - activity) * 1000 >= debounceMs) {
    return false;
  }

  // Recent activity detected, wait and check if it continues
  await sleep(debounceMs);
  const newActivity = getClientActivity(tmux);

  // Still typing if activity changed during the wait
  return newActivity !== activity;
}

/**
 * Wait for user to stop typing before proceeding
 *
 * Polls client_activity with debounce until user is idle, or max wait exceeded.
 * Returns true if user is idle, false if timeout reached (will inject anyway).
 */
export async function waitForUserIdle(
  tmux: TmuxSession,
  options: { debounceMs?: number; maxWaitMs?: number } = {}
): Promise<boolean> {
  const debounceMs = options.debounceMs ?? parseInt(process.env.TX_INJECT_DEBOUNCE_MS || '5000', 10);
  const maxWaitMs = options.maxWaitMs ?? parseInt(process.env.TX_INJECT_MAX_WAIT_MS || '60000', 10);
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const typing = await isUserTyping(tmux, debounceMs);

    if (!typing) {
      log.debug('tmux', 'User is idle, proceeding with injection');
      return true;  // User is idle
    }

    log.debug('tmux', 'User still typing, waiting...', {
      elapsed: Date.now() - startTime,
      maxWait: maxWaitMs
    });
  }

  log.warn('tmux', 'Max wait exceeded, injecting anyway', { maxWaitMs });
  return false;  // Timed out but will inject anyway
}

/**
 * Status bar state for tmux display
 */
export type StatusBarState = 'IDLE' | 'BUSY' | 'AWAIT' | 'RETRY';

interface StatusBarData {
  state: StatusBarState;
  retryAttempt?: number;
  pendingCount?: number;       // legacy - keep for compat
  activeWorkers?: number;
  suspendedCount?: number;
  messagesForCore?: number;    // pending-for-core.json count (unread)
  pendingAsks?: number;        // ask-human count awaiting response
  outgoingTasks?: number;      // tasks sent from core awaiting completion
}

// Status file path - set by init, defaults to cwd-relative
let statusFilePath = '.ai/tx/status.txt';

/**
 * Initialize status file path with absolute project directory
 */
export function initStatusFile(workDir: string): void {
  statusFilePath = path.join(workDir, '.ai', 'tx', 'status.txt');
}

/**
 * Write session state to status file for tmux status bar display
 */
export function writeStatusBar(data: StatusBarData): void {
  try {
    const parts: string[] = [];

    // State with retry count if applicable
    if (data.state === 'RETRY' && data.retryAttempt) {
      parts.push(`RETRY:${data.retryAttempt}`);
    } else {
      parts.push(data.state);
    }

    // Messages for core (unread)
    if (data.messagesForCore !== undefined && data.messagesForCore > 0) {
      parts.push(`${data.messagesForCore}📨`);
    }

    // Outgoing tasks from core awaiting completion
    if (data.outgoingTasks !== undefined && data.outgoingTasks > 0) {
      parts.push(`${data.outgoingTasks}📤`);
    }

    // Pending ask-human messages
    if (data.pendingAsks !== undefined && data.pendingAsks > 0) {
      parts.push(`${data.pendingAsks}❓`);
    }

    // Pending messages (legacy)
    if (data.pendingCount !== undefined && data.pendingCount > 0) {
      parts.push(`${data.pendingCount}⏳`);
    }

    // Active workers
    if (data.activeWorkers !== undefined && data.activeWorkers > 0) {
      parts.push(`${data.activeWorkers}🔧`);
    }

    // Suspended/awaiting
    if (data.suspendedCount !== undefined && data.suspendedCount > 0) {
      parts.push(`${data.suspendedCount}💤`);
    }

    const statusText = parts.join(' │ ');
    fs.writeFileSync(statusFilePath, statusText);
  } catch (err) {
    // Non-fatal - status bar is nice-to-have
    log.debug('tmux', 'Failed to write status bar', { error: String(err) });
  }
}

/**
 * Clear status bar file
 */
export function clearStatusBar(): void {
  try {
    if (fs.existsSync(statusFilePath)) {
      fs.unlinkSync(statusFilePath);
    }
  } catch {
    // Ignore
  }
}

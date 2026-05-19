/**
 * ClaudeCliAdapter — wraps the `claude` CLI for use in TmuxCliRunner.
 *
 * Capabilities: sessionResume + structuredTranscript + shell-script hooks
 * + full-hooks trust tier. The reference implementation against which the
 * CliAdapter interface was designed.
 *
 * Notes on the transcript format:
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl
 *
 *   <slug> is the absolute workDir with `/` → `-` and non-[A-Za-z0-9_-] chars
 *   sanitized. E.g. `/home/user/tx` → `-home-user-tx`. If the algorithm shifts
 *   in a future claude release, we fall back to "newest matching directory
 *   whose basename appears in the workDir path."
 *
 *   Each line is a JSON object with shape:
 *     { type: 'user'|'assistant'|'system'|'summary', message: { role, content: ContentBlock[] }, sessionId, ... }
 *
 *   ContentBlock matches Anthropic's wire format, so we can map directly to
 *   our ProviderContent types.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import type { ProviderContent, ProviderMessage } from '../llm/provider.ts';
import {
  DEFAULT_INTERRUPT_KEY,
  type CliAdapter,
  type CliAdapterCapabilities,
  type CliResumeOptions,
  type CliTaskOptions,
  type DiscoveryResult,
  type HookSpec,
  type TranscriptCursor,
  type TranscriptRead,
} from './adapter.ts';

/* ---------------------------------------------------------------- slug util */

/** Convert an absolute workDir into the claude `~/.claude/projects/<slug>` form. */
export function workDirSlug(workDir: string): string {
  const abs = path.resolve(workDir);
  // Replace every char outside [A-Za-z0-9_] with '-' (matches claude's
  // behavior at time of writing; verified empirically). Path separators,
  // dots, spaces all collapse to '-'.
  return abs.replace(/[^a-zA-Z0-9_]/g, '-');
}

/** Project directory under `~/.claude/projects/`. */
export function claudeProjectDir(workDir: string, home: string = os.homedir()): string {
  return path.join(home, '.claude', 'projects', workDirSlug(workDir));
}

/* ------------------------------------------------------------------ Discovery */

const POSSIBLE_BINARY_PATHS = [
  '/usr/local/share/npm-global/bin/claude',
  path.join(os.homedir(), '.claude/local/claude'),
];

function findBinary(): string | null {
  for (const p of POSSIBLE_BINARY_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const w = execSync('which claude', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (w && fs.existsSync(w)) return w;
  } catch {
    // not in PATH
  }
  return null;
}

function getVersion(binary: string): string {
  try {
    return execSync(`${binary} --version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).trim();
  } catch {
    return 'unknown';
  }
}

/* --------------------------------------------------------------- Pure idle */

/**
 * Pure-function port of `core/tmux.ts`'s `isClaudeIdle`. Takes captured pane
 * text and decides if the claude TUI is awaiting input. No TmuxSession dep —
 * the runner does the capture, this adapter just classifies.
 */
export function isClaudePaneIdle(paneContent: string): boolean {
  const lines = paneContent.split('\n').filter(l => l.trim());
  // Drop box-drawing borders and the [##] msgs status bar.
  const contentLines = lines.filter(l => {
    const t = l.trim();
    if (/^[─━═┃│┌┐└┘├┤┬┴┼╭╮╯╰\-|+]+$/.test(t)) return false;
    if (/^\[##\]\s+\d+\s+msgs/.test(t)) return false;
    return true;
  });
  const lastN = contentLines.slice(-10);

  // BUSY signal 1: active processing indicator ("esc to interrupt/cancel")
  if (lastN.some(l => /esc to (interrupt|cancel)/i.test(l))) return false;

  // BUSY signal 2: spinner glyphs / pending tokens visible
  // (Conservative — claude shows ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ when working.)
  if (lastN.some(l => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(l))) return false;

  // BUSY signal 3: tool execution status lines ("Running command:", etc.)
  if (lastN.some(l => /^(Running|Executing|Reading|Writing|Editing|Searching)\s/i.test(l))) return false;

  // Otherwise: idle (caller is responsible for not flooding inputs while typing)
  return true;
}

/* ------------------------------------------------------------ Transcript parse */

interface ClaudeTranscriptLine {
  type?: string;
  message?: {
    role?: 'user' | 'assistant';
    content?: ClaudeContentBlock[] | string;
  };
  sessionId?: string;
}

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ClaudeContentBlock[]; is_error?: boolean }
  | { type: string; [k: string]: unknown };

function blockToProviderContent(b: ClaudeContentBlock): ProviderContent | null {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: (b as { text: string }).text };
    case 'tool_use': {
      const tu = b as { id: string; name: string; input: Record<string, unknown> };
      return { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input ?? {} };
    }
    case 'tool_result': {
      const tr = b as { tool_use_id: string; content: string | ClaudeContentBlock[]; is_error?: boolean };
      const content: string | ProviderContent[] = typeof tr.content === 'string'
        ? tr.content
        : (tr.content.map(blockToProviderContent).filter((c): c is ProviderContent => c !== null));
      return {
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content,
        ...(tr.is_error !== undefined ? { is_error: tr.is_error } : {}),
      };
    }
    default:
      return null;  // unknown block type; drop silently
  }
}

/** Parse a chunk of JSONL transcript into ProviderMessages. */
export function parseClaudeTranscript(text: string): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: ClaudeTranscriptLine;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;  // malformed line, skip
    }
    if (parsed.type !== 'user' && parsed.type !== 'assistant') continue;
    const role = parsed.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const raw = parsed.message?.content;
    let content: ProviderContent[];
    if (typeof raw === 'string') {
      content = [{ type: 'text', text: raw }];
    } else if (Array.isArray(raw)) {
      content = raw.map(blockToProviderContent).filter((c): c is ProviderContent => c !== null);
    } else {
      continue;
    }
    if (content.length === 0) continue;
    out.push({ role, content });
  }
  return out;
}

/* --------------------------------------------------------------- The adapter */

export interface ClaudeCliAdapterOptions {
  /** Override binary discovery for tests. */
  binaryOverride?: string | null;
  /** Override `os.homedir()` for tests. */
  homedirOverride?: string;
}

export class ClaudeCliAdapter implements CliAdapter {
  readonly name = 'claude';
  readonly capabilities: CliAdapterCapabilities = {
    sessionResume: true,
    structuredTranscript: true,
    hookSupport: 'shell-scripts',
    trustTier: 'full-hooks',
  };

  private readonly binaryOverride: string | null | undefined;
  private readonly home: string;

  constructor(opts: ClaudeCliAdapterOptions = {}) {
    this.binaryOverride = opts.binaryOverride;
    this.home = opts.homedirOverride ?? os.homedir();
  }

  async discover(): Promise<DiscoveryResult | null> {
    const binary = this.binaryOverride !== undefined ? this.binaryOverride : findBinary();
    if (!binary) return null;
    return { binary, version: getVersion(binary) };
  }

  buildArgs(opts: CliTaskOptions): string[] {
    const binary = this.binaryOverride ?? findBinary() ?? 'claude';
    const args: string[] = [binary];
    // We use claude in interactive mode inside tmux. cwd is set via tmux,
    // so we don't pass --cwd; just any model selection.
    if (opts.model) args.push('--model', opts.model);
    return args;
  }

  buildResumeArgs(opts: CliResumeOptions): string[] {
    if (!this.capabilities.sessionResume) {
      throw new Error('claude adapter built with sessionResume disabled');
    }
    const binary = this.binaryOverride ?? findBinary() ?? 'claude';
    const args: string[] = [binary, '--resume', opts.sessionId];
    if (opts.model) args.push('--model', opts.model);
    return args;
  }

  envOverrides(_opts: CliTaskOptions): Record<string, string> {
    const env: Record<string, string> = {};
    // Pass through anthropic API key only if explicitly set — never inject.
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    return env;
  }

  transcriptPath(workDir: string, sessionId?: string): string | null {
    if (!sessionId) return null;
    return path.join(claudeProjectDir(workDir, this.home), `${sessionId}.jsonl`);
  }

  async readTranscript(filePath: string, cursor?: TranscriptCursor): Promise<TranscriptRead> {
    const start = cursor?.byteOffset ?? 0;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return { messages: [], cursor: cursor ?? { byteOffset: 0 }, done: false };
    }
    if (stat.size <= start) {
      return { messages: [], cursor: { byteOffset: stat.size }, done: false };
    }
    // Read incremental slice — only the new bytes since the cursor.
    let chunk: string;
    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch (err) {
      log.warn('claude-adapter', 'readTranscript failed', { file: filePath, error: String(err) });
      return { messages: [], cursor: cursor ?? { byteOffset: 0 }, done: false };
    }
    // If the chunk ends mid-line, back the cursor up to the last newline so
    // we re-read the partial line next time.
    const lastNewline = chunk.lastIndexOf('\n');
    let parsed: string;
    let nextOffset: number;
    if (lastNewline === -1) {
      // No complete line yet — nothing to emit, hold cursor at `start`.
      return { messages: [], cursor: { byteOffset: start }, done: false };
    }
    parsed = chunk.slice(0, lastNewline + 1);
    nextOffset = start + Buffer.byteLength(parsed, 'utf8');

    const messages = parseClaudeTranscript(parsed);
    return { messages, cursor: { byteOffset: nextOffset }, done: false };
  }

  async extractSessionId(transcriptPath: string): Promise<string | null> {
    // Filename stem is the session id.
    const base = path.basename(transcriptPath);
    const m = base.match(/^([0-9a-fA-F-]{8,})\.jsonl$/);
    return m ? m[1] : null;
  }

  isIdle(paneContent: string): boolean {
    return isClaudePaneIdle(paneContent);
  }

  async installHooks(workDir: string, hooks: HookSpec[]): Promise<void> {
    const dir = path.join(workDir, '.claude');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const settingsPath = path.join(dir, 'settings.local.json');

    // Read existing settings (so we don't clobber user config).
    let existing: { hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> } = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        existing = {};
      }
    }

    // Group our hooks by event, preserving any user-provided ones.
    const byEvent: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> = {};
    for (const ev of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit'] as const) {
      byEvent[ev] = existing.hooks?.[ev] ?? [];
    }
    for (const spec of hooks) {
      byEvent[spec.event].push({
        ...(spec.toolMatch ? { matcher: spec.toolMatch } : {}),
        hooks: [{ type: 'command', command: spec.script }],
      });
    }

    const out = { ...existing, hooks: byEvent };
    fs.writeFileSync(settingsPath, JSON.stringify(out, null, 2));
  }

  interruptKey(): string {
    return DEFAULT_INTERRUPT_KEY;
  }
}

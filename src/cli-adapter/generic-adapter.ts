/**
 * GenericCliAdapter — configuration-driven CliAdapter for any tmux-runnable
 * CLI agent. The fastest way to add support for a new tool: a factory call,
 * no TypeScript per-tool.
 *
 * Defaults are conservative (boundary-only trust, no resume, no transcript)
 * so even minimal configs are safe — the runner falls back to pane-text
 * observation and tears down via the kill ladder.
 *
 * Override only what you know about the tool. The factory accepts:
 *   - name              required, the adapter identifier
 *   - binary            required, path or PATH-relative command
 *   - argv              shape of the spawn argv (defaults to [binary])
 *   - resumeArgv        omit to opt out of resume
 *   - transcriptDir     omit to opt out of transcript parsing (pane only)
 *   - transcriptParser  required if transcriptDir is set
 *   - idleHints         regex(es) that indicate the tool is busy; absent → assume idle
 *   - capabilities      overrides over the conservative defaults
 *   - env               static env vars to inject
 *
 * For comparison: `ClaudeCliAdapter` is the bespoke alternative with full
 * hook installation, claude-specific transcript parsing, etc. Use bespoke
 * adapters when the tool warrants close integration; use this factory for
 * everything else.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import type { ProviderMessage } from '../llm/provider.ts';
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

export interface GenericCliAdapterConfig {
  /** Adapter identifier: 'codex' | 'aider' | 'my-tool' | … */
  name: string;
  /** Binary path or PATH-relative command (e.g. '/usr/local/bin/codex' or 'codex'). */
  binary: string;
  /** Optional version flag (default '--version'). Set to null to skip version probing. */
  versionArg?: string | null;

  /** Argv builder for a new task. Default returns `[binary]` plus model if set. */
  argv?: (opts: CliTaskOptions) => string[];
  /** Argv builder for resume. Omit (or undefined) to opt out of session resume. */
  resumeArgv?: (opts: CliResumeOptions) => string[];
  /** Env vars to merge with the spawn env. */
  env?: (opts: CliTaskOptions) => Record<string, string>;

  /**
   * Directory under which the tool writes its transcripts.
   * Receives the workDir; return a string path or null if no transcript dir.
   */
  transcriptDir?: (workDir: string) => string | null;
  /** Glob-like extension to look for inside transcriptDir (default '.jsonl'). */
  transcriptExt?: string;
  /** Required when transcriptDir is set: parse a text chunk into messages. */
  transcriptParser?: (chunk: string) => ProviderMessage[];
  /** Extract a session id from a transcript filename (default: filename stem). */
  sessionIdFromPath?: (path: string) => string | null;

  /** Regex(es) that indicate the tool is busy in the pane. Absent → always idle. */
  idleHints?: RegExp[];
  /**
   * Override the default conservative capabilities. Note: settings here
   * must be consistent with the rest of the config (e.g. don't claim
   * `sessionResume: true` without supplying `resumeArgv`).
   */
  capabilities?: Partial<CliAdapterCapabilities>;
  /** Override the default interrupt key (C-c). */
  interruptKey?: string;
}

export function createGenericCliAdapter(config: GenericCliAdapterConfig): CliAdapter {
  const caps: CliAdapterCapabilities = {
    sessionResume: !!config.resumeArgv,
    structuredTranscript: !!config.transcriptDir && !!config.transcriptParser,
    hookSupport: 'none',
    trustTier: 'sandbox-only',
    ...config.capabilities,
  };

  // Consistency guards — fail fast at construction time rather than producing
  // a subtly broken adapter that misbehaves later.
  if (caps.sessionResume && !config.resumeArgv) {
    throw new Error(`${config.name}: capabilities.sessionResume=true but no resumeArgv supplied`);
  }
  if (caps.structuredTranscript && !config.transcriptParser) {
    throw new Error(`${config.name}: capabilities.structuredTranscript=true but no transcriptParser supplied`);
  }

  const transcriptExt = config.transcriptExt ?? '.jsonl';

  return {
    name: config.name,
    capabilities: caps,

    async discover(): Promise<DiscoveryResult | null> {
      let binary = config.binary;
      // Absolute path? Check existence directly.
      if (binary.startsWith('/')) {
        if (!fs.existsSync(binary)) return null;
      } else {
        try {
          binary = execSync(`which ${binary}`, {
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000,
          }).trim();
          if (!binary || !fs.existsSync(binary)) return null;
        } catch {
          return null;
        }
      }

      let version = 'unknown';
      if (config.versionArg !== null) {
        const arg = config.versionArg ?? '--version';
        try {
          version = execSync(`${binary} ${arg}`, {
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000,
          }).trim();
        } catch {
          // version probe failed; we still consider the binary usable
        }
      }
      return { binary, version };
    },

    buildArgs(opts: CliTaskOptions): string[] {
      if (config.argv) return config.argv(opts);
      const args = [config.binary];
      if (opts.model) args.push('--model', opts.model);
      return args;
    },

    buildResumeArgs(opts: CliResumeOptions): string[] {
      if (!config.resumeArgv) {
        throw new Error(`${config.name}: session resume not supported`);
      }
      return config.resumeArgv(opts);
    },

    envOverrides(opts: CliTaskOptions): Record<string, string> {
      return config.env ? config.env(opts) : {};
    },

    transcriptPath(workDir: string, sessionId?: string): string | null {
      if (!config.transcriptDir || !sessionId) return null;
      const dir = config.transcriptDir(workDir);
      if (!dir) return null;
      return path.join(dir, `${sessionId}${transcriptExt}`);
    },

    async readTranscript(filePath: string, cursor?: TranscriptCursor): Promise<TranscriptRead> {
      if (!config.transcriptParser) {
        return { messages: [], cursor: cursor ?? { byteOffset: 0 }, done: false };
      }
      const start = cursor?.byteOffset ?? 0;
      let stat: fs.Stats;
      try { stat = fs.statSync(filePath); } catch {
        return { messages: [], cursor: cursor ?? { byteOffset: 0 }, done: false };
      }
      if (stat.size <= start) return { messages: [], cursor: { byteOffset: stat.size }, done: false };

      let chunk: string;
      try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        chunk = buf.toString('utf8');
      } catch (err) {
        log.warn('generic-cli-adapter', 'readTranscript failed', { adapter: config.name, error: String(err) });
        return { messages: [], cursor: cursor ?? { byteOffset: 0 }, done: false };
      }
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline === -1) {
        return { messages: [], cursor: { byteOffset: start }, done: false };
      }
      const parsed = chunk.slice(0, lastNewline + 1);
      const nextOffset = start + Buffer.byteLength(parsed, 'utf8');
      const messages = config.transcriptParser(parsed);
      return { messages, cursor: { byteOffset: nextOffset }, done: false };
    },

    async extractSessionId(transcriptPath: string): Promise<string | null> {
      if (config.sessionIdFromPath) return config.sessionIdFromPath(transcriptPath);
      const base = path.basename(transcriptPath);
      const ext = transcriptExt;
      if (!base.endsWith(ext)) return null;
      return base.slice(0, -ext.length);
    },

    isIdle(pane: string): boolean {
      if (!config.idleHints || config.idleHints.length === 0) return true;
      // Busy iff any hint matches; idle otherwise.
      return !config.idleHints.some(re => re.test(pane));
    },

    // installHooks intentionally omitted; capabilities.hookSupport='none' enforces this.

    interruptKey(): string {
      return config.interruptKey ?? DEFAULT_INTERRUPT_KEY;
    },
  } satisfies CliAdapter;
}

/* ---------------------------------- Example: a minimal codex configuration -- */

/**
 * Reference configuration for the `codex` CLI. Conservative defaults —
 * resume is opt-in (off), no transcript parsing, idle inferred from busy
 * hints only. Refine in-place when verified against the real tool, or
 * replace with a bespoke `CodexCliAdapter` if you need close integration.
 *
 * Not registered by default — `start.ts` registers it only if you uncomment
 * the entry there or wire it via your own startup script.
 */
export const CODEX_REFERENCE_CONFIG: GenericCliAdapterConfig = {
  name: 'codex',
  binary: 'codex',
  versionArg: '--version',
  idleHints: [
    /thinking\.\.\./i,
    /executing/i,
    /running command/i,
  ],
};

/**
 * Reference configuration for `opencode`. Same caveats as codex —
 * intentionally minimal until verified against the tool.
 */
export const OPENCODE_REFERENCE_CONFIG: GenericCliAdapterConfig = {
  name: 'opencode',
  binary: 'opencode',
  versionArg: '--version',
};

/**
 * Reference configuration for `pi-mono`. Same caveats as codex/opencode —
 * intentionally minimal until verified against the tool. Refine `binary`,
 * `argv`, `idleHints`, `transcriptDir`, etc. in-place once the actual CLI
 * surface is known.
 */
export const PI_MONO_REFERENCE_CONFIG: GenericCliAdapterConfig = {
  name: 'pi-mono',
  binary: 'pi-mono',
  versionArg: '--version',
};

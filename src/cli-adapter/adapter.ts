/**
 * CliAdapter — describes how to drive an external CLI agent tool.
 *
 * One adapter per tool (claude, codex, opencode, aider, crush, …). The
 * `TmuxCliRunner` is generic over a `CliAdapter`, so adding support for a
 * new tool is a single new file plus tests — no runner changes.
 *
 * The interface is intentionally tight: enough to launch, resume, observe,
 * interrupt. Tool-specific quirks (permission TUI shapes, in-tool hook
 * mechanisms, env var conventions) live inside each adapter implementation,
 * never in the runner.
 *
 * Transcript output is normalized to `ProviderMessage[]` (from the LLM tier)
 * so both runtime paths — wrapped-CLI and native AgentLoop — emit the same
 * message types downstream.
 */

import type { ProviderMessage } from '../llm/provider.ts';

/* ------------------------------------------------------------- Capabilities */

/**
 * Static description of what a tool supports. The runner consults these to
 * decide what to expect (resume vs. fresh-only) and how strictly to fence
 * the workdir (full-hooks → light fence, sandbox-only → tight fence).
 */
export interface CliAdapterCapabilities {
  /** Tool supports resuming a session by ID. */
  sessionResume: boolean;
  /** Tool writes a machine-readable transcript we can parse incrementally. */
  structuredTranscript: boolean;
  /**
   * How the tool exposes user-defined hooks:
   *   'none'          — no hook mechanism; rely entirely on sandbox boundary
   *   'shell-scripts' — files in a config directory (e.g. .claude/hooks/*)
   *   'native'        — hook callbacks registered via the tool's own API
   */
  hookSupport: 'none' | 'shell-scripts' | 'native';
  /**
   * Trust tier — informs runner-side sandbox tightness:
   *   'full-hooks'   — tool enforces in-tool guardrails (e.g. claude w/ hooks)
   *   'sandbox-only' — only the OS/tmux fence guards us
   *   'read-only'    — runner refuses to grant write access
   */
  trustTier: 'full-hooks' | 'sandbox-only' | 'read-only';
}

/* ----------------------------------------------------------------- Discovery */

export interface DiscoveryResult {
  /** Absolute path to the binary. */
  binary: string;
  /** Version string as the tool reports it (best-effort). */
  version: string;
}

/* ------------------------------------------------------------------ Launching */

export interface CliTaskOptions {
  /** The initial user message / task description. */
  task: string;
  /** Working directory the tool should operate in. */
  workDir: string;
  /** Tool-specific model identifier (already resolved via provider config). */
  model?: string;
  /** Path to a file containing the system prompt (if the tool accepts one). */
  systemPromptFile?: string;
  /** Per-run data directory for adapter scratch state (e.g. installed hooks). */
  txDataDir: string;
}

export interface CliResumeOptions extends CliTaskOptions {
  /** Session id previously returned via `extractSessionId`. */
  sessionId: string;
  /** New message to inject upon resume. */
  followUp?: string;
}

/* ---------------------------------------------------------------- Transcript */

export interface TranscriptCursor {
  /** Byte offset for incremental reads of a growing transcript file. */
  byteOffset: number;
}

export interface TranscriptRead {
  /** Messages parsed since the last cursor (empty if no new content). */
  messages: ProviderMessage[];
  /** Cursor to pass back on the next read. */
  cursor: TranscriptCursor;
  /** True when the transcript indicates the tool has exited cleanly. */
  done: boolean;
}

/* ------------------------------------------------------- Permission prompts */

export interface DetectedPermissionPrompt {
  /** Stable identifier of what kind of prompt this is — 'tool-use', 'overwrite', etc. */
  kind: string;
  /** Verbatim text from the pane for surfacing to the user. */
  details: string;
}

/* --------------------------------------------------------------- Hook specs */

/**
 * In-tool hook installation request. Only adapters with `hookSupport !== 'none'`
 * accept these; others should refuse the install (returns false / throws).
 */
export interface HookSpec {
  event: 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit';
  /** Optional tool-name glob (e.g. 'Bash' or 'Edit'). */
  toolMatch?: string;
  /** Absolute path to an executable script the tool will invoke. */
  script: string;
}

/* ------------------------------------------------------------------ Adapter */

export interface CliAdapter {
  /** Stable identifier — 'claude', 'codex', 'opencode', 'aider', etc. */
  readonly name: string;

  readonly capabilities: CliAdapterCapabilities;

  /**
   * Locate the binary and confirm it's runnable. Return null if absent or
   * unusable; the runner uses this to fall back / refuse spawn.
   */
  discover(): Promise<DiscoveryResult | null>;

  /** Argv for a new task. The runner spawns `argv[0]` with `argv.slice(1)`. */
  buildArgs(opts: CliTaskOptions): string[];

  /**
   * Argv for resuming a prior session. Implementations that don't support
   * resume (capabilities.sessionResume === false) should throw.
   */
  buildResumeArgs(opts: CliResumeOptions): string[];

  /** Env vars to merge with the spawn env. May include API keys / config dirs. */
  envOverrides(opts: CliTaskOptions): Record<string, string>;

  /**
   * Where the tool writes its transcript. May be absent if the session hasn't
   * started yet, or if the tool doesn't write one (capabilities.structuredTranscript=false).
   */
  transcriptPath(workDir: string, sessionId?: string): string | null;

  /**
   * Read new transcript entries since `cursor`. Returns parsed messages plus
   * an updated cursor for the next call. Idempotent on the same cursor.
   */
  readTranscript(path: string, cursor?: TranscriptCursor): Promise<TranscriptRead>;

  /**
   * Try to extract the tool's session ID. Adapters with structuredTranscript
   * typically parse it from the file or filename; others may scrape the pane.
   */
  extractSessionId(transcriptPath: string): Promise<string | null>;

  /** Heuristic: is the pane idle (awaiting user input, no tool running)? */
  isIdle(paneContent: string): boolean;

  /**
   * Detect a HITL permission prompt in the pane. Optional — only useful for
   * tools without a hook system that need user confirmation surfaced.
   */
  detectPermissionPrompt?(paneContent: string): DetectedPermissionPrompt | null;

  /**
   * Install hook scripts the tool will invoke. Only adapters with
   * `hookSupport !== 'none'` should implement this.
   */
  installHooks?(workDir: string, hooks: HookSpec[]): Promise<void>;

  /**
   * Tmux send-keys argument used to interrupt the tool. Defaults to 'C-c'
   * if the adapter doesn't override.
   */
  interruptKey?(): string;
}

/* --------------------------------------------------------------- Registry */

/**
 * Adapter registry — chooses an adapter by name. Populated at runner-factory
 * time so the dispatcher can resolve `agent.runner: 'codex'` → `CodexCliAdapter`.
 */
export class CliAdapterRegistry {
  private readonly adapters = new Map<string, CliAdapter>();

  register(adapter: CliAdapter): this {
    this.adapters.set(adapter.name, adapter);
    return this;
  }

  get(name: string): CliAdapter | undefined {
    return this.adapters.get(name);
  }

  names(): string[] {
    return Array.from(this.adapters.keys());
  }
}

/** Default interrupt key when an adapter doesn't override. */
export const DEFAULT_INTERRUPT_KEY = 'C-c';

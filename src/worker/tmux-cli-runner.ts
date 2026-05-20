/**
 * TmuxCliRunner — generic Runner that drives any CliAdapter inside tmux.
 *
 * Implements the worker `Runner` interface so the dispatcher treats it
 * interchangeably with SdkRunner / ChromeCliRunner. One adapter per tool
 * (claude, codex, opencode, aider, …); the runner is tool-agnostic.
 *
 * Lifecycle (per `run()`):
 *   1. adapter.discover() — bail if binary missing
 *   2. create tmux session at workerSessionName(runId, agentId)
 *   3. spawn adapter.buildArgs() inside the pane (or interactive shell + send-keys)
 *   4. inject the initial task via send-keys
 *   5. poll: capturePane → adapter.isIdle → adapter.readTranscript → emit
 *   6. on stable idle + no transcript activity: complete
 *   7. tmux kill-session (via kill ladder; verified-dead gate)
 *
 * All tmux operations go through `TmuxIO` for unit-testability; defaults wrap
 * real tmux + spawn. Phase 1 lifecycle (inventory, reaper, kill ladder) is
 * fully reused — this runner registers as `runnerKind: 'tmux'`.
 */

import { EventEmitter } from 'node:events';
import { execSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { log } from '../shared/logger.ts';
import type { WorkerResult, SemanticModel } from '../shared/types.ts';
import type { Runner } from './runner.ts';
import { isGuardrailKill } from './runner.ts';
import type {
  CliAdapter,
  CliTaskOptions,
  TranscriptCursor,
} from '../cli-adapter/adapter.ts';
import { DEFAULT_INTERRUPT_KEY } from '../cli-adapter/adapter.ts';
import type { ProviderMessage } from '../llm/provider.ts';

/* --------------------------------------------------------------- TmuxIO */

/**
 * Tmux + spawn surface used by the runner. Defaulted to real tmux; tests
 * inject a fake to verify orchestration without real processes.
 */
export interface TmuxIO {
  createSession(name: string, workDir: string): boolean;
  sessionExists(name: string): boolean;
  killSession(name: string): boolean;
  sendKeys(name: string, keys: string): boolean;
  /** Type text then send Enter — common case for prompt injection. */
  sendText(name: string, text: string): boolean;
  capturePane(name: string, lines?: number): string;
  /**
   * Launch a process inside the pane. Returns the pid once the tmux
   * send-keys completes; pgid is best-effort (may be null on some systems).
   */
  spawnInSession(name: string, argv: string[], env: Record<string, string>): Promise<{ pid: number | null; pgid: number | null }>;
}

const SAFE_TMUX_NAME = /^[a-zA-Z0-9_.-]+$/;
function escTmuxName(n: string): string {
  if (!SAFE_TMUX_NAME.test(n)) throw new Error(`unsafe tmux name: ${n}`);
  return `'${n}'`;
}

export function defaultTmuxIO(): TmuxIO {
  return {
    createSession(name, workDir) {
      try {
        execSync(`tmux new-session -d -s ${escTmuxName(name)} -c '${workDir}'`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    sessionExists(name) {
      try {
        execSync(`tmux has-session -t ${escTmuxName(name)}`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    killSession(name) {
      try {
        execSync(`tmux kill-session -t ${escTmuxName(name)}`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    sendKeys(name, keys) {
      try {
        execSync(`tmux send-keys -t ${escTmuxName(name)} ${keys}`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    sendText(name, text) {
      try {
        // Use -l (literal) so special chars don't trigger tmux key bindings.
        // The argument is passed as a single argv (no shell expansion) — spawn() handles quoting.
        const child = spawn('tmux', ['send-keys', '-t', name, '-l', text], { stdio: 'pipe' });
        const exit = new Promise<number | null>((resolve) => {
          child.on('close', code => resolve(code));
          child.on('error', () => resolve(-1));
        });
        // Then send Enter as a separate send-keys (no -l so it's interpreted).
        return Promise.resolve(exit).then(() => {
          try {
            execSync(`tmux send-keys -t ${escTmuxName(name)} Enter`, { stdio: 'pipe' });
            return true;
          } catch {
            return false;
          }
        }) as unknown as boolean;
      } catch {
        return false;
      }
    },
    capturePane(name, lines = 30) {
      try {
        return execSync(`tmux capture-pane -t ${escTmuxName(name)} -p -S -${lines}`, {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
        });
      } catch {
        return '';
      }
    },
    async spawnInSession(name, argv, env) {
      // Build the command line with env exports + setsid (own pgid).
      // Use tmux send-keys to type and execute.
      const envExports = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ');
      const cmd = argv.map(shellQuote).join(' ');
      const fullCmd = `${envExports ? envExports + ' ' : ''}setsid ${cmd}`;
      try {
        execSync(`tmux send-keys -t ${escTmuxName(name)} ${shellQuote(fullCmd)} Enter`, { stdio: 'pipe' });
      } catch {
        return { pid: null, pgid: null };
      }
      // Give the shell ~200ms to start the process and then look up the pane pid's child.
      await delay(250);
      try {
        const panePid = parseInt(execSync(`tmux list-panes -t ${escTmuxName(name)} -F '#{pane_pid}'`, {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
        }).trim(), 10);
        if (!Number.isFinite(panePid)) return { pid: null, pgid: null };
        // Try to find the first child of the pane shell — that's the tool process.
        const ps = execSync(`ps --ppid ${panePid} -o pid=,pgid=`, {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000,
        }).trim();
        const firstLine = ps.split('\n').find(l => l.trim().length > 0);
        if (!firstLine) return { pid: panePid, pgid: null };
        const [pidStr, pgidStr] = firstLine.trim().split(/\s+/);
        return { pid: parseInt(pidStr, 10), pgid: parseInt(pgidStr, 10) };
      } catch {
        return { pid: null, pgid: null };
      }
    },
  };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/* ------------------------------------------------------------- Runner config */

export interface TmuxCliRunnerConfig {
  id: string;
  agentId: string;
  workerId: string;
  sessionName: string;
  adapter: CliAdapter;
  model: SemanticModel;
  workDir: string;
  msgsDir: string;
  txDataDir: string;
  /** Initial task message — injected into the tool via send-keys after spawn. */
  task: string;
  /** Optional system prompt file (passed via adapter if it supports it). */
  systemPromptFile?: string;
  /** Override the tmux IO surface (tests). */
  io?: TmuxIO;
  /** Poll interval for pane/transcript watching. Default 500ms. */
  pollIntervalMs?: number;
  /** Idle ticks before we declare done (stable idle window). Default 4 ticks = 2s at 500ms. */
  stableIdleTicks?: number;
  /** Maximum wall time. Default 30min. */
  maxWallMs?: number;
  /** Env to merge with adapter's overrides. */
  env?: Record<string, string>;
}

/* ----------------------------------------------------------------- Runner */

export class TmuxCliRunner extends EventEmitter implements Runner {
  private readonly config: TmuxCliRunnerConfig;
  private readonly io: TmuxIO;
  private readonly pollIntervalMs: number;
  private readonly stableIdleTicks: number;
  private readonly maxWallMs: number;
  private running = false;
  private _killReason: string | null = null;
  private sessionId: string | null = null;
  private pid: number | null = null;
  private pgid: number | null = null;
  private cursor: TranscriptCursor | undefined = undefined;
  private transcriptPath: string | null = null;
  private accumulated: ProviderMessage[] = [];
  private startedAt = 0;

  constructor(config: TmuxCliRunnerConfig) {
    super();
    this.setMaxListeners(25);
    this.config = config;
    this.io = config.io ?? defaultTmuxIO();
    this.pollIntervalMs = config.pollIntervalMs ?? 500;
    this.stableIdleTicks = config.stableIdleTicks ?? 4;
    this.maxWallMs = config.maxWallMs ?? 30 * 60_000;
  }

  async run(): Promise<WorkerResult> {
    this.running = true;
    this.startedAt = Date.now();
    this.emit('start', { id: this.config.id });

    try {
      // 1. Discover the binary.
      const discovery = await this.config.adapter.discover();
      if (!discovery) {
        return this.fail(`adapter '${this.config.adapter.name}' could not discover binary`);
      }
      log.info('tmux-cli-runner', 'discovered', {
        adapter: this.config.adapter.name, binary: discovery.binary, version: discovery.version,
      });

      // 2. Create tmux session in workDir.
      if (!this.io.createSession(this.config.sessionName, this.config.workDir)) {
        return this.fail('failed to create tmux session');
      }

      // 3. Spawn the tool inside the session.
      const taskOpts: CliTaskOptions = {
        task: this.config.task,
        workDir: this.config.workDir,
        model: this.config.model,
        txDataDir: this.config.txDataDir,
        ...(this.config.systemPromptFile ? { systemPromptFile: this.config.systemPromptFile } : {}),
      };
      const argv = this.config.adapter.buildArgs(taskOpts);
      const env = { ...this.config.adapter.envOverrides(taskOpts), ...(this.config.env ?? {}) };
      const launched = await this.io.spawnInSession(this.config.sessionName, argv, env);
      this.pid = launched.pid;
      this.pgid = launched.pgid;
      log.info('tmux-cli-runner', 'spawned', {
        session: this.config.sessionName, pid: this.pid, pgid: this.pgid,
      });
      this.emit('init', { id: this.config.id, sessionId: this.config.sessionName, tools: [] });

      // 4. Inject initial task. The adapter launches an interactive TUI; we
      //    type the task into the prompt.
      await delay(1000);  // give the TUI time to come up
      this.io.sendText(this.config.sessionName, this.config.task);

      // 5. Poll until idle + done or hit caps.
      const result = await this.pollUntilDone();
      return result;
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : String(err));
    } finally {
      // 6. Always tear down the tmux session — kill ladder is the dispatcher's
      //    job via killWorkerVerified; here we do best-effort cleanup if we
      //    haven't already been killed.
      if (!this._killReason && this.io.sessionExists(this.config.sessionName)) {
        this.io.killSession(this.config.sessionName);
      }
      this.running = false;
    }
  }

  private async pollUntilDone(): Promise<WorkerResult> {
    let idleStreak = 0;
    let lastSize = 0;
    let lastChangeAt = Date.now();

    while (this.running) {
      if (this._killReason) {
        return this.exitInterrupted();
      }
      if (Date.now() - this.startedAt > this.maxWallMs) {
        return this.fail(`exceeded maxWallMs ${this.maxWallMs}`);
      }

      const pane = this.io.capturePane(this.config.sessionName, 30);
      const idle = this.config.adapter.isIdle(pane);

      // If we don't yet know the session id, try to discover it (claude
      // writes the transcript dir on first turn).
      if (!this.sessionId) {
        await this.tryDiscoverSession();
      }

      // Read new transcript content if we have a path.
      if (this.transcriptPath) {
        const read = await this.config.adapter.readTranscript(this.transcriptPath, this.cursor);
        if (read.messages.length > 0) {
          this.accumulated.push(...read.messages);
          for (const m of read.messages) {
            const text = this.summarizeMessage(m);
            if (text) this.emit('output', { id: this.config.id, data: text });
          }
          lastChangeAt = Date.now();
        }
        this.cursor = read.cursor;
        if (read.done) {
          return this.complete();
        }
      }

      // Stability check: pane idle AND transcript stable for stableIdleTicks ticks → complete.
      if (idle) {
        const sizeNow = pane.length;
        if (sizeNow === lastSize && (Date.now() - lastChangeAt) >= this.stableIdleTicks * this.pollIntervalMs) {
          idleStreak++;
        } else {
          idleStreak = 0;
        }
        lastSize = sizeNow;
        if (idleStreak >= this.stableIdleTicks) {
          return this.complete();
        }
      } else {
        idleStreak = 0;
      }

      await delay(this.pollIntervalMs);
    }

    return this.exitInterrupted();
  }

  private async tryDiscoverSession(): Promise<void> {
    // Try the adapter's transcript path with no sessionId — most adapters
    // return null, but some can derive it from disk state.
    // Walk the project dir for the most recent .jsonl whose mtime > startedAt.
    // The adapter implements `extractSessionId` against a known path; we just
    // need to find that path.
    const candidate = this.findLatestTranscriptFile();
    if (!candidate) return;
    const sid = await this.config.adapter.extractSessionId(candidate);
    if (sid) {
      this.sessionId = sid;
      this.transcriptPath = candidate;
      log.info('tmux-cli-runner', 'discovered transcript', { sessionId: sid, path: candidate });
    }
  }

  private findLatestTranscriptFile(): string | null {
    // The adapter gives us the directory via transcriptPath(workDir, undefined)
    // returning null — so we need to ask it differently. The convention: the
    // dir containing transcripts is `dirname(transcriptPath(workDir, 'x'))`.
    // We hack that by passing a dummy sessionId.
    const sentinel = this.config.adapter.transcriptPath(this.config.workDir, '__sentinel__');
    if (!sentinel) return null;
    const dir = sentinel.slice(0, sentinel.lastIndexOf('/'));
    let entries: string[];
    try {
      const fs = require('node:fs');
      if (!fs.existsSync(dir)) return null;
      entries = fs.readdirSync(dir).filter((f: string) => f.endsWith('.jsonl'));
    } catch {
      return null;
    }
    if (entries.length === 0) return null;
    // Pick the file with the latest mtime.
    try {
      const fs = require('node:fs');
      const ranked = entries.map(f => ({ f, m: fs.statSync(`${dir}/${f}`).mtimeMs }));
      ranked.sort((a, b) => b.m - a.m);
      const newest = ranked[0];
      // Only consider files modified since this runner started.
      if (newest.m < this.startedAt) return null;
      return `${dir}/${newest.f}`;
    } catch {
      return null;
    }
  }

  private summarizeMessage(m: ProviderMessage): string {
    const parts: string[] = [];
    for (const c of m.content) {
      if (c.type === 'text') parts.push(c.text);
      else if (c.type === 'tool_use') parts.push(`[tool: ${c.name}]`);
      else if (c.type === 'tool_result') parts.push(`[tool_result: ${typeof c.content === 'string' ? c.content.slice(0, 80) : 'structured'}]`);
    }
    return parts.join(' ');
  }

  private complete(): WorkerResult {
    this.running = false;
    const output = this.accumulated.map(m => this.summarizeMessage(m)).join('\n');
    this.emit('complete', {
      id: this.config.id,
      messagesProcessed: this.accumulated.length,
      output,
      sessionId: this.sessionId,
      metrics: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheRead: 0, totalCacheCreation: 0, totalCost: 0, queries: 0 },
    });
    return {
      success: true,
      messagesProcessed: this.accumulated.length,
      output,
      sessionId: this.sessionId ?? undefined,
    };
  }

  private fail(reason: string): WorkerResult {
    this.running = false;
    log.error('tmux-cli-runner', 'failed', { reason });
    this.emit('error', { id: this.config.id, error: reason });
    return { success: false, messagesProcessed: this.accumulated.length, error: reason };
  }

  private exitInterrupted(): WorkerResult {
    this.running = false;
    this.emit('interrupted', { id: this.config.id, sessionId: this.sessionId });
    return {
      success: false,
      messagesProcessed: this.accumulated.length,
      error: `interrupted: ${this._killReason ?? 'unknown'}`,
    };
  }

  /* ----------------------------------------------------------- Runner API */

  kill(reason?: string): void {
    this._killReason = reason ?? 'unspecified';
    log.warn('tmux-cli-runner', 'kill issued', {
      sessionName: this.config.sessionName, reason: this._killReason,
    });
    // Best-effort: send Ctrl-C then kill the session. The dispatcher's
    // killWorkerVerified path runs the full kill ladder with verified-dead
    // gating; this is for callers who want immediate teardown.
    const key = this.config.adapter.interruptKey?.() ?? DEFAULT_INTERRUPT_KEY;
    this.io.sendKeys(this.config.sessionName, key);
    if (this.io.sessionExists(this.config.sessionName)) {
      this.io.killSession(this.config.sessionName);
    }
    this.running = false;
  }

  getKillReason(): string | null { return this._killReason; }
  wasGuardrailKill(): boolean { return isGuardrailKill(this._killReason); }
  getSessionId(): string | null { return this.sessionId; }
  isRunning(): boolean { return this.running; }
  hasActiveQuery(): boolean { return this.running; }

  async interrupt(): Promise<void> {
    this.kill('interrupt');
  }

  async resume(_sessionId: string, _feedback: string): Promise<WorkerResult> {
    // Resume via adapter.buildResumeArgs requires re-spawning. For V1 the
    // dispatcher handles resume by constructing a new TmuxCliRunner with the
    // appropriate session id; this method is a no-op stub.
    log.warn('tmux-cli-runner', 'resume() not implemented on runner — use a fresh runner with adapter.buildResumeArgs');
    return { success: false, messagesProcessed: 0, error: 'resume not supported at runner level' };
  }

  resolvePermission(_toolUseID: string, _allow: boolean, _message?: string): boolean {
    return false;  // boundary-tier; no HITL plumbed
  }
}

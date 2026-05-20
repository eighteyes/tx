/**
 * AgentLoopRunner — Runner impl wrapping the native AgentLoop runtime.
 *
 * The non-CLI path: drives an LlmProvider directly through AgentLoop,
 * with an optional ToolHost (MCP-only by default — built-in tool
 * reimplementation was explicitly cut from the plan when the CLI-wrap
 * runtime landed). For meshes that need built-ins (Read/Write/Edit/Bash),
 * use a CLI-wrapped runner (`agent.cli: 'claude'` etc.); for MCP-only or
 * tool-less meshes, AgentLoopRunner is sufficient.
 *
 * Lifecycle parallels TmuxCliRunner:
 *   run() → AgentLoop.run(task) → emit('start'|'init'|'output'|'complete')
 *   kill(reason) → AbortController.abort(); emit('interrupted')
 *   resume(sid, feedback) → re-run with persisted message history + feedback
 *
 * Phase 2d will plug AgentLoopHooks (preToolUse/postToolUse middleware) so
 * bash-guard / write-gate / read-gate / message-gate / identity-gate /
 * postcondition-validator fire with strict SDK parity. Until then the
 * native runner has no in-proc guardrails — boundary-tier trust only.
 */

import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';
import type { Runner } from './runner.ts';
import { isGuardrailKill } from './runner.ts';
import type { WorkerResult, SemanticModel } from '../shared/types.ts';
import { AgentLoop, type AgentLoopHooks } from '../llm/agent-loop.ts';
import type { LlmProvider, ProviderMessage, ProviderEvent } from '../llm/provider.ts';
import type { ToolHost } from '../llm/tool-host.ts';

export interface AgentLoopRunnerConfig {
  id: string;
  agentId: string;
  provider: LlmProvider;
  /** Optional tool host. Without it, the model can issue no tool calls. */
  toolHost?: ToolHost;
  model: string;
  systemPrompt?: string;
  workDir: string;
  /** Initial task (becomes the first user message). */
  task: string;
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  /** Optional hooks middleware (phase 2d will populate via dispatcher). */
  hooks?: AgentLoopHooks;
}

export class AgentLoopRunner extends EventEmitter implements Runner {
  private readonly config: AgentLoopRunnerConfig;
  private abortController: AbortController | null = null;
  private running = false;
  private _killReason: string | null = null;
  private sessionId: string;
  /** Message history that persists across run()/resume() calls. */
  private history: ProviderMessage[] = [];
  /** Aggregated text output for the WorkerResult. */
  private outputBuf = '';

  constructor(config: AgentLoopRunnerConfig) {
    super();
    this.setMaxListeners(25);
    this.config = config;
    // Synthetic session id — AgentLoop is stateless, runner owns the id.
    this.sessionId = `al-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async run(): Promise<WorkerResult> {
    this.running = true;
    this._killReason = null;
    this.abortController = new AbortController();
    this.emit('start', { id: this.config.id });

    const initial: ProviderMessage[] = this.history.length > 0
      ? [...this.history, { role: 'user', content: [{ type: 'text', text: this.config.task }] }]
      : [{ role: 'user', content: [{ type: 'text', text: this.config.task }] }];

    const loop = new AgentLoop({
      provider: this.config.provider,
      ...(this.config.toolHost ? { toolHost: this.config.toolHost } : {}),
      model: this.config.model,
      ...(this.config.systemPrompt !== undefined ? { system: this.config.systemPrompt } : {}),
      ...(this.config.maxTurns !== undefined ? { maxTurns: this.config.maxTurns } : {}),
      ...(this.config.maxTokens !== undefined ? { maxTokens: this.config.maxTokens } : {}),
      ...(this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
      ...(this.config.stopSequences ? { stopSequences: this.config.stopSequences } : {}),
      ...(this.config.hooks ? { hooks: this.config.hooks } : {}),
      signal: this.abortController.signal,
    });

    // Fire 'init' once the first turn starts so the dispatcher sees a real
    // session even before any tokens come back. Match SdkRunner shape.
    let initEmitted = false;
    loop.on('turn-start', () => {
      if (!initEmitted) {
        initEmitted = true;
        this.emit('init', { id: this.config.id, sessionId: this.sessionId, tools: this.config.toolHost?.list() ?? [] });
      }
    });

    // Stream output events for text deltas; tool calls are visible too.
    loop.on('provider-event', (ev: ProviderEvent) => {
      if (ev.type === 'text-delta') {
        this.outputBuf += ev.delta;
        this.emit('output', { id: this.config.id, data: ev.delta });
      } else if (ev.type === 'tool-use-start') {
        this.emit('output', { id: this.config.id, data: `\n[tool: ${ev.name}]\n` });
      }
    });

    let result;
    try {
      result = await loop.run(initial);
    } catch (err) {
      this.running = false;
      this.abortController = null;
      const msg = err instanceof Error ? err.message : String(err);
      log.error('agent-loop-runner', 'loop threw', { workerId: this.config.id, error: msg });
      this.emit('error', { id: this.config.id, error: msg });
      return { success: false, messagesProcessed: 0, error: msg };
    }

    this.history = result.messages;
    this.running = false;
    this.abortController = null;

    if (result.aborted || result.stopReason === 'error') {
      const reason = this._killReason ?? `stopReason=${result.stopReason}`;
      this.emit('interrupted', { id: this.config.id, sessionId: this.sessionId });
      return {
        success: false,
        messagesProcessed: result.turns,
        error: `interrupted: ${reason}`,
        sessionId: this.sessionId,
      };
    }

    this.emit('complete', {
      id: this.config.id,
      messagesProcessed: result.turns,
      output: this.outputBuf,
      sessionId: this.sessionId,
      metrics: {
        totalInputTokens: result.totalUsage.inputTokens,
        totalOutputTokens: result.totalUsage.outputTokens,
        totalCacheRead: result.totalUsage.cacheReadTokens ?? 0,
        totalCacheCreation: result.totalUsage.cacheWriteTokens ?? 0,
        totalCost: 0,  // populated by phase 6 cost tracker
        queries: result.turns,
      },
    });

    return {
      success: true,
      messagesProcessed: result.turns,
      output: this.outputBuf,
      sessionId: this.sessionId,
    };
  }

  /* ----------------------------------------------------------- Runner API */

  kill(reason?: string): void {
    this._killReason = reason ?? 'unspecified';
    log.warn('agent-loop-runner', 'kill issued', {
      workerId: this.config.id, reason: this._killReason,
    });
    this.abortController?.abort();
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

  /**
   * Append a follow-up to the persisted history and re-run the loop.
   * The runner keeps its synthetic sessionId across resumes; AgentLoop
   * is stateless so the history we hold IS the session.
   */
  async resume(sessionId: string, feedback: string): Promise<WorkerResult> {
    if (sessionId !== this.sessionId) {
      // Caller asked for a different session — refuse rather than silently
      // continue on this one. Dispatcher should construct a new runner.
      return {
        success: false,
        messagesProcessed: 0,
        error: `AgentLoopRunner sessionId mismatch: have=${this.sessionId} want=${sessionId}`,
      };
    }
    // Override the task to be the resume feedback; history is already loaded.
    const prevTask = this.config.task;
    (this.config as { task: string }).task = feedback;
    try {
      return await this.run();
    } finally {
      (this.config as { task: string }).task = prevTask;
    }
  }

  resolvePermission(_toolUseID: string, _allow: boolean, _message?: string): boolean {
    // Phase 2d will route through the hook middleware. Until then,
    // permissions are not plumbed (matches SdkRunner when canUseTool absent).
    return false;
  }
}

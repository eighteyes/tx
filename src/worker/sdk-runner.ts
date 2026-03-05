/**
 * SDK Worker Runner - Runs workers using Claude Agent SDK
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { query, type SDKResultMessage, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { MessageQueue } from '../queue/index.ts';
import type { Message } from '../queue/index.ts';
import type { SemanticModel, WorkerResult, QueryMetrics, WorkerMetrics } from '../shared/types.ts';
import type { FileChangeSummary } from '../session/types.ts';
import { log } from '../shared/logger.ts';
import {
  isUsagePolicyError,
  handleUsagePolicyError,
  type UsagePolicyViolationError,
} from './usage-policy-error.ts';
import type { GuardrailMode } from './guardrail-config.ts';

const MODEL_MAP: Record<SemanticModel, string> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
};

/**
 * Routing destination: target agent and reason
 */
export interface RoutingDestination {
  to: string;      // Target agent ID (e.g., "research/sourcer" or "core")
  reason: string;  // Why route here (e.g., "Requirements complete, ready to source")
}

/**
 * Agent routing config: maps status types to destinations
 * Example: { complete: { to: "research/sourcer", reason: "Ready to source" } }
 */
export type AgentRouting = Record<string, RoutingDestination>;

/**
 * Tool restriction policy for agents
 * - 'unrestricted': Full SDK tools + MCP tools (default)
 * - 'mcp-only': ONLY MCP server tools, no built-in SDK tools
 */
export type ToolRestriction = 'unrestricted' | 'mcp-only' | 'orchestrator';

/**
 * Mesh-style routing: { status: { destination: "reason" } }
 * This is the format from mesh config.yaml files
 */
export type MeshStyleRouting = Record<string, Record<string, string>>;

export interface SdkRunnerConfig {
  id: string;
  model: SemanticModel;
  systemPrompt: string;
  workDir: string;
  msgsDir: string;
  maxTurns?: number;
  routing?: MeshStyleRouting;  // Optional routing table (mesh config format, injected into prompt)
  mcpServers?: Record<string, McpServerConfig>;  // MCP server configurations
  toolRestriction?: ToolRestriction;  // Tool access policy (default: unrestricted)
  sessionId?: string;  // Resume existing session (for interrupt/revision flow)
  resumeSessionAt?: string;  // Message UUID for point-in-time fork (truncate to init state)
  forkSession?: boolean;  // Branch into new session on resume (isolate from parent)
  command?: string;  // Agent-level slash command (fallback if message has no command)
  hooks?: Record<string, unknown[]>;  // SDK PreToolUse/PostToolUse hooks (chaos contracts)
  maxTurnsMode?: GuardrailMode;  // { strict, warning } for max_turns enforcement
  thinking?: boolean;  // Enable extended thinking (default: true). Set false to disable.
}

export class SdkRunner extends EventEmitter {
  private config: SdkRunnerConfig;
  private queue: MessageQueue;
  private running = false;
  private abortController: AbortController | null = null;
  private currentSessionId: string | null = null;
  private currentQuery: ReturnType<typeof query> | null = null;
  private queryMetrics: QueryMetrics[] = [];
  private toolCallsCount: number = 0;  // Track tool calls for analytics
  private firstUserMessageUuid: string | null = null;  // First user message UUID for session anchoring
  private startedAt: number = 0;
  private currentUserPrompt: string = '';  // Track for error context capture
  private turnCount: number = 0;  // Track turns for warning mode
  private maxTurnsWarningEmitted: boolean = false;  // Prevent duplicate warnings
  private lastResultSubtype: string = '';  // Track SDK result subtype (success, error_max_turns, etc.)
  private filesChanged: FileChangeSummary = {
    created: [],
    modified: [],
    deleted: [],
    gitCommits: [],
  };

  constructor(config: SdkRunnerConfig, queue: MessageQueue) {
    super();
    this.setMaxListeners(25);
    this.config = config;
    this.queue = queue;
  }

  /**
   * Compute effective maxTurns for SDK.
   * Warning mode: return undefined (no SDK limit), track turns manually.
   * Strict mode: return configured value.
   */
  private getEffectiveMaxTurns(): number | undefined {
    const mode = this.config.maxTurnsMode;
    if (mode && !mode.strict && this.config.maxTurns) {
      // Warning mode: disable SDK enforcement, track manually
      return undefined;
    }
    return this.config.maxTurns;
  }

  /**
   * Check if max_turns warning threshold has been reached (warning mode only).
   * Emits 'max-turns-warning' event when threshold hit.
   */
  private checkMaxTurnsWarning(): void {
    const mode = this.config.maxTurnsMode;
    if (!mode || mode.strict || !mode.warning || !this.config.maxTurns) return;
    if (this.maxTurnsWarningEmitted) return;

    this.turnCount++;
    if (this.turnCount >= this.config.maxTurns) {
      this.maxTurnsWarningEmitted = true;
      log.warn('sdk-runner', 'max_turns threshold reached (warning mode)', {
        workerId: this.config.id,
        turnCount: this.turnCount,
        maxTurns: this.config.maxTurns,
      });
      log.activity('guardrail:max-turns', this.config.id, `max_turns WARNING: ${this.turnCount}/${this.config.maxTurns} turns reached`);
      this.emit('max-turns-warning', {
        id: this.config.id,
        turnCount: this.turnCount,
        maxTurns: this.config.maxTurns,
      });
    }
  }

  /**
   * Aggregate all query metrics into a single WorkerMetrics object
   */
  private aggregateMetrics(): WorkerMetrics {
    const totals = this.queryMetrics.reduce((acc, q) => ({
      inputTokens: acc.inputTokens + q.inputTokens,
      outputTokens: acc.outputTokens + q.outputTokens,
      costUsd: acc.costUsd + q.totalCostUsd,
      durationMs: acc.durationMs + q.durationMs,
    }), { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 });

    return {
      agentId: this.config.id,
      model: this.config.model,
      queries: this.queryMetrics,
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalCostUsd: totals.costUsd,
      totalDurationMs: totals.durationMs,
      totalToolCalls: this.toolCallsCount,
      startedAt: this.startedAt,
    };
  }

  // ============================================
  // File Change Tracking
  // ============================================

  /**
   * Reset file tracking for a new run
   */
  private resetFilesChanged(): void {
    this.filesChanged = {
      created: [],
      modified: [],
      deleted: [],
      gitCommits: [],
    };
  }

  /**
   * Add a file to the created list (deduped)
   */
  private addCreated(filePath: string): void {
    if (!this.filesChanged.created.includes(filePath)) {
      this.filesChanged.created.push(filePath);
    }
  }

  /**
   * Add a file to the modified list (deduped)
   */
  private addModified(filePath: string): void {
    // Don't add to modified if it's in created (it was just created this session)
    if (this.filesChanged.created.includes(filePath)) return;
    if (!this.filesChanged.modified.includes(filePath)) {
      this.filesChanged.modified.push(filePath);
    }
  }

  /**
   * Add a file to the deleted list (deduped)
   */
  private addDeleted(filePath: string): void {
    if (!this.filesChanged.deleted.includes(filePath)) {
      this.filesChanged.deleted.push(filePath);
    }
    // Remove from created/modified if it was there (file no longer exists)
    this.filesChanged.created = this.filesChanged.created.filter(f => f !== filePath);
    this.filesChanged.modified = this.filesChanged.modified.filter(f => f !== filePath);
  }

  /**
   * Add a git commit hash (deduped)
   */
  private addGitCommit(commitHash: string): void {
    if (!this.filesChanged.gitCommits?.includes(commitHash)) {
      this.filesChanged.gitCommits?.push(commitHash);
    }
  }

  /**
   * Summarize tool input for session transcript (truncated for readability)
   */
  private summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
    const MAX_VALUE_LEN = 500;
    const truncate = (v: string) => v.length > MAX_VALUE_LEN
      ? v.slice(0, MAX_VALUE_LEN) + '... (truncated)'
      : v;

    switch (toolName) {
      case 'Bash':
        return `command: ${truncate(String(input.command || ''))}`;
      case 'Read':
        return `file: ${input.file_path || input.path || ''}`;
      case 'Write':
        return `file: ${input.file_path || ''}\ncontent: ${truncate(String(input.content || '').slice(0, 200))}...`;
      case 'Edit':
        return `file: ${input.file_path || ''}\nold: ${truncate(String(input.old_string || ''))}\nnew: ${truncate(String(input.new_string || ''))}`;
      case 'Glob':
        return `pattern: ${input.pattern || ''}${input.path ? `\npath: ${input.path}` : ''}`;
      case 'Grep':
        return `pattern: ${input.pattern || ''}${input.path ? `\npath: ${input.path}` : ''}`;
      default: {
        const entries = Object.entries(input);
        if (entries.length === 0) return '(no input)';
        return entries
          .map(([k, v]) => `${k}: ${truncate(typeof v === 'string' ? v : JSON.stringify(v))}`)
          .join('\n');
      }
    }
  }

  /**
   * Brief one-line target for tool call display in tx spy.
   * Returns null if no meaningful target can be extracted.
   */
  private briefToolTarget(toolName: string, input: Record<string, unknown>): string | null {
    switch (toolName) {
      case 'Bash': {
        const cmd = String(input.command || '');
        return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
      }
      case 'Read':
      case 'Write':
      case 'Edit':
        return (input.file_path || input.path) as string || null;
      case 'Glob':
        return (input.pattern as string) || null;
      case 'Grep':
        return (input.pattern as string) || null;
      default:
        return null;
    }
  }

  /**
   * Track file operations from tool_use blocks
   */
  private trackFileOperation(toolName: string, input: Record<string, unknown>): void {
    const filePath = (input.file_path || input.path) as string | undefined;

    switch (toolName) {
      case 'Write':
        if (filePath) {
          // Check if file exists to determine create vs modify
          if (fs.existsSync(filePath)) {
            this.addModified(filePath);
          } else {
            this.addCreated(filePath);
          }
        }
        break;

      case 'Edit':
        if (filePath) {
          this.addModified(filePath);
        }
        break;

      case 'NotebookEdit':
        const notebookPath = input.notebook_path as string | undefined;
        if (notebookPath) {
          this.addModified(notebookPath);
        }
        break;

      case 'Bash':
        const command = input.command as string | undefined;
        if (command) {
          this.parseBashForFileOps(command);
        }
        break;
    }
  }

  /**
   * Parse bash commands for file operations (best effort)
   */
  private parseBashForFileOps(command: string): void {
    // Detect rm commands (simple heuristic)
    const rmMatch = command.match(/\brm\s+(?:-[rf]+\s+)?([^\s|;&]+)/g);
    if (rmMatch) {
      for (const match of rmMatch) {
        const parts = match.split(/\s+/);
        const filePath = parts[parts.length - 1];
        // Skip if it looks like an option
        if (filePath && !filePath.startsWith('-')) {
          this.addDeleted(filePath);
        }
      }
    }

    // Detect git commit (we'll capture commit hash from output later if needed)
    if (command.includes('git commit')) {
      // Mark that a commit happened - actual hash captured from output
      log.debug('sdk-runner', 'Git commit detected in bash command');
    }
  }

  /**
   * Parse tool result for git commit hash
   */
  private parseToolResultForCommit(toolName: string, result: string): void {
    if (toolName === 'Bash' && result) {
      // Look for commit hash pattern in git commit output
      // e.g., "[main abc1234] commit message" or "abc1234" as first line
      const commitMatch = result.match(/\[[\w/-]+\s+([a-f0-9]{7,40})\]/);
      if (commitMatch) {
        this.addGitCommit(commitMatch[1]);
      }
    }
  }

  /**
   * Get the file changes summary
   */
  getFilesChanged(): FileChangeSummary {
    return this.filesChanged;
  }

  async run(): Promise<WorkerResult> {
    const workerId = this.config.id;

    if (this.running) {
      return { success: false, messagesProcessed: 0, error: 'Already running' };
    }

    log.info('sdk-runner', `Starting worker`, { workerId, model: this.config.model });
    this.running = true;
    this.abortController = new AbortController();
    // Reset metrics, file tracking, and turn counter for this run
    this.queryMetrics = [];
    this.resetFilesChanged();
    this.turnCount = 0;
    this.maxTurnsWarningEmitted = false;
    this.lastResultSubtype = '';
    this.startedAt = Date.now();
    this.emit('start', { id: workerId });

    let totalProcessed = 0;
    let lastError: string | undefined;
    const sessionOutput: string[] = [];

    try {
      // OAOM (One-Agent-One-Message): Process exactly ONE message per run.
      // The dispatcher expects each worker run to handle a single task.
      // FSM dispatch messages arrive in the queue while the worker is running,
      // and must be processed by a NEW worker instance for state isolation.
      // The while loop was causing workers to poll and process FSM dispatch
      // messages meant for the next state transition.
      const taskMessage = this.queue.pollOne(workerId);
      if (taskMessage) {
        // Fresh context for each message - don't accumulate conversation history
        // Session resume is only for explicit interrupt/feedback flows via resume(), not queue processing
        // Clear runtime session ID to prevent context accumulation.
        // IMPORTANT: Preserve config.sessionId when fork_from is active — the dispatcher
        // sets it to the checkpoint sessionId for forking. Clearing it here would make
        // resume: undefined, causing forkSession/resumeSessionAt to be silently ignored
        // and the agent to start a fresh session instead of forking.
        this.currentSessionId = null;
        if (!this.config.forkSession) {
          this.config.sessionId = undefined;
        }
        this.firstUserMessageUuid = null;

        totalProcessed++;
        log.info('sdk-runner', `Processing message`, { workerId, messageId: taskMessage.id, type: taskMessage.type });

        // Emit processing event for FSM transition (idle → running)
        this.emit('message:processing', {
          id: workerId,
          messageId: taskMessage.id,
          type: taskMessage.type
        });

        const userPrompt = this.buildUserPrompt(taskMessage);
        this.currentUserPrompt = userPrompt;  // Track for error context capture

        // Determine tool configuration based on restriction policy
        // 'mcp-only': Disable all built-in tools, only MCP tools available
        // 'orchestrator': Only Read + Write (Write path restricted via PreToolUse hook)
        // 'unrestricted' (default): Full SDK tools + MCP tools
        let toolsConfig: string[] | undefined;
        if (this.config.toolRestriction === 'mcp-only') {
          toolsConfig = [];  // Empty array disables all built-in tools
        } else if (this.config.toolRestriction === 'orchestrator') {
          toolsConfig = ['Read', 'Write'];  // Orchestrator: read anything, write restricted by hook
        } else {
          toolsConfig = undefined;  // undefined = use default (all tools)
        }

        if (this.config.toolRestriction === 'mcp-only') {
          log.info('sdk-runner', `Tool restriction: mcp-only`, {
            workerId,
            mcpServers: this.config.mcpServers ? Object.keys(this.config.mcpServers) : []
          });
        } else if (this.config.toolRestriction === 'orchestrator') {
          log.info('sdk-runner', `Tool restriction: orchestrator (Read + Write msgs-only)`, { workerId });
        }

        try {
          const resumeId = this.currentSessionId || this.config.sessionId;
          if (this.config.forkSession || this.config.resumeSessionAt) {
            log.info('sdk-runner', `Fork query options`, {
              workerId,
              resume: resumeId,
              resumeSessionAt: this.config.resumeSessionAt,
              forkSession: this.config.forkSession,
              model: this.config.model,
            });
          }
          this.currentQuery = query({
            prompt: userPrompt,
            options: {
              cwd: this.config.workDir,
              model: MODEL_MAP[this.config.model],
              systemPrompt: this.config.systemPrompt,
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              abortController: this.abortController,
              maxTurns: this.getEffectiveMaxTurns(),
              settingSources: ['project'],  // Load project slash commands
              mcpServers: this.config.mcpServers,  // Pass MCP server configs
              tools: toolsConfig,  // Tool restriction (empty array = no built-in tools)
              resume: resumeId,  // Resume session if available
              resumeSessionAt: this.config.resumeSessionAt,  // Point-in-time fork UUID
              forkSession: this.config.forkSession,  // Branch into new session
              hooks: this.config.hooks,  // Chaos contract hooks (write-gate, read-gate)
              ...(this.config.thinking === false ? { maxThinkingTokens: 0 } : {}),
            }
          });
        } catch (error) {
          const err = error as Error;
          // Catch SDK initialization errors (e.g., path argument type errors)
          if (err.message.includes('path') || err.message.includes('type')) {
            log.warn('sdk-runner', `SDK initialization warning, retrying without project settings`, {
              workerId,
              error: err.message
            });
            // Retry without project settings
            this.currentQuery = query({
              prompt: userPrompt,
              options: {
                cwd: this.config.workDir,
                model: MODEL_MAP[this.config.model],
                systemPrompt: this.config.systemPrompt,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                abortController: this.abortController,
                maxTurns: this.getEffectiveMaxTurns(),
                mcpServers: this.config.mcpServers,  // Pass MCP server configs
                tools: toolsConfig,  // Tool restriction (empty array = no built-in tools)
                resume: this.currentSessionId || this.config.sessionId,  // Resume session if available
                resumeSessionAt: this.config.resumeSessionAt,  // Point-in-time fork UUID
                forkSession: this.config.forkSession,  // Branch into new session
                hooks: this.config.hooks,  // Chaos contract hooks (write-gate, read-gate)
                ...(this.config.thinking === false ? { maxThinkingTokens: 0 } : {}),
              }
            });
          } else {
            throw error;
          }
        }

        let resultMessage = '';
        let isError = false;

        for await (const msg of this.currentQuery) {
          switch (msg.type) {
            case 'assistant':
              this.checkMaxTurnsWarning();
              const content = msg.message.content;
              let textContent = '';
              let toolUses: {type: 'tool_use'; name: string}[] = [];

              if (typeof content === 'string') {
                textContent = content;
              } else if (Array.isArray(content)) {
                textContent = content
                  .filter((block: any) => block.type === 'text')
                  .map((block: any) => block.text)
                  .join('\n');

                toolUses = (content as any[]).filter((block: any) => block.type === 'tool_use');
              }

              if (textContent) {
                sessionOutput.push(textContent);
                this.emit('output', { id: workerId, data: textContent });
                log.activity('output', workerId, textContent);
              }

              if (toolUses.length > 0) {
                const toolSummaries = toolUses.map((t: any) => {
                  const target = this.briefToolTarget(t.name, (t as any).input || {});
                  return target ? `${t.name}(${target})` : t.name;
                });
                const toolNames = toolUses.map((t: any) => t.name).join(', ');
                log.info('sdk-runner', `Tools`, { workerId, tools: toolNames });
                log.activity('tools', workerId, toolSummaries.join(', '));

                // Capture tool calls with inputs for session transcript
                for (const toolUse of toolUses) {
                  const input = (toolUse as any).input || {};
                  const inputSummary = this.summarizeToolInput(toolUse.name, input);
                  sessionOutput.push(`[Tool Call: ${toolUse.name}]\n${inputSummary}`);
                  this.trackFileOperation(toolUse.name, input);
                }

                // Emit output for stuck detection - tool calls are activity
                this.emit('output', { id: workerId, data: `[Tools: ${toolNames}]` });

                // Track tool calls count for analytics
                this.toolCallsCount += toolUses.length;
              }
              break;

            case 'result':
              const resultMsg = msg as SDKResultMessage;
              this.lastResultSubtype = resultMsg.subtype;
              resultMessage = resultMsg.subtype === 'success'
                ? (resultMsg as SDKResultMessage & { subtype: 'success' }).result
                : '';
              isError = msg.is_error;
              sessionOutput.push(`[Result: ${resultMsg.subtype}]`);

              // Capture query metrics for aggregation
              const metrics: QueryMetrics = {
                inputTokens: resultMsg.usage.input_tokens,
                outputTokens: resultMsg.usage.output_tokens,
                cacheReadTokens: resultMsg.usage.cache_read_input_tokens,
                cacheCreationTokens: resultMsg.usage.cache_creation_input_tokens,
                totalCostUsd: resultMsg.total_cost_usd,
                durationMs: resultMsg.duration_ms,
                durationApiMs: resultMsg.duration_api_ms,
                numTurns: resultMsg.num_turns,
              };
              this.queryMetrics.push(metrics);

              // Log SDK metrics: cost, duration, tokens
              log.info('sdk-runner', `SDK metrics`, {
                workerId,
                subtype: resultMsg.subtype,
                totalCostUsd: resultMsg.total_cost_usd,
                durationMs: resultMsg.duration_ms,
                durationApiMs: resultMsg.duration_api_ms,
                numTurns: resultMsg.num_turns,
                inputTokens: resultMsg.usage.input_tokens,
                outputTokens: resultMsg.usage.output_tokens,
                cacheReadTokens: resultMsg.usage.cache_read_input_tokens,
                cacheCreationTokens: resultMsg.usage.cache_creation_input_tokens,
              });
              break;

            case 'user':
              // Capture first user message UUID for session anchoring.
              // The first user message UUID is the earliest persistable anchor point —
              // system:init UUIDs are transient streaming events, not stored in the session.
              // --resume-session-at needs a UUID that exists in the persisted session JSONL.
              if (!this.firstUserMessageUuid) {
                const userUuid = (msg as { uuid?: string }).uuid;
                if (userUuid) {
                  this.firstUserMessageUuid = userUuid;
                  this.emit('init-anchor', { id: workerId, firstUserMessageUuid: userUuid });
                }
              }
              // Capture tool results for session transcript
              if (msg.tool_use_result !== undefined && msg.tool_use_result !== null) {
                const resultStr = typeof msg.tool_use_result === 'string'
                  ? msg.tool_use_result
                  : JSON.stringify(msg.tool_use_result, null, 2);
                const truncated = resultStr.length > 2000
                  ? resultStr.slice(0, 2000) + '\n... (truncated)'
                  : resultStr;
                sessionOutput.push(`[Tool Result]\n${truncated}`);
              }
              break;

            case 'system':
              if (msg.subtype === 'init') {
                // Debug: log actual init message structure to resolve field name confusion
                const initMsg = msg as Record<string, unknown>;
                const hasConversationId = 'conversationId' in initMsg;
                const hasSessionId = 'session_id' in initMsg;

                log.debug('sdk-runner', `Init message structure`, {
                  workerId,
                  keys: Object.keys(initMsg).filter(k => k.includes('id') || k.includes('session')),
                  hasConversationId,
                  hasSessionId,
                  conversationIdValue: initMsg.conversationId,
                  sessionIdValue: initMsg.session_id
                });

                // Try both field names - SDK docs vs actual implementation may differ
                const convId = (initMsg.conversationId as string) || (initMsg.session_id as string);

                if (convId) {
                  this.currentSessionId = convId;
                  log.info('sdk-runner', `Session ID captured`, {
                    workerId,
                    sessionId: this.currentSessionId,
                    source: hasConversationId ? 'conversationId' : 'session_id'
                  });
                } else {
                  log.warn('sdk-runner', `No session ID found in init message`, {
                    workerId,
                    availableKeys: Object.keys(initMsg)
                  });
                }
                this.emit('init', { id: workerId, tools: msg.tools, sessionId: this.currentSessionId });
              }
              break;
          }
        }

        if (isError) {
          lastError = resultMessage;
          log.warn('sdk-runner', `Task error`, { workerId, error: resultMessage });
        }

        // Detect max_turns exhaustion from SDK result subtype
        if (this.lastResultSubtype === 'error_max_turns') {
          log.warn('sdk-runner', 'Agent hit max_turns limit', {
            workerId,
            maxTurns: this.config.maxTurns,
            turnCount: this.turnCount,
          });
          log.activity('guardrail:max-turns', workerId, `max_turns HALT: agent stopped after ${this.config.maxTurns} turns`);
          this.emit('max-turns-exhausted', {
            id: workerId,
            maxTurns: this.config.maxTurns,
            turnCount: this.turnCount,
          });
        }

        this.emit('task:complete', { id: workerId, messageId: taskMessage.id, result: resultMessage, isError });

        // Emit idle event for FSM transition (worker finished processing message)
        this.emit('message:idle', {
          id: workerId,
          message: taskMessage,
          output: resultMessage
        });
      }

      const output = sessionOutput.join('\n\n---\n\n');
      log.info('sdk-runner', `Worker complete`, { workerId, totalProcessed, success: !lastError, sessionId: this.currentSessionId });

      this.emit('complete', { id: workerId, messagesProcessed: totalProcessed, output, sessionId: this.currentSessionId, metrics: this.aggregateMetrics() });
      return { success: !lastError, messagesProcessed: totalProcessed, output, error: lastError, sessionId: this.currentSessionId || undefined };

    } catch (error) {
      const err = error as Error & {
        stderr?: string;
        stdout?: string;
        cause?: Error;
        code?: number | string;
        exitCode?: number;
      };

      // Max turns exhaustion: SDK may throw when agent exceeds maxTurns limit.
      // Detect by error message or by the last result subtype we captured before the throw.
      // Treat as graceful completion (not a crash) — the work is just incomplete.
      const isMaxTurnsError = err.message?.includes('max turns') ||
                              err.message?.includes('error_max_turns') ||
                              this.lastResultSubtype === 'error_max_turns';
      if (isMaxTurnsError) {
        log.warn('sdk-runner', `Agent hit max_turns limit (caught as error) — treating as completion`, {
          workerId,
          totalProcessed,
          maxTurns: this.config.maxTurns,
          sessionId: this.currentSessionId,
          errorMessage: err.message,
        });
        log.activity('guardrail:max-turns', workerId, `max_turns HALT: agent stopped after ${this.config.maxTurns} turns (error path)`);
        const output = sessionOutput.join('\n\n---\n\n');
        this.emit('max-turns-exhausted', {
          id: workerId,
          maxTurns: this.config.maxTurns,
          turnCount: this.turnCount,
        });
        this.emit('complete', { id: workerId, messagesProcessed: totalProcessed, output, sessionId: this.currentSessionId, metrics: this.aggregateMetrics() });
        return { success: true, messagesProcessed: totalProcessed, output, sessionId: this.currentSessionId || undefined };
      }

      // Exit code 1 with processed messages: treat as success with warning.
      // Claude Code CLI may exit non-zero after successful work (e.g., session fork
      // cleanup hitting API 400 concurrency errors). If we already processed messages,
      // the work was done — don't trigger retry/error.
      if (err.message?.includes('exited with code 1') && totalProcessed > 0) {
        log.warn('sdk-runner', `Process exited with code 1 after successful work — treating as success`, {
          workerId,
          totalProcessed,
          sessionId: this.currentSessionId,
          hadFork: !!this.config.forkSession,
        });
        const output = sessionOutput.join('\n\n---\n\n');
        this.emit('complete', { id: workerId, messagesProcessed: totalProcessed, output, sessionId: this.currentSessionId, metrics: this.aggregateMetrics() });
        return { success: true, messagesProcessed: totalProcessed, output, sessionId: this.currentSessionId || undefined };
      }

      // Check for Usage Policy errors - handle with HITL instead of crashing
      if (isUsagePolicyError(err)) {
        log.warn('sdk-runner', 'Usage Policy error detected, sending ask-human', { workerId });

        const usagePolicyError = handleUsagePolicyError(
          err,
          workerId,
          this.currentUserPrompt,
          sessionOutput,
          this.config.msgsDir,
          this.currentSessionId,
          `task-${Date.now()}`
        );

        log.activity('usage-policy', workerId, `HITL requested: ${usagePolicyError.askHumanFilepath}`);

        // Emit special event for usage policy errors
        this.emit('usage-policy-error', {
          id: workerId,
          error: err.message,
          askHumanFilepath: usagePolicyError.askHumanFilepath,
          sessionId: this.currentSessionId,
          context: usagePolicyError.context,
        });

        // Return with specific error type so caller knows this is a HITL situation
        return {
          success: false,
          messagesProcessed: totalProcessed,
          error: `Usage Policy Error (ask-human sent): ${err.message}`,
          sessionId: this.currentSessionId || undefined,
        };
      }

      // Build detailed error context for debugging
      const errorContext: Record<string, unknown> = {
        workerId,
        error: err.message,
        name: err.name,
        stack: err.stack?.split('\n').slice(0, 5).join('\n'),  // First 5 lines of stack
      };

      // Capture any additional error properties from SDK
      if (err.stderr) errorContext.stderr = err.stderr.slice(0, 500);
      if (err.stdout) errorContext.stdout = err.stdout.slice(0, 500);
      if (err.cause) errorContext.cause = (err.cause as Error).message;
      if (err.code !== undefined) errorContext.code = err.code;
      if (err.exitCode !== undefined) errorContext.exitCode = err.exitCode;

      // Demote expected exit patterns from error to warn/debug
      const isAbortError = err.message.includes('aborted by user') ||
                          err.message.includes('process aborted') ||
                          err.message.includes('Operation aborted');
      const isExitCode1 = err.message?.includes('exited with code 1');

      if (isAbortError) {
        log.debug('sdk-runner', `Worker aborted (expected)`, errorContext);
      } else if (isExitCode1) {
        log.warn('sdk-runner', `Worker exited with code 1`, errorContext);
      } else {
        log.error('sdk-runner', `Worker error`, errorContext);
      }

      this.emit('error', {
        id: workerId,
        error: err.message,
        stack: err.stack,
        stderr: err.stderr,
        code: err.code || err.exitCode,
      });
      return { success: false, messagesProcessed: totalProcessed, error: err.message };
    } finally {
      this.running = false;
      this.abortController = null;
      this.currentQuery = null;
    }
  }

  private buildUserPrompt(msg: Message): string {
    const parts: string[] = [];

    // Slash command at start - requires settingSources: ['project'] to work
    // Message frontmatter command takes priority over agent config command
    const command = (msg.payload.command as string) || this.config.command;
    if (command) {
      const interpolated = command.replace(/\{(\w[\w-]*)\}/g, (match, key) => {
        const value = msg.payload[key];
        return value != null ? String(value) : match;
      });
      parts.push(interpolated);
      parts.push('\n\n');
    }

    parts.push('## Task Context\n');
    parts.push(`**From**: ${msg.from_agent}`);
    parts.push(`**Type**: ${msg.type}`);
    if (msg.payload.headline) {
      parts.push(`**Headline**: ${msg.payload.headline}`);
    }
    if (msg.payload.body) {
      parts.push(`\n${msg.payload.body}`);
    }

    parts.push('\n---');
    parts.push(`\nWrite response messages to: ${this.config.msgsDir}/`);

    return parts.join('\n');
  }

  kill(reason?: string): void {
    const workerId = this.config.id;
    log.warn('sdk-runner', 'Killing worker', {
      workerId,
      reason: reason || 'unspecified',
      sessionId: this.currentSessionId?.slice(0, 8),
      wasRunning: this.running,
    });
    if (this.abortController) {
      this.abortController.abort();
    }
    this.running = false;
  }

  /**
   * Get current session ID (for resume/interrupt)
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Check if runner is currently processing
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Interrupt the current query execution.
   * Used when a message file is revised mid-flight.
   * The query will stop processing and return control to the caller.
   */
  async interrupt(): Promise<void> {
    const workerId = this.config.id;

    if (!this.currentQuery) {
      log.debug('sdk-runner', 'Interrupt called but no active query', { workerId });
      return;
    }

    log.info('sdk-runner', 'Interrupting active query', {
      workerId,
      sessionId: this.currentSessionId?.slice(0, 8)
    });

    try {
      await this.currentQuery.interrupt();
      this.emit('interrupted', { id: workerId, sessionId: this.currentSessionId });
    } catch (error) {
      log.error('sdk-runner', 'Failed to interrupt query', {
        workerId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Resume an existing session with a new user message (feedback)
   * This continues the conversation with the provided sessionId and feedback as the new prompt.
   * Used for quality gate iteration loops where we want to preserve conversation context.
   *
   * @param sessionId - The session ID to resume
   * @param feedback - The feedback message to send as the new user turn
   * @returns WorkerResult with the resumed session outcome
   */
  async resume(sessionId: string, feedback: string): Promise<WorkerResult> {
    const workerId = this.config.id;

    if (this.running) {
      return { success: false, messagesProcessed: 0, error: 'Already running' };
    }

    log.info('sdk-runner', `Resuming session with feedback`, {
      workerId,
      sessionId: sessionId.slice(0, 8) + '...',
      feedbackLength: feedback.length
    });

    this.running = true;
    this.abortController = new AbortController();
    this.currentSessionId = sessionId;
    this.emit('start', { id: workerId, resume: true, sessionId });

    const sessionOutput: string[] = [];
    let lastError: string | undefined;

    try {
      // Build the feedback prompt
      const userPrompt = this.buildFeedbackPrompt(feedback);

      // Determine tool configuration based on restriction policy
      const toolsConfig = this.config.toolRestriction === 'mcp-only'
        ? []
        : undefined;

      // Create query with resume option to continue the session
      const q = query({
        prompt: userPrompt,
        options: {
          cwd: this.config.workDir,
          model: MODEL_MAP[this.config.model],
          systemPrompt: this.config.systemPrompt,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          abortController: this.abortController,
          maxTurns: this.getEffectiveMaxTurns(),
          mcpServers: this.config.mcpServers,
          tools: toolsConfig,
          resume: sessionId,  // Resume the existing session
          hooks: this.config.hooks,  // Chaos contract hooks (write-gate, read-gate)
          ...(this.config.thinking === false ? { maxThinkingTokens: 0 } : {}),
        }
      });

      let resultMessage = '';
      let isError = false;

      for await (const msg of q) {
        switch (msg.type) {
          case 'assistant':
            this.checkMaxTurnsWarning();
            const textContent = msg.message.content
              .filter((block: any) => block.type === 'text')
              .map((block: any) => block.text)
              .join('\n');

            if (textContent) {
              sessionOutput.push(textContent);
              this.emit('output', { id: workerId, data: textContent });
              log.activity('output', workerId, textContent);
            }

            const toolUses = msg.message.content.filter((block: any) => block.type === 'tool_use');
            if (toolUses.length > 0) {
              const toolSummaries = toolUses.map((t: any) => {
                const target = this.briefToolTarget(t.name, (t as any).input || {});
                return target ? `${t.name}(${target})` : t.name;
              });
              const toolNames = toolUses.map((t: any) => t.name).join(', ');
              log.info('sdk-runner', `Tools`, { workerId, tools: toolNames });
              log.activity('tools', workerId, toolSummaries.join(', '));

              // Capture tool calls with inputs for session transcript
              for (const toolUse of toolUses) {
                const tu = toolUse as { name: string; input?: Record<string, unknown> };
                const input = tu.input || {};
                const inputSummary = this.summarizeToolInput(tu.name, input);
                sessionOutput.push(`[Tool Call: ${tu.name}]\n${inputSummary}`);
                this.trackFileOperation(tu.name, input);
              }

              // Emit output for stuck detection - tool calls are activity
              this.emit('output', { id: workerId, data: `[Tools: ${toolNames}]` });

              // Track tool calls count for analytics (resume flow)
              this.toolCallsCount += toolUses.length;
            }
            break;

          case 'user':
            // Capture tool results for session transcript (resume flow)
            if (msg.tool_use_result !== undefined && msg.tool_use_result !== null) {
              const resultStr = typeof msg.tool_use_result === 'string'
                ? msg.tool_use_result
                : JSON.stringify(msg.tool_use_result, null, 2);
              const truncated = resultStr.length > 2000
                ? resultStr.slice(0, 2000) + '\n... (truncated)'
                : resultStr;
              sessionOutput.push(`[Tool Result]\n${truncated}`);
            }
            break;

          case 'result':
            const resultMsg = msg as SDKResultMessage;
            this.lastResultSubtype = resultMsg.subtype;
            resultMessage = resultMsg.subtype === 'success'
              ? (resultMsg as SDKResultMessage & { subtype: 'success' }).result
              : '';
            isError = msg.is_error;
            sessionOutput.push(`[Result: ${resultMsg.subtype}]`);

            // Capture query metrics for aggregation (resume adds to existing metrics)
            const resumeMetrics: QueryMetrics = {
              inputTokens: resultMsg.usage.input_tokens,
              outputTokens: resultMsg.usage.output_tokens,
              cacheReadTokens: resultMsg.usage.cache_read_input_tokens,
              cacheCreationTokens: resultMsg.usage.cache_creation_input_tokens,
              totalCostUsd: resultMsg.total_cost_usd,
              durationMs: resultMsg.duration_ms,
              durationApiMs: resultMsg.duration_api_ms,
              numTurns: resultMsg.num_turns,
            };
            this.queryMetrics.push(resumeMetrics);

            // Log SDK metrics: cost, duration, tokens
            log.info('sdk-runner', `SDK metrics (resume)`, {
              workerId,
              subtype: resultMsg.subtype,
              totalCostUsd: resultMsg.total_cost_usd,
              durationMs: resultMsg.duration_ms,
              durationApiMs: resultMsg.duration_api_ms,
              numTurns: resultMsg.num_turns,
              inputTokens: resultMsg.usage.input_tokens,
              outputTokens: resultMsg.usage.output_tokens,
              cacheReadTokens: resultMsg.usage.cache_read_input_tokens,
              cacheCreationTokens: resultMsg.usage.cache_creation_input_tokens,
            });
            break;

          case 'system':
            if (msg.subtype === 'init') {
              this.emit('init', { id: workerId, tools: msg.tools, sessionId: this.currentSessionId, resumed: true });
            }
            break;
        }
      }

      if (isError) {
        lastError = resultMessage;
        log.warn('sdk-runner', `Resume task error`, { workerId, error: resultMessage });
      }

      const output = sessionOutput.join('\n\n---\n\n');
      log.info('sdk-runner', `Resume complete`, {
        workerId,
        success: !lastError,
        sessionId: this.currentSessionId
      });

      this.emit('complete', { id: workerId, messagesProcessed: 1, output, sessionId: this.currentSessionId, metrics: this.aggregateMetrics() });
      return { success: !lastError, messagesProcessed: 1, output, error: lastError, sessionId: this.currentSessionId || undefined };

    } catch (error) {
      const err = error as Error & {
        stderr?: string;
        stdout?: string;
        cause?: Error;
        code?: number | string;
        exitCode?: number;
      };

      // Max turns exhaustion during resume: treat as graceful completion
      const isMaxTurnsError = err.message?.includes('max turns') ||
                              err.message?.includes('error_max_turns') ||
                              this.lastResultSubtype === 'error_max_turns';
      if (isMaxTurnsError) {
        log.warn('sdk-runner', `Agent hit max_turns during resume — treating as completion`, {
          workerId,
          maxTurns: this.config.maxTurns,
          sessionId,
          errorMessage: err.message,
        });
        log.activity('guardrail:max-turns', workerId, `max_turns HALT (resume): agent stopped after ${this.config.maxTurns} turns`);
        const output = sessionOutput.join('\n\n---\n\n');
        this.emit('max-turns-exhausted', {
          id: workerId,
          maxTurns: this.config.maxTurns,
          turnCount: this.turnCount,
        });
        this.emit('complete', { id: workerId, messagesProcessed: 1, output, sessionId: this.currentSessionId, metrics: this.aggregateMetrics() });
        return { success: true, messagesProcessed: 1, output, sessionId: this.currentSessionId || undefined };
      }

      // Check for Usage Policy errors - handle with HITL instead of crashing
      if (isUsagePolicyError(err)) {
        log.warn('sdk-runner', 'Usage Policy error detected during resume, sending ask-human', { workerId });

        const usagePolicyError = handleUsagePolicyError(
          err,
          workerId,
          feedback,  // Use the feedback as the prompt context
          sessionOutput,
          this.config.msgsDir,
          sessionId,
          `resume-${Date.now()}`
        );

        log.activity('usage-policy', workerId, `HITL requested (resume): ${usagePolicyError.askHumanFilepath}`);

        // Emit special event for usage policy errors
        this.emit('usage-policy-error', {
          id: workerId,
          error: err.message,
          askHumanFilepath: usagePolicyError.askHumanFilepath,
          sessionId,
          context: usagePolicyError.context,
        });

        // Return with specific error type so caller knows this is a HITL situation
        return {
          success: false,
          messagesProcessed: 0,
          error: `Usage Policy Error (ask-human sent): ${err.message}`,
          sessionId,
        };
      }

      // Build detailed error context for debugging
      const errorContext: Record<string, unknown> = {
        workerId,
        sessionId: sessionId.slice(0, 8) + '...',
        error: err.message,
        name: err.name,
        stack: err.stack?.split('\n').slice(0, 5).join('\n'),
      };

      if (err.stderr) errorContext.stderr = err.stderr.slice(0, 500);
      if (err.stdout) errorContext.stdout = err.stdout.slice(0, 500);
      if (err.cause) errorContext.cause = (err.cause as Error).message;
      if (err.code !== undefined) errorContext.code = err.code;
      if (err.exitCode !== undefined) errorContext.exitCode = err.exitCode;

      // Demote abort errors to debug - dispatcher will determine if it's recoverable
      const isAbortError = err.message.includes('aborted by user') ||
                          err.message.includes('process aborted') ||
                          err.message.includes('Operation aborted');

      if (isAbortError) {
        log.debug('sdk-runner', `Resume interrupted (may recover)`, errorContext);
      } else {
        log.error('sdk-runner', `Resume error`, errorContext);
      }

      this.emit('error', {
        id: workerId,
        error: err.message,
        stack: err.stack,
        stderr: err.stderr,
        code: err.code || err.exitCode,
      });
      return { success: false, messagesProcessed: 0, error: err.message };
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  /**
   * Build the feedback prompt for resume
   */
  private buildFeedbackPrompt(feedback: string): string {
    const parts: string[] = [];

    parts.push('## Quality Stack Feedback\n');
    parts.push('The previous attempt did not pass quality evaluation. Please address the following feedback and try again:\n');
    parts.push(feedback);
    parts.push('\n---');
    parts.push('\n**Action**: Review the feedback above and improve your solution.');

    return parts.join('\n');
  }
}

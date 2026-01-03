/**
 * SDK Worker Runner - Runs workers using Claude Agent SDK
 */

import { EventEmitter } from 'node:events';
import { query, type SDKResultMessage, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { MessageQueue } from '../queue/index.ts';
import type { Message } from '../queue/index.ts';
import type { SemanticModel, WorkerResult } from '../shared/types.ts';
import { log } from '../shared/logger.ts';

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
export type ToolRestriction = 'unrestricted' | 'mcp-only';

export interface SdkRunnerConfig {
  id: string;
  model: SemanticModel;
  systemPrompt: string;
  workDir: string;
  msgsDir: string;
  maxTurns?: number;
  routing?: AgentRouting;  // Optional routing table for this agent
  mcpServers?: Record<string, McpServerConfig>;  // MCP server configurations
  toolRestriction?: ToolRestriction;  // Tool access policy (default: unrestricted)
  sessionId?: string;  // Resume existing session (for interrupt/revision flow)
}

export class SdkRunner extends EventEmitter {
  private config: SdkRunnerConfig;
  private queue: MessageQueue;
  private running = false;
  private abortController: AbortController | null = null;
  private currentSessionId: string | null = null;
  private currentQuery: ReturnType<typeof query> | null = null;

  constructor(config: SdkRunnerConfig, queue: MessageQueue) {
    super();
    this.config = config;
    this.queue = queue;
  }

  async run(): Promise<WorkerResult> {
    const workerId = this.config.id;

    if (this.running) {
      return { success: false, messagesProcessed: 0, error: 'Already running' };
    }

    log.info('sdk-runner', `Starting worker`, { workerId, model: this.config.model });
    this.running = true;
    this.abortController = new AbortController();
    this.emit('start', { id: workerId });

    let totalProcessed = 0;
    let lastError: string | undefined;
    const sessionOutput: string[] = [];

    try {
      while (true) {
        const taskMessage = this.queue.pollOne(workerId);
        if (!taskMessage) break;

        totalProcessed++;
        log.info('sdk-runner', `Processing message`, { workerId, messageId: taskMessage.id, type: taskMessage.type });

        const userPrompt = this.buildUserPrompt(taskMessage);

        // Determine tool configuration based on restriction policy
        // 'mcp-only': Disable all built-in tools, only MCP tools available
        // 'unrestricted' (default): Full SDK tools + MCP tools
        const toolsConfig = this.config.toolRestriction === 'mcp-only'
          ? []  // Empty array disables all built-in tools
          : undefined;  // undefined = use default (all tools)

        if (this.config.toolRestriction === 'mcp-only') {
          log.info('sdk-runner', `Tool restriction: mcp-only`, {
            workerId,
            mcpServers: this.config.mcpServers ? Object.keys(this.config.mcpServers) : []
          });
        }

        try {
          this.currentQuery = query({
            prompt: userPrompt,
            options: {
              cwd: this.config.workDir,
              model: MODEL_MAP[this.config.model],
              systemPrompt: this.config.systemPrompt,
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              abortController: this.abortController,
              maxTurns: this.config.maxTurns,
              settingSources: ['project'],  // Load project slash commands
              mcpServers: this.config.mcpServers,  // Pass MCP server configs
              tools: toolsConfig,  // Tool restriction (empty array = no built-in tools)
              resume: this.currentSessionId || this.config.sessionId,  // Resume session if available
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
                maxTurns: this.config.maxTurns,
                mcpServers: this.config.mcpServers,  // Pass MCP server configs
                tools: toolsConfig,  // Tool restriction (empty array = no built-in tools)
                resume: this.currentSessionId || this.config.sessionId,  // Resume session if available
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
              const textContent = msg.message.content
                .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
                .map(block => block.text)
                .join('\n');

              if (textContent) {
                sessionOutput.push(textContent);
                this.emit('output', { id: workerId, data: textContent });
                log.activity('output', workerId, textContent);
              }

              const toolUses = msg.message.content.filter((block): block is { type: 'tool_use'; name: string } => block.type === 'tool_use');
              if (toolUses.length > 0) {
                const toolNames = toolUses.map(t => t.name).join(', ');
                log.info('sdk-runner', `Tools`, { workerId, tools: toolNames });
                log.activity('tools', workerId, toolNames);
                sessionOutput.push(`[Tools: ${toolNames}]`);
              }
              break;

            case 'result':
              const resultMsg = msg as SDKResultMessage;
              resultMessage = resultMsg.subtype === 'success'
                ? (resultMsg as SDKResultMessage & { subtype: 'success' }).result
                : '';
              isError = msg.is_error;
              sessionOutput.push(`[Result: ${resultMsg.subtype}]`);
              if (resultMessage) sessionOutput.push(resultMessage);
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

      this.emit('complete', { id: workerId, messagesProcessed: totalProcessed, output, sessionId: this.currentSessionId });
      return { success: !lastError, messagesProcessed: totalProcessed, output, error: lastError, sessionId: this.currentSessionId || undefined };

    } catch (error) {
      const err = error as Error;
      log.error('sdk-runner', `Worker error`, { workerId, error: err.message });
      this.emit('error', { id: workerId, error: err.message });
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
    if (msg.payload.command) {
      parts.push(msg.payload.command as string);
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

  kill(): void {
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
          maxTurns: this.config.maxTurns,
          mcpServers: this.config.mcpServers,
          tools: toolsConfig,
          resume: sessionId,  // Resume the existing session
        }
      });

      let resultMessage = '';
      let isError = false;

      for await (const msg of q) {
        switch (msg.type) {
          case 'assistant':
            const textContent = msg.message.content
              .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
              .map(block => block.text)
              .join('\n');

            if (textContent) {
              sessionOutput.push(textContent);
              this.emit('output', { id: workerId, data: textContent });
              log.activity('output', workerId, textContent);
            }

            const toolUses = msg.message.content.filter((block): block is { type: 'tool_use'; name: string } => block.type === 'tool_use');
            if (toolUses.length > 0) {
              const toolNames = toolUses.map(t => t.name).join(', ');
              log.info('sdk-runner', `Tools`, { workerId, tools: toolNames });
              log.activity('tools', workerId, toolNames);
              sessionOutput.push(`[Tools: ${toolNames}]`);
            }
            break;

          case 'result':
            const resultMsg = msg as SDKResultMessage;
            resultMessage = resultMsg.subtype === 'success'
              ? (resultMsg as SDKResultMessage & { subtype: 'success' }).result
              : '';
            isError = msg.is_error;
            sessionOutput.push(`[Result: ${resultMsg.subtype}]`);
            if (resultMessage) sessionOutput.push(resultMessage);
            break;

          case 'system':
            if (msg.subtype === 'init') {
              // Session ID should be the same as the resumed session
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

      this.emit('complete', { id: workerId, messagesProcessed: 1, output, sessionId: this.currentSessionId });
      return { success: !lastError, messagesProcessed: 1, output, error: lastError, sessionId: this.currentSessionId || undefined };

    } catch (error) {
      const err = error as Error;
      log.error('sdk-runner', `Resume error`, { workerId, error: err.message });
      this.emit('error', { id: workerId, error: err.message });
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

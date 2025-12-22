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
}

export class SdkRunner extends EventEmitter {
  private config: SdkRunnerConfig;
  private queue: MessageQueue;
  private running = false;
  private abortController: AbortController | null = null;

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

        let q;
        try {
          q = query({
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
            q = query({
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
              }
            });
          } else {
            throw error;
          }
        }

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
                this.emit('init', { id: workerId, tools: msg.tools });
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
      log.info('sdk-runner', `Worker complete`, { workerId, totalProcessed, success: !lastError });

      this.emit('complete', { id: workerId, messagesProcessed: totalProcessed, output });
      return { success: !lastError, messagesProcessed: totalProcessed, output, error: lastError };

    } catch (error) {
      const err = error as Error;
      log.error('sdk-runner', `Worker error`, { workerId, error: err.message });
      this.emit('error', { id: workerId, error: err.message });
      return { success: false, messagesProcessed: totalProcessed, error: err.message };
    } finally {
      this.running = false;
      this.abortController = null;
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

  isRunning(): boolean {
    return this.running;
  }
}

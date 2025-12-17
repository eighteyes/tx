/**
 * SDK Worker Runner - Runs workers using Claude Agent SDK
 */

import { EventEmitter } from 'node:events';
import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { MessageQueue } from '../queue/index.ts';
import type { Message } from '../queue/index.ts';
import type { SemanticModel, WorkerResult } from '../shared/types.ts';
import { log } from '../shared/logger.ts';

const MODEL_MAP: Record<SemanticModel, string> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
};

export interface SdkRunnerConfig {
  id: string;
  model: SemanticModel;
  systemPrompt: string;
  workDir: string;
  msgsDir: string;
  maxTurns?: number;
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
            settingSources: ['project'],  // Load project slash commands
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
    parts.push('When done, write a task-complete message to core/core.');

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

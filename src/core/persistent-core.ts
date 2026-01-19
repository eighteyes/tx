/**
 * PersistentCore - Long-running core agent for web interface
 *
 * Unlike ephemeral workers, this runs continuously like the tmux-based core.
 * Uses the Claude Agent SDK to maintain a persistent conversation session.
 *
 * Responsibilities:
 * - Run as a persistent process (not per-request)
 * - Stream messages bidirectionally via WebSocket
 * - Handle HITL patterns (ask-human surfaces in UI)
 * - Coordinate mesh orchestration from browser
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { query, type SDKResultMessage, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import type { SemanticModel } from '../shared/types.ts';
import { buildCorePrompt } from '../prompt/core.js';

const MODEL_MAP: Record<SemanticModel, string> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
};

/**
 * Message from web client to core
 */
export interface WebInputMessage {
  type: 'user' | 'hitl-response';
  content: string;
  refMsgId?: string;  // For HITL responses, reference to the ask-human message
}

/**
 * Message from core to web client
 */
export interface WebOutputMessage {
  type: 'text' | 'tool-use' | 'tool-result' | 'ask-human' | 'complete' | 'error' | 'status';
  content: string;
  msgId?: string;
  toolName?: string;
  status?: 'thinking' | 'using-tool' | 'idle' | 'waiting-for-human';
  timestamp: number;
}

/**
 * Configuration for PersistentCore
 */
export interface PersistentCoreConfig {
  workDir: string;
  msgsDir: string;
  meshesDir: string;
  model?: SemanticModel;
  sessionId?: string;  // For resuming an existing conversation
}

/**
 * Events emitted by PersistentCore
 */
export interface PersistentCoreEvents {
  'output': (msg: WebOutputMessage) => void;
  'ask-human': (msg: { msgId: string; question: string }) => void;
  'complete': (data: { sessionId: string | null }) => void;
  'error': (err: { message: string; code?: string }) => void;
  'status': (status: 'thinking' | 'using-tool' | 'idle' | 'waiting-for-human') => void;
}

export class PersistentCore extends EventEmitter {
  private config: PersistentCoreConfig;
  private model: SemanticModel;
  private running = false;
  private currentSessionId: string | null = null;
  private abortController: AbortController | null = null;
  private pendingHITL: Map<string, { resolve: (response: string) => void }> = new Map();
  private inputQueue: WebInputMessage[] = [];
  private processingInput = false;

  constructor(config: PersistentCoreConfig) {
    super();
    this.config = config;
    this.model = config.model || 'sonnet';
    this.currentSessionId = config.sessionId || null;
  }

  /**
   * Get the system prompt for the persistent core agent
   * Uses the unified core prompt with optional web UI extensions
   */
  private getSystemPrompt(): string {
    // Web UI-specific additions (placeholder for future capabilities)
    const uiExtensions = `## Web Interface Notes

This core agent is running in the web interface. The UI will display ask-human requests and wait for user responses.`;

    return buildCorePrompt(
      { msgsDir: this.config.msgsDir, meshesDir: this.config.meshesDir },
      uiExtensions
    );
  }

  /**
   * Start the persistent core - begins listening for input
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.abortController = new AbortController();

    log.info('persistent-core', 'Starting', {
      model: this.model,
      sessionId: this.currentSessionId,
    });

    this.emit('status', 'idle');
    this.emitOutput({
      type: 'status',
      content: 'Core agent ready',
      status: 'idle',
      timestamp: Date.now(),
    });
  }

  /**
   * Stop the persistent core
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Resolve any pending HITL requests with cancellation
    for (const [msgId, pending] of this.pendingHITL) {
      pending.resolve('[Session ended]');
    }
    this.pendingHITL.clear();

    log.info('persistent-core', 'Stopped', {
      sessionId: this.currentSessionId,
    });

    this.emit('complete', { sessionId: this.currentSessionId });
  }

  /**
   * Send input to the core agent
   */
  async sendInput(message: WebInputMessage): Promise<void> {
    if (!this.running) {
      throw new Error('Core agent is not running');
    }

    // Handle HITL responses
    if (message.type === 'hitl-response' && message.refMsgId) {
      const pending = this.pendingHITL.get(message.refMsgId);
      if (pending) {
        pending.resolve(message.content);
        this.pendingHITL.delete(message.refMsgId);
        this.emit('status', 'thinking');
        return;
      }
    }

    // Queue regular user input
    this.inputQueue.push(message);
    this.processInputQueue();
  }

  /**
   * Process queued input messages
   */
  private async processInputQueue(): Promise<void> {
    if (this.processingInput || this.inputQueue.length === 0) return;

    this.processingInput = true;

    while (this.inputQueue.length > 0 && this.running) {
      const message = this.inputQueue.shift()!;
      await this.processUserMessage(message.content);
    }

    this.processingInput = false;
  }

  /**
   * Process a user message through the Claude SDK
   */
  private async processUserMessage(content: string): Promise<void> {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }

    this.emit('status', 'thinking');
    this.emitOutput({
      type: 'status',
      content: 'Thinking...',
      status: 'thinking',
      timestamp: Date.now(),
    });

    try {
      const systemPrompt = this.getSystemPrompt();

      const q = query({
        prompt: content,
        options: {
          cwd: this.config.workDir,
          model: MODEL_MAP[this.model],
          systemPrompt,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          abortController: this.abortController,
          maxTurns: 50,  // Allow more turns for complex tasks
          settingSources: ['project'],
          resume: this.currentSessionId || undefined,
        }
      });

      for await (const msg of q) {
        if (!this.running) break;

        switch (msg.type) {
          case 'assistant':
            await this.handleAssistantMessage(msg);
            break;

          case 'result':
            this.handleResultMessage(msg as SDKResultMessage);
            break;

          case 'system':
            if (msg.subtype === 'init') {
              const initMsg = msg as unknown as Record<string, unknown>;
              const sessionId = (initMsg.conversationId as string) || (initMsg.session_id as string);
              if (sessionId) {
                this.currentSessionId = sessionId;
                log.info('persistent-core', 'Session ID captured', { sessionId });
              }
            }
            break;
        }
      }
    } catch (err) {
      const error = err as Error;
      log.error('persistent-core', 'Error processing message', {
        error: error.message,
        stack: error.stack,
      });

      this.emitOutput({
        type: 'error',
        content: error.message,
        timestamp: Date.now(),
      });

      this.emit('error', { message: error.message });
    }

    this.emit('status', 'idle');
    this.emitOutput({
      type: 'status',
      content: 'Ready',
      status: 'idle',
      timestamp: Date.now(),
    });
  }

  /**
   * Handle an assistant message from the SDK
   */
  private async handleAssistantMessage(msg: SDKMessage): Promise<void> {
    if (msg.type !== 'assistant') return;

    const content = msg.message.content;

    if (typeof content === 'string') {
      this.emitOutput({
        type: 'text',
        content,
        timestamp: Date.now(),
      });
      return;
    }

    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as { type: string; text?: string; name?: string; input?: unknown };

        if (b.type === 'text' && b.text) {
          this.emitOutput({
            type: 'text',
            content: b.text,
            timestamp: Date.now(),
          });

          // Check for ask-human pattern in the text
          if (this.detectAskHuman(b.text)) {
            await this.handleAskHuman(b.text);
          }
        }

        if (b.type === 'tool_use') {
          this.emit('status', 'using-tool');
          this.emitOutput({
            type: 'tool-use',
            content: `Using tool: ${b.name}`,
            toolName: b.name,
            status: 'using-tool',
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  /**
   * Detect if text contains an ask-human request
   */
  private detectAskHuman(text: string): boolean {
    // Look for ask-human message patterns
    return text.includes('type: ask-human') ||
           text.includes('## Question for Human') ||
           text.includes('**Waiting for your response**');
  }

  /**
   * Handle ask-human by emitting to UI and waiting for response
   */
  private async handleAskHuman(text: string): Promise<void> {
    const msgId = `hitl-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    this.emit('status', 'waiting-for-human');
    this.emit('ask-human', { msgId, question: text });

    this.emitOutput({
      type: 'ask-human',
      content: text,
      msgId,
      status: 'waiting-for-human',
      timestamp: Date.now(),
    });

    // Wait for user response via sendInput('hitl-response')
    return new Promise<void>((resolve) => {
      this.pendingHITL.set(msgId, {
        resolve: () => resolve(),
      });
    });
  }

  /**
   * Handle result message from SDK
   */
  private handleResultMessage(msg: SDKResultMessage): void {
    log.info('persistent-core', 'SDK result', {
      subtype: msg.subtype,
      isError: msg.is_error,
      costUsd: msg.total_cost_usd,
      durationMs: msg.duration_ms,
      numTurns: msg.num_turns,
    });

    if (msg.subtype === 'success') {
      const result = (msg as SDKResultMessage & { subtype: 'success' }).result;
      this.emitOutput({
        type: 'complete',
        content: result || 'Task completed',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Emit an output message
   */
  private emitOutput(msg: WebOutputMessage): void {
    this.emit('output', msg);
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Check if the core is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

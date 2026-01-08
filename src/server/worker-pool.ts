/**
 * WorkerPool - Async worker pool for tx-server
 *
 * Responsibilities:
 * - Manage N concurrent async workers
 * - Pull messages from storage queue
 * - Spawn Claude SDK conversations
 * - Handle backpressure and rate limiting
 * - Report pool statistics
 */

import { EventEmitter } from 'node:events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { StorageProvider, AgentMessage, QueueEntry } from '../storage/index.ts';
import type { SessionManager, SessionInfo } from './session-manager.ts';
import { log } from '../shared/logger.ts';

export interface WorkerPoolConfig {
  storage: StorageProvider;
  sessionManager: SessionManager;
  concurrency: number;  // Max concurrent workers
  pollIntervalMs?: number;  // How often to check for work
  maxRetriesPerMessage?: number;
  meshConfigLoader: (meshId: string) => Promise<MeshConfig | null>;
}

export interface MeshConfig {
  mesh: string;
  entry_point?: string;
  agents: Record<string, AgentConfig>;
}

export interface AgentConfig {
  prompt: string;
  model?: string;
  maxTurns?: number;
}

export interface WorkerStats {
  activeWorkers: number;
  idleWorkers: number;
  messagesProcessed: number;
  messagesFailed: number;
  avgProcessingTimeMs: number;
}

export interface WorkerPoolEvents {
  'worker:start': (data: { sessionId: string; agentId: string }) => void;
  'worker:complete': (data: { sessionId: string; agentId: string; durationMs: number }) => void;
  'worker:error': (data: { sessionId: string; agentId: string; error: string }) => void;
  'pool:stats': (stats: WorkerStats) => void;
}

interface ActiveWorker {
  sessionId: string;
  agentId: string;
  startedAt: number;
  promise: Promise<void>;
}

export class WorkerPool extends EventEmitter {
  private storage: StorageProvider;
  private sessionManager: SessionManager;
  private concurrency: number;
  private pollIntervalMs: number;
  private maxRetries: number;
  private meshConfigLoader: (meshId: string) => Promise<MeshConfig | null>;

  private running = false;
  private activeWorkers: Map<string, ActiveWorker> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;

  // Stats
  private messagesProcessed = 0;
  private messagesFailed = 0;
  private totalProcessingTime = 0;

  constructor(config: WorkerPoolConfig) {
    super();
    this.storage = config.storage;
    this.sessionManager = config.sessionManager;
    this.concurrency = config.concurrency;
    this.pollIntervalMs = config.pollIntervalMs || 100;
    this.maxRetries = config.maxRetriesPerMessage || 3;
    this.meshConfigLoader = config.meshConfigLoader;
  }

  /**
   * Start the worker pool
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    log.info('worker-pool', 'Starting', { concurrency: this.concurrency });

    // Start polling loop
    this.poll();
  }

  /**
   * Stop the worker pool (graceful)
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for active workers to complete
    if (this.activeWorkers.size > 0) {
      log.info('worker-pool', 'Waiting for active workers', { count: this.activeWorkers.size });
      await Promise.all(Array.from(this.activeWorkers.values()).map(w => w.promise));
    }

    log.info('worker-pool', 'Stopped');
  }

  /**
   * Get current pool statistics
   */
  getStats(): WorkerStats {
    return {
      activeWorkers: this.activeWorkers.size,
      idleWorkers: this.concurrency - this.activeWorkers.size,
      messagesProcessed: this.messagesProcessed,
      messagesFailed: this.messagesFailed,
      avgProcessingTimeMs: this.messagesProcessed > 0
        ? this.totalProcessingTime / this.messagesProcessed
        : 0,
    };
  }

  /**
   * Poll for work across all active sessions
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      // Check if we have capacity
      const available = this.concurrency - this.activeWorkers.size;
      if (available <= 0) {
        this.schedulePoll();
        return;
      }

      // Get active sessions
      const sessions = this.sessionManager.getActiveSessions();

      // Look for work in each session
      for (const session of sessions) {
        if (this.activeWorkers.size >= this.concurrency) break;

        // Check if this session already has max workers
        const sessionWorkerCount = this.countSessionWorkers(session.sessionId);
        if (sessionWorkerCount >= 3) continue; // Max 3 workers per session

        // Try to get work for this session
        const entry = await this.storage.queuePollOne(session.sessionId, session.config.entryAgent || `${session.meshId}/worker`);

        if (entry) {
          this.spawnWorker(session, entry);
        }
      }
    } catch (err) {
      log.error('worker-pool', 'Poll error', { error: (err as Error).message });
    }

    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
    }
  }

  private countSessionWorkers(sessionId: string): number {
    let count = 0;
    for (const worker of this.activeWorkers.values()) {
      if (worker.sessionId === sessionId) count++;
    }
    return count;
  }

  /**
   * Spawn a worker to process a message
   */
  private spawnWorker(session: SessionInfo, entry: QueueEntry): void {
    const workerId = `${session.sessionId}:${entry.id}`;
    const agentId = entry.message.to;

    const startedAt = Date.now();
    const promise = this.processMessage(session, entry)
      .then(() => {
        const durationMs = Date.now() - startedAt;
        this.messagesProcessed++;
        this.totalProcessingTime += durationMs;

        log.info('worker-pool', 'Worker complete', { workerId, durationMs });
        this.emit('worker:complete', { sessionId: session.sessionId, agentId, durationMs });
      })
      .catch((err) => {
        this.messagesFailed++;

        log.error('worker-pool', 'Worker error', { workerId, error: (err as Error).message });
        this.emit('worker:error', { sessionId: session.sessionId, agentId, error: (err as Error).message });
      })
      .finally(() => {
        this.activeWorkers.delete(workerId);
        this.sessionManager.setWorkerCount(session.sessionId, this.countSessionWorkers(session.sessionId));
      });

    this.activeWorkers.set(workerId, { sessionId: session.sessionId, agentId, startedAt, promise });
    this.sessionManager.setWorkerCount(session.sessionId, this.countSessionWorkers(session.sessionId));

    log.info('worker-pool', 'Worker spawned', { workerId, agentId });
    this.emit('worker:start', { sessionId: session.sessionId, agentId });
  }

  /**
   * Process a single message
   */
  private async processMessage(session: SessionInfo, entry: QueueEntry): Promise<void> {
    const message = entry.message;

    // Load mesh config
    const meshConfig = await this.meshConfigLoader(session.meshId);
    if (!meshConfig) {
      throw new Error(`Mesh config not found: ${session.meshId}`);
    }

    // Get agent config
    const agentName = message.to.split('/')[1] || 'worker';
    const agentConfig = meshConfig.agents[agentName];
    if (!agentConfig) {
      throw new Error(`Agent not found: ${agentName} in mesh ${session.meshId}`);
    }

    // Build system prompt
    const systemPrompt = agentConfig.prompt;

    // Build user prompt from message
    const userPrompt = this.buildUserPrompt(message);

    // Get conversation ID for resume (if any)
    const conversationId = await this.storage.getConversationId(session.sessionId, message.to);

    // Run Claude SDK query
    const result = await query({
      model: agentConfig.model || 'sonnet',
      systemPrompt,
      prompt: userPrompt,
      options: {
        maxTurns: agentConfig.maxTurns || 10,
      },
      ...(conversationId ? { resumeConversationId: conversationId } : {}),
    });

    // Store conversation ID for future resume
    if (result.conversationId) {
      await this.storage.setConversationId(session.sessionId, message.to, result.conversationId);
    }

    // Extract response and write back
    const responseText = this.extractResponseText(result);

    // Write response message
    const responseMessage: AgentMessage = {
      from: message.to,
      to: message.from,
      type: 'response',
      body: responseText,
      refMsgId: message.msgId,
      timestamp: Date.now(),
    };

    await this.storage.writeMessage(session.sessionId, responseMessage);

    // Touch session to update activity
    await this.sessionManager.touch(session.sessionId);
    this.sessionManager.incrementMessageCount(session.sessionId);
  }

  /**
   * Build user prompt from message
   */
  private buildUserPrompt(message: AgentMessage): string {
    const parts: string[] = [];

    if (message.headline) {
      parts.push(`## ${message.headline}`);
    }

    parts.push(message.body);

    if (message.metadata) {
      parts.push('\n---');
      parts.push('Metadata:');
      for (const [key, value] of Object.entries(message.metadata)) {
        parts.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Extract response text from SDK result
   */
  private extractResponseText(result: { messages?: Array<{ content?: unknown }> }): string {
    if (!result.messages || result.messages.length === 0) {
      return '[No response]';
    }

    const lastMessage = result.messages[result.messages.length - 1];
    if (!lastMessage.content) {
      return '[Empty response]';
    }

    // Content could be string or array of content blocks
    if (typeof lastMessage.content === 'string') {
      return lastMessage.content;
    }

    if (Array.isArray(lastMessage.content)) {
      return lastMessage.content
        .filter((block: unknown) => {
          const b = block as { type?: string };
          return b.type === 'text';
        })
        .map((block: unknown) => {
          const b = block as { text?: string };
          return b.text || '';
        })
        .join('\n');
    }

    return '[Unknown response format]';
  }
}

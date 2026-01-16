/**
 * Worker State Machine
 *
 * Manages lifecycle of ephemeral SDK workers:
 * pending → initializing → running → idle ⟲ → complete
 *                             ↓
 *                          error → retry (with limits)
 */

import { StateMachine, ValidationError } from '../core/state-machine.ts';
import type { Context } from '../core/state-machine.ts';
import type { WorkerConfig, WorkerResult } from '../../shared/types.ts';
import type { Message } from '../../queue/index.ts';
import { log } from '../../shared/logger.ts';

export type WorkerState =
  | { status: 'pending'; config: WorkerConfig }
  | { status: 'initializing'; config: WorkerConfig; startedAt: number }
  | { status: 'running'; config: WorkerConfig; startedAt: number; pid: number }
  | { status: 'idle'; config: WorkerConfig; startedAt: number; pid: number; lastMessage?: Message }
  | { status: 'awaiting'; config: WorkerConfig; startedAt: number; pid: number; awaitingResponses: Set<string>; awaitStartedAt: number }
  | { status: 'complete'; config: WorkerConfig; startedAt: number; endedAt: number; result: WorkerResult }
  | { status: 'error'; config: WorkerConfig; startedAt: number; endedAt: number; error: string };

export interface WorkerContext extends Context {
  readonly id: string;
  readonly createdAt: number;
  readonly mesh: string;
  readonly agent: string;
  messagesProcessed: number;
  readonly maxRetries: number;
  retryCount: number;
  /** Session ID for resume when awaiting responses */
  awaitSessionId?: string;
  /** Timeout ID for await timeout */
  awaitTimeoutId?: ReturnType<typeof setTimeout>;
  /** Configured await timeout in ms (default 5 minutes) */
  awaitTimeout: number;
  /** Whether this worker is the completion agent (parity gates only apply to completion agent) */
  readonly isCompletionAgent: boolean;
}

export class WorkerStateMachine extends StateMachine<WorkerState, WorkerContext> {
  constructor(id: string, config: WorkerConfig, meshName: string, agentName: string, awaitTimeout: number = 300000, isCompletionAgent: boolean = false) {
    super(id, { status: 'pending', config }, {
      id,
      createdAt: Date.now(),
      mesh: meshName,
      agent: agentName,
      messagesProcessed: 0,
      maxRetries: 3,
      retryCount: 0,
      awaitTimeout,
      isCompletionAgent
    });

    this.setupGuards();
  }

  private setupGuards(): void {
    // Guard: pending → initializing
    this.registerGuard('initialize', async (from) => {
      if (from.status !== 'pending') {
        return { valid: false, reason: `Cannot initialize from ${from.status}` };
      }
      return { valid: true };
    });

    // Guard: initializing → running
    this.registerGuard('start', async (from, to) => {
      if (from.status !== 'initializing') {
        return { valid: false, reason: `Cannot start from ${from.status}` };
      }
      const toState = to as any;
      if (!toState.pid || toState.pid <= 0) {
        return { valid: false, reason: 'PID must be positive' };
      }
      return { valid: true };
    });

    // Guard: running → idle
    this.registerGuard('idle', async (from) => {
      if (from.status !== 'running') {
        return { valid: false, reason: `Cannot idle from ${from.status}` };
      }
      return { valid: true };
    });

    // Guard: idle → running
    this.registerGuard('resume', async (from) => {
      if (from.status !== 'idle') {
        return { valid: false, reason: `Cannot resume from ${from.status}` };
      }
      return { valid: true };
    });

    // Guard: running|idle|awaiting → complete
    // Parity check only applies to completion_agent (prevents flooding core with task-completes)
    this.registerGuard('complete', async (from, _to, context) => {
      if (from.status !== 'running' && from.status !== 'idle' && from.status !== 'awaiting') {
        return { valid: false, reason: `Cannot complete from ${from.status}` };
      }
      // Only block completion for the completion_agent when awaiting responses
      // Other agents can complete back to their parent without waiting
      if (context.isCompletionAgent && from.status === 'awaiting') {
        const awaitingSet = (from as { awaitingResponses?: Set<string> }).awaitingResponses;
        if (awaitingSet && awaitingSet.size > 0) {
          const pending = Array.from(awaitingSet).join(', ');
          return {
            valid: false,
            reason: `PROTOCOL VIOLATION: Cannot complete with outstanding asks pending: [${pending}]`
          };
        }
      }
      return { valid: true };
    });

    // Guard: running → error
    this.registerGuard('error', async (from) => {
      if (from.status !== 'running' && from.status !== 'initializing') {
        return { valid: false, reason: `Cannot error from ${from.status}` };
      }
      return { valid: true };
    });

    // Guard: error → initializing (retry)
    this.registerGuard('retry', async (from, to, context) => {
      if (from.status !== 'error') {
        return { valid: false, reason: `Cannot retry from ${from.status}` };
      }
      if (context.retryCount >= context.maxRetries) {
        return {
          valid: false,
          reason: `Max retries (${context.maxRetries}) exceeded`
        };
      }
      return { valid: true };
    });

    // Guard: running|idle → awaiting
    this.registerGuard('await', async (from) => {
      if (from.status !== 'running' && from.status !== 'idle') {
        return { valid: false, reason: `Cannot await from ${from.status}` };
      }
      return { valid: true };
    });

    // Guard: awaiting → running (response received)
    this.registerGuard('awaitResume', async (from) => {
      if (from.status !== 'awaiting') {
        return { valid: false, reason: `Cannot resume await from ${from.status}` };
      }
      return { valid: true };
    });

    // Guard: awaiting → awaiting (additional ask)
    this.registerGuard('awaitMore', async (from) => {
      if (from.status !== 'awaiting') {
        return { valid: false, reason: `Cannot add await from ${from.status}` };
      }
      return { valid: true };
    });

    // Guard: awaiting → error (timeout)
    this.registerGuard('awaitTimeout', async (from) => {
      if (from.status !== 'awaiting') {
        return { valid: false, reason: `Cannot timeout from ${from.status}` };
      }
      return { valid: true };
    });
  }

  /**
   * Transition: pending → initializing
   */
  async initialize(): Promise<void> {
    const from = this.state;
    if (from.status !== 'pending') {
      log.warn('fsm', `Cannot initialize from ${from.status}, ignoring`, { entityId: this.id, status: from.status });
      return;
    }

    await this.transition('initialize', {
      status: 'initializing',
      config: from.config,
      startedAt: Date.now()
    });
  }

  /**
   * Transition: initializing → running
   */
  async start(pid: number): Promise<void> {
    const from = this.state;
    if (from.status !== 'initializing') {
      throw new Error(`Cannot start from ${from.status}`);
    }

    await this.transition('start', {
      status: 'running',
      config: from.config,
      startedAt: (from as any).startedAt,
      pid
    });
  }

  /**
   * Transition: running → idle
   */
  async markIdle(message?: Message): Promise<void> {
    const from = this.state;
    if (from.status !== 'running') {
      log.warn('fsm', `Cannot idle from ${from.status}, ignoring`, { entityId: this.id, status: from.status });
      return;
    }

    this.context.messagesProcessed++;

    await this.transition('idle', {
      status: 'idle',
      config: from.config,
      startedAt: (from as any).startedAt,
      pid: (from as any).pid,
      lastMessage: message
    });
  }

  /**
   * Transition: idle → running
   */
  async processNext(): Promise<void> {
    const from = this.state;
    if (from.status !== 'idle') {
      log.warn('fsm', `Cannot resume from ${from.status}, ignoring`, { entityId: this.id, status: from.status });
      return;
    }

    await this.transition('resume', {
      status: 'running',
      config: from.config,
      startedAt: (from as any).startedAt,
      pid: (from as any).pid
    });
  }

  /**
   * Transition: running|idle|awaiting → complete
   */
  async complete(result: WorkerResult): Promise<void> {
    const from = this.state;
    if (from.status !== 'running' && from.status !== 'idle' && from.status !== 'awaiting') {
      log.warn('fsm', `Cannot complete from ${from.status}, ignoring`, { entityId: this.id, status: from.status });
      return;
    }

    // Clear any await timeout
    if (this.context.awaitTimeoutId) {
      clearTimeout(this.context.awaitTimeoutId);
      this.context.awaitTimeoutId = undefined;
    }

    const startedAt = (from as any).startedAt || Date.now();

    await this.transition('complete', {
      status: 'complete',
      config: from.config,
      startedAt,
      endedAt: Date.now(),
      result
    }, { messagesProcessed: this.context.messagesProcessed });
  }

  /**
   * Transition: running → error
   */
  async error(errorMessage: string): Promise<void> {
    const from = this.state;
    if (from.status !== 'running' && from.status !== 'initializing') {
      log.warn('fsm', `Cannot error from ${from.status}, ignoring`, { entityId: this.id, status: from.status });
      return;
    }

    // Log error state entry with full context for debugging
    log.error('fsm', `Worker entering error state`, {
      entityId: this.id,
      fromStatus: from.status,
      errorMessage,
      messagesProcessed: this.context.messagesProcessed,
      retryCount: this.context.retryCount,
      stack: new Error().stack  // Capture call stack
    });

    const startedAt = (from as any).startedAt || Date.now();

    await this.transition('error', {
      status: 'error',
      config: from.config,
      startedAt,
      endedAt: Date.now(),
      error: errorMessage
    });
  }

  /**
   * Transition: error → initializing (retry)
   */
  async retry(): Promise<void> {
    const from = this.state;
    if (from.status !== 'error') {
      log.warn('fsm', `Cannot retry from ${from.status}, ignoring`, { entityId: this.id, status: from.status });
      return;
    }

    // Check retry limit BEFORE incrementing
    if (this.context.retryCount >= this.context.maxRetries) {
      throw new Error(`Max retries exceeded: ${this.context.maxRetries}`);
    }

    this.context.retryCount++;

    await this.transition('retry', {
      status: 'initializing',
      config: from.config,
      startedAt: Date.now()
    });
  }

  /**
   * Transition: running|idle → awaiting
   * Enters when worker writes an `ask` message to another agent.
   *
   * @param targetAgent The agent ID we're waiting for a response from
   * @param sessionId The session ID to preserve for resume
   */
  async enterAwait(targetAgent: string, sessionId: string): Promise<void> {
    const from = this.state;
    if (from.status !== 'running' && from.status !== 'idle') {
      throw new Error(`Cannot await from ${from.status}`);
    }

    // Store session ID for resume
    this.context.awaitSessionId = sessionId;

    await this.transition('await', {
      status: 'awaiting',
      config: from.config,
      startedAt: (from as any).startedAt,
      pid: (from as any).pid,
      awaitingResponses: new Set([targetAgent]),
      awaitStartedAt: Date.now()
    });
  }

  /**
   * Transition: awaiting → awaiting (add another target)
   * When worker sends additional ask messages while already awaiting.
   *
   * @param targetAgent Additional agent ID to wait for
   */
  async addAwaitTarget(targetAgent: string): Promise<void> {
    const from = this.state;
    if (from.status !== 'awaiting') {
      log.warn('fsm', `Cannot add await target from ${from.status}, ignoring`, { entityId: this.id, status: from.status, targetAgent });
      return;
    }

    const newSet = new Set(from.awaitingResponses);
    newSet.add(targetAgent);

    await this.transition('awaitMore', {
      status: 'awaiting',
      config: from.config,
      startedAt: from.startedAt,
      pid: from.pid,
      awaitingResponses: newSet,
      awaitStartedAt: from.awaitStartedAt
    });
  }

  /**
   * Handle response received from an awaiting target.
   * If all responses received, transitions to running for resume.
   * If more responses pending, stays in awaiting.
   *
   * @param respondingAgent The agent ID that responded
   * @returns true if all responses received (ready to resume), false if still waiting
   */
  async receiveResponse(respondingAgent: string): Promise<boolean> {
    const from = this.state;
    if (from.status !== 'awaiting') {
      log.warn('fsm', `Cannot receive response from ${from.status}, ignoring`, { entityId: this.id, status: from.status, respondingAgent });
      return false;
    }

    const newSet = new Set(from.awaitingResponses);
    newSet.delete(respondingAgent);

    if (newSet.size === 0) {
      // All responses received, transition to running
      await this.transition('awaitResume', {
        status: 'running',
        config: from.config,
        startedAt: from.startedAt,
        pid: from.pid
      });
      return true;
    }

    // Still waiting for more responses
    await this.transition('awaitMore', {
      status: 'awaiting',
      config: from.config,
      startedAt: from.startedAt,
      pid: from.pid,
      awaitingResponses: newSet,
      awaitStartedAt: from.awaitStartedAt
    });
    return false;
  }

  /**
   * Transition: awaiting → error (timeout)
   * Called when await timeout expires.
   */
  async awaitTimeoutError(): Promise<void> {
    const from = this.state;
    if (from.status !== 'awaiting') {
      log.warn('fsm', `Cannot timeout from ${from.status}, ignoring`, { entityId: this.id, status: from.status });
      return;
    }

    const pending = Array.from(from.awaitingResponses).join(', ');

    await this.transition('awaitTimeout', {
      status: 'error',
      config: from.config,
      startedAt: from.startedAt,
      endedAt: Date.now(),
      error: `Await timeout: still waiting for responses from [${pending}]`
    });
  }

  /**
   * Check if worker is in awaiting state
   */
  isAwaiting(): boolean {
    return this.state.status === 'awaiting';
  }

  /**
   * Get agents we're waiting for responses from
   */
  getAwaitingResponses(): Set<string> {
    if (this.state.status !== 'awaiting') return new Set();
    return new Set(this.state.awaitingResponses);
  }

  /**
   * Get the await session ID for resume
   */
  getAwaitSessionId(): string | undefined {
    return this.context.awaitSessionId;
  }

  /**
   * Get await duration (ms) - how long we've been waiting
   */
  getAwaitDuration(): number {
    if (this.state.status !== 'awaiting') return 0;
    return Date.now() - this.state.awaitStartedAt;
  }

  /**
   * Get messages processed count
   */
  getMessagesProcessed(): number {
    return this.context.messagesProcessed;
  }

  /**
   * Get duration (ms)
   */
  getDuration(): number {
    const state = this.state as any;
    if (!state.startedAt) return 0;
    const endTime = state.endedAt || Date.now();
    return endTime - state.startedAt;
  }

  /**
   * Get worker config
   */
  getConfig(): WorkerConfig {
    return this.state.config;
  }
}

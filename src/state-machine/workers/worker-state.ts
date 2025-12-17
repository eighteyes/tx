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

export type WorkerState =
  | { status: 'pending'; config: WorkerConfig }
  | { status: 'initializing'; config: WorkerConfig; startedAt: number }
  | { status: 'running'; config: WorkerConfig; startedAt: number; pid: number }
  | { status: 'idle'; config: WorkerConfig; startedAt: number; pid: number; lastMessage?: Message }
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
}

export class WorkerStateMachine extends StateMachine<WorkerState, WorkerContext> {
  constructor(id: string, config: WorkerConfig, meshName: string, agentName: string) {
    super(id, { status: 'pending', config }, {
      id,
      createdAt: Date.now(),
      mesh: meshName,
      agent: agentName,
      messagesProcessed: 0,
      maxRetries: 3,
      retryCount: 0
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

    // Guard: running|idle → complete
    this.registerGuard('complete', async (from) => {
      if (from.status !== 'running' && from.status !== 'idle') {
        return { valid: false, reason: `Cannot complete from ${from.status}` };
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
  }

  /**
   * Transition: pending → initializing
   */
  async initialize(): Promise<void> {
    const from = this.state;
    if (from.status !== 'pending') {
      throw new Error(`Cannot initialize from ${from.status}`);
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
      throw new Error(`Cannot idle from ${from.status}`);
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
      throw new Error(`Cannot resume from ${from.status}`);
    }

    await this.transition('resume', {
      status: 'running',
      config: from.config,
      startedAt: (from as any).startedAt,
      pid: (from as any).pid
    });
  }

  /**
   * Transition: running|idle → complete
   */
  async complete(result: WorkerResult): Promise<void> {
    const from = this.state;
    if (from.status !== 'running' && from.status !== 'idle') {
      throw new Error(`Cannot complete from ${from.status}`);
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
      throw new Error(`Cannot error from ${from.status}`);
    }

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
      throw new Error(`Cannot retry from ${from.status}`);
    }

    this.context.retryCount++;
    if (this.context.retryCount > this.context.maxRetries) {
      throw new Error(`Max retries exceeded: ${this.context.maxRetries}`);
    }

    await this.transition('retry', {
      status: 'initializing',
      config: from.config,
      startedAt: Date.now()
    });
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

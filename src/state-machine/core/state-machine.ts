/**
 * Base State Machine Implementation
 *
 * Provides abstract state machine with:
 * - Type-safe state transitions
 * - Guard validation
 * - Middleware hooks (pre/post)
 * - Event emission
 * - Immutable state snapshots
 * - Complete transition history
 */

import { EventEmitter } from 'node:events';

export interface Context {
  readonly id: string;
  readonly createdAt: number;
  [key: string]: unknown;
}

export interface GuardResult {
  valid: boolean;
  reason?: string;
}

export type Guard<S, C extends Context> = (
  fromState: S,
  toState: S,
  context: C
) => Promise<GuardResult>;

export interface Middleware<S, C extends Context> {
  pre?: (
    fromState: S,
    toState: S,
    transitionName: string,
    context: C
  ) => Promise<void>;

  post?: (
    fromState: S,
    toState: S,
    transitionName: string,
    context: C
  ) => Promise<void>;
}

export interface StateTransition<S> {
  from: S;
  to: S;
  transitionName: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public transitionName: string,
    public fromState: unknown,
    public toState: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export abstract class StateMachine<S, C extends Context> extends EventEmitter {
  protected id: string;
  protected state: S;
  protected context: C;
  protected history: StateTransition<S>[];
  protected validators: Map<string, Guard<S, C>[]>;
  protected middleware: Middleware<S, C>[];

  constructor(id: string, initialState: S, context: C) {
    super();
    this.id = id;
    this.state = initialState;
    this.context = context;
    this.history = [];
    this.validators = new Map();
    this.middleware = [];
  }

  /** Public read-only access to current state */
  get currentState(): S {
    return this.state;
  }

  /** Public read-only access to context */
  get currentContext(): C {
    return this.context;
  }

  registerGuard(transitionName: string, guard: Guard<S, C>): void {
    if (!this.validators.has(transitionName)) {
      this.validators.set(transitionName, []);
    }
    this.validators.get(transitionName)!.push(guard);
  }

  use(middleware: Middleware<S, C>): void {
    this.middleware.push(middleware);
  }

  protected async transition(
    transitionName: string,
    nextState: S,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // Pre-transition middleware
    for (const mw of this.middleware) {
      if (mw.pre) {
        await mw.pre(this.state, nextState, transitionName, this.context);
      }
    }

    // Validate guards
    const guards = this.validators.get(transitionName) || [];
    for (const guard of guards) {
      const result = await guard(this.state, nextState, this.context);
      if (!result.valid) {
        throw new ValidationError(
          `Guard failed for ${transitionName}: ${result.reason}`,
          transitionName,
          this.state,
          nextState
        );
      }
    }

    // Atomic state update
    const previousState = this.state;
    this.state = nextState;

    // Record in history
    this.history.push({
      from: previousState,
      to: nextState,
      transitionName,
      timestamp: Date.now(),
      metadata
    });

    // Emit transition event
    this.emit('transition', {
      id: this.id,
      transitionName,
      from: previousState,
      to: nextState,
      timestamp: Date.now(),
      metadata
    });

    // Post-transition middleware (effects)
    for (const mw of this.middleware) {
      if (mw.post) {
        await mw.post(previousState, this.state, transitionName, this.context);
      }
    }
  }

  getState(): Readonly<S> {
    return JSON.parse(JSON.stringify(this.state));
  }

  getHistory(): StateTransition<S>[] {
    return JSON.parse(JSON.stringify(this.history));
  }

  getStatus(): string {
    return (this.state as any).status ?? 'unknown';
  }

  async canTransition(transitionName: string, nextState: S): Promise<boolean> {
    const guards = this.validators.get(transitionName) || [];
    for (const guard of guards) {
      const result = await guard(this.state, nextState, this.context);
      if (!result.valid) return false;
    }
    return true;
  }

  getId(): string {
    return this.id;
  }

  getContext(): Readonly<C> {
    return JSON.parse(JSON.stringify(this.context));
  }
}

/**
 * MeshFSM - Core finite state machine for mesh workflow orchestration
 *
 * Provides:
 * - State tracking with SQLite persistence
 * - Exit-based routing (run → when → default)
 * - Script execution with fatal halt on failure
 * - Event emission for observability
 *
 * Follows existing WorkerStateMachine patterns with FSM-specific extensions.
 */

import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import { FSMPersistence, type FSMStateData } from './fsm-persistence.ts';
import { ScriptExecutor, type ScriptContext, type ScriptResult } from './fsm-scripts.ts';
import { ConditionEvaluator } from './fsm-evaluator.ts';
import { log } from '../shared/logger.ts';
import type { FSMExitConfig } from '../shared/types.ts';

// Re-export for convenience
export { FSMPersistence, type FSMStateData } from './fsm-persistence.ts';
export { ScriptExecutor, type ScriptContext, type ScriptResult } from './fsm-scripts.ts';
export { ConditionEvaluator } from './fsm-evaluator.ts';

// Import types from shared (keep local types for re-export compatibility)
import type {
  FSMConfig,
  FSMStateConfig,
  FSMStateType,
  FSMEnsembleConfig,
  FSMGateConfig,
  FSMTransitionConfig,
} from '../shared/types.ts';

// Re-export types for backward compatibility
export type {
  FSMConfig,
  FSMStateConfig,
  FSMStateType,
  FSMEnsembleConfig,
  FSMGateConfig,
  FSMTransitionConfig,
} from '../shared/types.ts';

/**
 * Transition event data
 */
export interface FSMTransitionEvent {
  meshName: string;
  from: string;
  to: string;
  trigger: string;
  triggerAgent?: string;
  timestamp: number;
  durationMs?: number;
}

/**
 * Gate check event data
 */
export interface FSMGateEvent {
  meshName: string;
  state: string;
  gate: FSMGateConfig;
  passed: boolean;
  retryCount: number;
  error?: string;
  timestamp: number;
}

/**
 * Script run event data
 */
export interface FSMScriptEvent {
  meshName: string;
  scriptType: 'onEnter' | 'onExit' | 'transition' | 'gate';
  scriptPath: string;
  success: boolean;
  durationMs: number;
  error?: string;
  timestamp: number;
}

export class MeshFSM extends EventEmitter {
  private meshName: string;
  private config: FSMConfig;
  private persistence: FSMPersistence;
  private scriptExecutor: ScriptExecutor;
  private conditionEvaluator: ConditionEvaluator;
  private stateData: FSMStateData | null = null;
  private stateMap: Map<string, FSMStateConfig>;
  private initialized = false;

  constructor(
    meshName: string,
    config: FSMConfig,
    db: Database.Database,
    workDir: string
  ) {
    super();
    this.meshName = meshName;
    this.config = config;
    this.persistence = new FSMPersistence(db);
    this.scriptExecutor = new ScriptExecutor({ workDir });
    this.conditionEvaluator = new ConditionEvaluator();

    // Build state lookup map
    this.stateMap = new Map();
    for (const state of config.states) {
      this.stateMap.set(state.name, state);
    }
  }

  /**
   * Initialize the FSM
   * Loads existing state from persistence or creates initial state
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize persistence layer
    this.persistence.initialize();

    // Load or create state
    this.stateData = this.persistence.getState(this.meshName);

    if (!this.stateData) {
      // Create initial state
      this.stateData = {
        meshName: this.meshName,
        currentState: this.config.initialState,
        context: this.config.context || {},
        gateRetries: {},
        lastTransitionAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.persistence.saveState(this.stateData);

      log.info('fsm', 'Created initial FSM state', {
        meshName: this.meshName,
        initialState: this.config.initialState,
      });

      // Execute onEnter for initial state
      await this.executeOnEnter(this.config.initialState);
    } else {
      log.info('fsm', 'Loaded existing FSM state', {
        meshName: this.meshName,
        currentState: this.stateData.currentState,
        lastTransitionAt: new Date(this.stateData.lastTransitionAt).toISOString(),
      });
    }

    this.initialized = true;
  }

  /**
   * Get current state name
   */
  getCurrentState(): string {
    return this.stateData?.currentState || this.config.initialState;
  }

  /**
   * Get current state configuration
   */
  getCurrentStateConfig(): FSMStateConfig | undefined {
    return this.stateMap.get(this.getCurrentState());
  }

  /**
   * Get FSM context variables
   */
  getContext(): Record<string, unknown> {
    return { ...this.stateData?.context };
  }

  /**
   * Evaluate exit routing for a state based on exit configuration
   * Determines next state using run, when clauses, or default ONLY
   *
   * Evaluation order:
   * 1. exit.run (literal state name OR script that echoes state)
   * 2. When clauses (first match wins)
   * 3. Default target
   * 4. null (no valid route - error)
   *
   * NOTE: Transitions table is NOT used for exit routing (deprecated).
   * Exit routing uses ONLY run, when clauses, and default fallback.
   *
   * @param exit - Exit configuration from state
   * @param context - FSM context variables
   * @returns Next state name, or null if no route found
   */
  async evaluateExitRouting(
    exit: FSMExitConfig,
    context: Record<string, unknown>
  ): Promise<string | null> {
    // 1. Check exit.run
    if (exit.run) {
      const trimmed = exit.run.trim();

      // Check if it's a literal state name
      if (this.stateMap.has(trimmed)) {
        log.debug('fsm', 'Exit routing: run literal state', {
          meshName: this.meshName,
          target: trimmed,
        });
        return trimmed;
      }

      // Otherwise treat as script (inline)
      try {
        const scriptContext = this.buildScriptContext(context);
        const result = await this.scriptExecutor.executeInline(exit.run, scriptContext);

        if (result.success) {
          const output = result.stdout.trim();

          // Validate output is a valid state
          if (this.stateMap.has(output)) {
            log.debug('fsm', 'Exit routing: run script output', {
              meshName: this.meshName,
              target: output,
              scriptOutput: result.stdout,
            });
            return output;
          } else {
            log.error('fsm', 'Exit routing: run script output invalid state', {
              meshName: this.meshName,
              output,
              validStates: Array.from(this.stateMap.keys()),
            });
          }
        } else {
          log.error('fsm', 'Exit routing: run script failed', {
            meshName: this.meshName,
            exitCode: result.exitCode,
            stderr: result.stderr,
          });
        }
      } catch (error) {
        log.error('fsm', 'Exit routing: run script exception', {
          meshName: this.meshName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 2. Check when clauses (first match wins)
    if (exit.when && exit.when.length > 0) {
      for (const clause of exit.when) {
        const matches = this.conditionEvaluator.evaluate(clause.condition, context);

        if (matches) {
          log.debug('fsm', 'Exit routing: when clause matched', {
            meshName: this.meshName,
            condition: clause.condition,
            target: clause.target,
          });
          return clause.target;
        }
      }

      log.debug('fsm', 'Exit routing: no when clause matched', {
        meshName: this.meshName,
        whenClauseCount: exit.when.length,
      });
    }

    // 3. Check default
    if (exit.default) {
      log.debug('fsm', 'Exit routing: using default', {
        meshName: this.meshName,
        target: exit.default,
      });
      return exit.default;
    }

    // 4. No route found - error condition
    log.warn('fsm', 'Exit routing: no route found', {
      meshName: this.meshName,
      hasRun: !!exit.run,
      hasWhen: !!exit.when,
      hasDefault: !!exit.default,
    });

    return null;
  }

  /**
   * Build script context from FSM context
   * Converts context variables to ScriptContext format
   */
  private buildScriptContext(context: Record<string, unknown>): ScriptContext {
    const scriptContext: ScriptContext = {
      fsmState: this.getCurrentState(),
      fsmMeshName: this.meshName,
      ...context,
    };
    return scriptContext;
  }

  /**
   * Update FSM context variables
   */
  updateContext(updates: Record<string, unknown>): void {
    if (!this.stateData) return;

    this.stateData.context = {
      ...this.stateData.context,
      ...updates,
    };
    this.stateData.updatedAt = Date.now();
    this.persistence.saveState(this.stateData);

    log.debug('fsm', 'Updated FSM context', {
      meshName: this.meshName,
      updates,
    });
  }

  /**
   * Execute onEnter script for a state
   */
  private async executeOnEnter(stateName: string): Promise<void> {
    const stateConfig = this.stateMap.get(stateName);
    if (!stateConfig?.onEnter) return;

    const context: ScriptContext = {
      fsmState: stateName,
      fsmMeshName: this.meshName,
      ...this.stateData?.context,
    };

    await this.executeScript('onEnter', stateConfig.onEnter, context);
  }

  /**
   * Execute a script with error handling
   * Script failures are FATAL - throw error to halt mesh
   */
  private async executeScript(
    scriptType: 'onEnter' | 'onExit' | 'transition' | 'gate',
    scriptPath: string,
    context: ScriptContext
  ): Promise<ScriptResult> {
    log.debug('fsm', 'Executing script', {
      meshName: this.meshName,
      scriptType,
      scriptPath,
    });

    const result = await this.scriptExecutor.execute(scriptPath, context);

    const scriptEvent: FSMScriptEvent = {
      meshName: this.meshName,
      scriptType,
      scriptPath,
      success: result.success,
      durationMs: result.durationMs,
      error: result.success ? undefined : result.stderr,
      timestamp: Date.now(),
    };
    this.emit('fsm:script-run', scriptEvent);

    if (!result.success) {
      log.error('fsm', 'Script execution failed - FATAL', {
        meshName: this.meshName,
        scriptType,
        scriptPath,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stderr: result.stderr.slice(0, 500),
      });

      // Script failures are FATAL per architecture spec
      throw new Error(
        `FSM script failed: ${scriptPath} (${scriptType}) - ` +
        (result.timedOut ? 'timed out' : `exit code ${result.exitCode}`)
      );
    }

    // Update context with script outputs
    if (Object.keys(result.outputs).length > 0) {
      this.updateContext(result.outputs);
    }

    log.debug('fsm', 'Script completed', {
      meshName: this.meshName,
      scriptType,
      scriptPath,
      durationMs: result.durationMs,
      outputs: Object.keys(result.outputs),
    });

    return result;
  }

  /**
   * Force transition to a state (manual override)
   * Bypasses gates but still runs scripts
   */
  async forceTransition(
    toState: string,
    reason: string
  ): Promise<boolean> {
    if (!this.initialized || !this.stateData) {
      log.warn('fsm', 'FSM not initialized', { meshName: this.meshName });
      return false;
    }

    const fromState = this.stateData.currentState;
    const toStateConfig = this.stateMap.get(toState);

    if (!toStateConfig) {
      log.error('fsm', 'Invalid target state', {
        meshName: this.meshName,
        toState,
      });
      return false;
    }

    log.warn('fsm', 'Forcing transition', {
      meshName: this.meshName,
      from: fromState,
      to: toState,
      reason,
    });

    // Create backup before forced transition
    this.persistence.createBackup(this.meshName, `force-transition: ${reason}`);

    const scriptContext: ScriptContext = {
      fsmState: fromState,
      fsmMeshName: this.meshName,
      fsmTransition: `${fromState}->${toState}`,
      ...this.stateData.context,
    };

    // Execute onExit
    const fromStateConfig = this.stateMap.get(fromState);
    if (fromStateConfig?.onExit) {
      await this.executeScript('onExit', fromStateConfig.onExit, scriptContext);
    }

    // Update state
    this.stateData.currentState = toState;
    this.stateData.lastTransitionAt = Date.now();
    this.stateData.updatedAt = Date.now();
    delete this.stateData.gateRetries[toState];
    this.persistence.saveState(this.stateData);

    // Emit transition event
    this.emit('fsm:transition', {
      meshName: this.meshName,
      from: fromState,
      to: toState,
      trigger: 'manual',
      triggerAgent: 'system',
      timestamp: Date.now(),
    } as FSMTransitionEvent);

    // Execute onEnter
    if (toStateConfig.onEnter) {
      await this.executeOnEnter(toState);
    }

    return true;
  }

  /**
   * Reset FSM to initial state
   */
  async reset(reason: string): Promise<void> {
    if (!this.stateData) return;

    // Create backup before reset
    this.persistence.createBackup(this.meshName, `reset: ${reason}`);

    const previousState = this.stateData.currentState;

    // Reset to initial state
    this.stateData.currentState = this.config.initialState;
    this.stateData.context = this.config.context || {};
    this.stateData.gateRetries = {};
    this.stateData.lastTransitionAt = Date.now();
    this.stateData.updatedAt = Date.now();
    this.persistence.saveState(this.stateData);

    log.info('fsm', 'FSM reset to initial state', {
      meshName: this.meshName,
      previousState,
      initialState: this.config.initialState,
      reason,
    });

    // Emit reset event
    this.emit('fsm:reset', {
      meshName: this.meshName,
      previousState,
      initialState: this.config.initialState,
      reason,
      timestamp: Date.now(),
    });

    // Execute onEnter for initial state
    await this.executeOnEnter(this.config.initialState);
  }

  /**
   * Get FSM status for inspection
   */
  getStatus(): {
    meshName: string;
    currentState: string;
    context: Record<string, unknown>;
    gateRetries: Record<string, number>;
    availableTransitions: string[];
    lastTransitionAt: number;
  } {
    return {
      meshName: this.meshName,
      currentState: this.getCurrentState(),
      context: this.getContext(),
      gateRetries: { ...this.stateData?.gateRetries },
      availableTransitions: this.getAvailableTransitions(),
      lastTransitionAt: this.stateData?.lastTransitionAt || 0,
    };
  }

  /**
   * Get all state configurations
   */
  getStates(): FSMStateConfig[] {
    return [...this.config.states];
  }

  /**
   * Check if FSM is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get persistence layer (for testing/debugging)
   */
  getPersistence(): FSMPersistence {
    return this.persistence;
  }

  /**
   * Get script executor (for testing/debugging)
   */
  getScriptExecutor(): ScriptExecutor {
    return this.scriptExecutor;
  }

  /**
   * Handle an incoming message and check for state transitions
   *
   * Checks if the message triggers a transition from the current state
   * based on the configured transitions table.
   *
   * @param from - Agent that sent the message (e.g., "mesh/agent")
   * @param to - Agent receiving the message
   * @param messageType - Type of message (e.g., 'ask', 'task-complete')
   * @param frontmatter - Message frontmatter for context updates
   * @returns true if a transition occurred, false otherwise
   */
  async handleMessage(
    from: string,
    to: string,
    messageType: string,
    frontmatter: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.initialized || !this.stateData) {
      log.warn('fsm', 'FSM not initialized, cannot handle message', {
        meshName: this.meshName,
      });
      return false;
    }

    const currentState = this.stateData.currentState;
    const fromAgent = from.split('/')[1]; // Extract agent name from "mesh/agent"

    // Find matching transition
    const transition = this.config.transitions.find(t =>
      t.from === currentState &&
      t.trigger === messageType &&
      (!t.triggerAgent || t.triggerAgent === fromAgent)
    );

    if (!transition) {
      log.debug('fsm', 'No matching transition for message', {
        meshName: this.meshName,
        currentState,
        trigger: messageType,
        from: fromAgent,
      });
      return false;
    }

    const toState = transition.to;
    const toStateConfig = this.stateMap.get(toState);

    if (!toStateConfig) {
      log.error('fsm', 'Invalid transition target state', {
        meshName: this.meshName,
        from: currentState,
        to: toState,
      });
      return false;
    }

    log.info('fsm', 'Transitioning state', {
      meshName: this.meshName,
      from: currentState,
      to: toState,
      trigger: messageType,
      triggerAgent: fromAgent,
    });

    const transitionStartTime = Date.now();

    // Create script context
    const scriptContext: ScriptContext = {
      fsmState: currentState,
      fsmMeshName: this.meshName,
      fsmTransition: `${currentState}->${toState}`,
      fsmTrigger: messageType,
      fsmTriggerAgent: fromAgent,
      ...this.stateData.context,
    };

    // Execute onExit for current state
    const currentStateConfig = this.stateMap.get(currentState);
    if (currentStateConfig?.onExit) {
      await this.executeScript('onExit', currentStateConfig.onExit, scriptContext);
    }

    // Execute transition script if defined
    if (transition.script) {
      await this.executeScript('transition', transition.script, scriptContext);
    }

    // Update state
    this.stateData.currentState = toState;
    this.stateData.lastTransitionAt = Date.now();
    this.stateData.updatedAt = Date.now();
    delete this.stateData.gateRetries[toState]; // Reset gate retries for new state
    this.persistence.saveState(this.stateData);

    // Emit transition event
    const transitionEvent: FSMTransitionEvent = {
      meshName: this.meshName,
      from: currentState,
      to: toState,
      trigger: messageType,
      triggerAgent: fromAgent,
      timestamp: Date.now(),
      durationMs: Date.now() - transitionStartTime,
    };
    this.emit('fsm:transition', transitionEvent);

    // Execute onEnter for new state
    if (toStateConfig.onEnter) {
      await this.executeOnEnter(toState);
    }

    return true;
  }

  /**
   * Get available transitions from current state
   */
  getAvailableTransitions(): string[] {
    if (!this.stateData) return [];

    const currentState = this.stateData.currentState;
    return this.config.transitions
      .filter(t => t.from === currentState)
      .map(t => `${t.trigger}${t.triggerAgent ? `:${t.triggerAgent}` : ''} -> ${t.to}`);
  }

  /**
   * Execute a transition to a specific state using exit-based routing
   * Used after an agent completes (for exit routing with gates)
   *
   * @param toState - Target state to transition to
   * @param trigger - Trigger type (e.g., 'task-complete')
   * @param triggerAgent - Agent that triggered the transition
   * @returns true if transition succeeded
   */
  async transitionTo(
    toState: string,
    trigger: string,
    triggerAgent?: string
  ): Promise<boolean> {
    if (!this.initialized || !this.stateData) {
      log.warn('fsm', 'FSM not initialized', { meshName: this.meshName });
      return false;
    }

    const fromState = this.stateData.currentState;
    const toStateConfig = this.stateMap.get(toState);

    if (!toStateConfig) {
      log.error('fsm', 'Invalid target state', {
        meshName: this.meshName,
        toState,
      });
      return false;
    }

    log.info('fsm', 'Executing exit-based transition', {
      meshName: this.meshName,
      from: fromState,
      to: toState,
      trigger,
      triggerAgent,
    });

    const transitionStartTime = Date.now();

    // Create script context
    const scriptContext: ScriptContext = {
      fsmState: fromState,
      fsmMeshName: this.meshName,
      fsmTransition: `${fromState}->${toState}`,
      fsmTrigger: trigger,
      fsmTriggerAgent: triggerAgent,
      ...this.stateData.context,
    };

    // Execute onExit for current state
    const fromStateConfig = this.stateMap.get(fromState);
    if (fromStateConfig?.onExit) {
      await this.executeScript('onExit', fromStateConfig.onExit, scriptContext);
    }

    // Update state
    this.stateData.currentState = toState;
    this.stateData.lastTransitionAt = Date.now();
    this.stateData.updatedAt = Date.now();
    delete this.stateData.gateRetries[toState];
    this.persistence.saveState(this.stateData);

    // Emit transition event
    const transitionEvent: FSMTransitionEvent = {
      meshName: this.meshName,
      from: fromState,
      to: toState,
      trigger,
      triggerAgent,
      timestamp: Date.now(),
      durationMs: Date.now() - transitionStartTime,
    };
    this.emit('fsm:transition', transitionEvent);

    // Execute onEnter for new state
    if (toStateConfig.onEnter) {
      await this.executeOnEnter(toState);
    }

    return true;
  }
}

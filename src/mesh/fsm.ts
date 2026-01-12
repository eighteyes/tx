/**
 * MeshFSM - Core finite state machine for mesh workflow orchestration
 *
 * Provides:
 * - State tracking with SQLite persistence
 * - Transition detection via recipient matching (eager on first ask)
 * - Gate validation with auto-retry (3x then allow)
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
  FSMGateConfig,
  FSMTransitionConfig,
} from '../shared/types.ts';

// Re-export types for backward compatibility
export type { FSMConfig, FSMStateConfig, FSMGateConfig, FSMTransitionConfig } from '../shared/types.ts';

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

const DEFAULT_MAX_RETRIES = 3;

export class MeshFSM extends EventEmitter {
  private meshName: string;
  private config: FSMConfig;
  private persistence: FSMPersistence;
  private scriptExecutor: ScriptExecutor;
  private conditionEvaluator: ConditionEvaluator;
  private stateData: FSMStateData | null = null;
  private stateMap: Map<string, FSMStateConfig>;
  private transitionMap: Map<string, FSMTransitionConfig[]>;  // from -> transitions
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

    // Build transition lookup map
    this.transitionMap = new Map();
    for (const transition of config.transitions) {
      const existing = this.transitionMap.get(transition.from) || [];
      existing.push(transition);
      this.transitionMap.set(transition.from, existing);
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
   * Check if an agent message should trigger a transition
   * Called when an ask message is detected (eager transition)
   *
   * @param fromAgent - Agent that sent the message
   * @param toAgent - Target agent of the message
   * @param messageType - Type of message (ask, task-complete, etc.)
   * @returns True if transition was triggered
   */
  async handleMessage(
    fromAgent: string,
    toAgent: string,
    messageType: string,
    messageFrontmatter?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.initialized || !this.stateData) {
      log.warn('fsm', 'FSM not initialized', { meshName: this.meshName });
      return false;
    }

    const currentState = this.stateData.currentState;
    const transitions = this.transitionMap.get(currentState) || [];

    // Find matching transition
    const trigger = messageType === 'ask' ? 'ask' :
                   messageType === 'task-complete' ? 'task-complete' : null;

    if (!trigger) return false;

    const matchingTransition = transitions.find(t => {
      if (t.trigger !== trigger) return false;
      if (t.triggerAgent && t.triggerAgent !== fromAgent) return false;
      return true;
    });

    if (!matchingTransition) {
      log.debug('fsm', 'No matching transition', {
        meshName: this.meshName,
        currentState,
        trigger,
        fromAgent,
      });
      return false;
    }

    // Found matching transition - attempt it
    return this.attemptTransition(
      matchingTransition,
      fromAgent,
      messageFrontmatter
    );
  }

  /**
   * Attempt a state transition
   * Runs gates, scripts, and updates state
   */
  private async attemptTransition(
    transition: FSMTransitionConfig,
    triggerAgent: string,
    messageFrontmatter?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.stateData) return false;

    const fromState = transition.from;
    const toState = transition.to;
    const toStateConfig = this.stateMap.get(toState);

    log.info('fsm', 'Attempting transition', {
      meshName: this.meshName,
      from: fromState,
      to: toState,
      trigger: transition.trigger,
      triggerAgent,
    });

    const startTime = Date.now();

    // Build script context
    const scriptContext: ScriptContext = {
      fsmState: fromState,
      fsmMeshName: this.meshName,
      fsmTransition: `${fromState}->${toState}`,
      msgFrom: messageFrontmatter?.from as string | undefined,
      msgTo: messageFrontmatter?.to as string | undefined,
      msgType: messageFrontmatter?.type as string | undefined,
      msgId: messageFrontmatter?.['msg-id'] as string | undefined,
      msgHeadline: messageFrontmatter?.headline as string | undefined,
      ...this.stateData.context,
    };

    // Check gates if target state has any
    if (toStateConfig?.gates && toStateConfig.gates.length > 0) {
      const gatesPassed = await this.checkGates(toState, toStateConfig.gates, scriptContext);
      if (!gatesPassed) {
        log.info('fsm', 'Transition blocked by gates', {
          meshName: this.meshName,
          from: fromState,
          to: toState,
        });
        return false;
      }
    }

    // Execute onExit for current state
    const fromStateConfig = this.stateMap.get(fromState);
    if (fromStateConfig?.onExit) {
      await this.executeScript('onExit', fromStateConfig.onExit, scriptContext);
    }

    // Execute transition script if configured
    if (transition.script) {
      await this.executeScript('transition', transition.script, {
        ...scriptContext,
        fsmPreviousState: fromState,
        fsmState: toState,
      });
    }

    // Update state
    const previousState = this.stateData.currentState;
    this.stateData.currentState = toState;
    this.stateData.lastTransitionAt = Date.now();
    this.stateData.updatedAt = Date.now();
    // Clear gate retries for new state
    delete this.stateData.gateRetries[toState];
    this.persistence.saveState(this.stateData);

    // Emit transition event
    const transitionEvent: FSMTransitionEvent = {
      meshName: this.meshName,
      from: previousState,
      to: toState,
      trigger: transition.trigger,
      triggerAgent,
      timestamp: Date.now(),
      durationMs: Date.now() - startTime,
    };
    this.emit('fsm:transition', transitionEvent);

    log.info('fsm', 'Transition complete', {
      meshName: this.meshName,
      from: previousState,
      to: toState,
      durationMs: transitionEvent.durationMs,
    });

    // Execute onEnter for new state
    if (toStateConfig?.onEnter) {
      await this.executeOnEnter(toState);
    }

    return true;
  }

  /**
   * Check all gates for a state
   * Returns true if all gates pass (or max retries exceeded)
   */
  private async checkGates(
    stateName: string,
    gates: FSMGateConfig[],
    context: ScriptContext
  ): Promise<boolean> {
    if (!this.stateData) return false;

    for (const gate of gates) {
      const maxRetries = gate.maxRetries ?? DEFAULT_MAX_RETRIES;
      const currentRetries = this.stateData.gateRetries[stateName] || 0;

      const passed = await this.checkGate(gate, context);

      const gateEvent: FSMGateEvent = {
        meshName: this.meshName,
        state: stateName,
        gate,
        passed,
        retryCount: currentRetries,
        timestamp: Date.now(),
      };
      this.emit('fsm:gate-check', gateEvent);

      if (!passed) {
        if (currentRetries < maxRetries) {
          // Increment retry count and block
          this.stateData.gateRetries[stateName] = currentRetries + 1;
          this.persistence.updateGateRetries(this.meshName, stateName, currentRetries + 1);

          log.warn('fsm', 'Gate failed, will retry', {
            meshName: this.meshName,
            state: stateName,
            gateType: gate.type,
            retryCount: currentRetries + 1,
            maxRetries,
          });

          return false;
        } else {
          // Max retries exceeded - allow transition anyway
          log.warn('fsm', 'Gate failed but max retries exceeded, allowing transition', {
            meshName: this.meshName,
            state: stateName,
            gateType: gate.type,
            retryCount: currentRetries,
          });
          // Continue to next gate
        }
      }
    }

    return true;
  }

  /**
   * Check a single gate
   */
  private async checkGate(gate: FSMGateConfig, context: ScriptContext): Promise<boolean> {
    switch (gate.type) {
      case 'script':
        if (!gate.script) {
          log.error('fsm', 'Gate script not specified', { gateType: gate.type });
          return false;
        }
        const result = await this.scriptExecutor.execute(gate.script, context);
        return result.success;

      case 'agent-complete':
        // TODO: Check if specific agent has completed
        // For now, return true (would need dispatcher integration)
        log.debug('fsm', 'Agent-complete gate (not yet implemented)', {
          agent: gate.agent,
        });
        return true;

      case 'all-complete':
        // TODO: Check if all participants have completed
        // For now, return true (would need dispatcher integration)
        log.debug('fsm', 'All-complete gate (not yet implemented)');
        return true;

      default:
        log.warn('fsm', 'Unknown gate type', { gateType: gate.type });
        return true;
    }
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
    lastTransitionAt: number;
    availableTransitions: FSMTransitionConfig[];
  } {
    const currentState = this.getCurrentState();
    const availableTransitions = this.transitionMap.get(currentState) || [];

    return {
      meshName: this.meshName,
      currentState,
      context: this.getContext(),
      gateRetries: { ...this.stateData?.gateRetries },
      lastTransitionAt: this.stateData?.lastTransitionAt || 0,
      availableTransitions,
    };
  }

  /**
   * Get all state configurations
   */
  getStates(): FSMStateConfig[] {
    return [...this.config.states];
  }

  /**
   * Get all transitions
   */
  getTransitions(): FSMTransitionConfig[] {
    return [...this.config.transitions];
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
}

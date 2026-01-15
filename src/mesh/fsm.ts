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
import { SimpleExpressionEvaluator } from './fsm-expression.ts';
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

export class MeshFSM extends EventEmitter {
  private meshName: string;
  private config: FSMConfig;
  private persistence: FSMPersistence;
  private scriptExecutor: ScriptExecutor;
  private conditionEvaluator: ConditionEvaluator;
  private expressionEvaluator: SimpleExpressionEvaluator;
  private stateData: FSMStateData | null = null;
  private stateMap: Map<string, FSMStateConfig>;
  private initialized = false;
  private _initialState: string; // Normalized initial state name

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
    this.expressionEvaluator = new SimpleExpressionEvaluator();

    // Normalize initial state - support both 'initial' (yaml) and 'initialState' (internal)
    this._initialState = config.initialState || config.initial || '';

    // Build state lookup map - support both array and object formats
    this.stateMap = new Map();
    if (Array.isArray(config.states)) {
      // Array format: [{ name: 'state1', ... }, { name: 'state2', ... }]
      for (const state of config.states) {
        this.stateMap.set(state.name, state);
      }
    } else if (config.states && typeof config.states === 'object') {
      // Object format: { state1: { ... }, state2: { ... } }
      for (const [name, stateConfig] of Object.entries(config.states as Record<string, Omit<FSMStateConfig, 'name'>>)) {
        const normalizedState: FSMStateConfig = {
          name,
          ...stateConfig,
          // Transform 'agents' array to coordinator + participants if needed
          coordinator: (stateConfig as any).agents?.[0] || (stateConfig as any).coordinator,
          participants: (stateConfig as any).agents?.slice(1) || (stateConfig as any).participants,
        };
        // Remove the agents field if it was transformed
        if ((stateConfig as any).agents) {
          delete (normalizedState as any).agents;
        }
        this.stateMap.set(name, normalizedState);
      }
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
        currentState: this._initialState,
        context: this.config.context || {},
        gateRetries: {},
        lastTransitionAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.persistence.saveState(this.stateData);

      log.debug('mesh-fsm', 'Created initial FSM state', {
        meshName: this.meshName,
        initialState: this._initialState,
        context: this.stateData.context,
      });

      // Execute onEnter for initial state
      await this.executeOnEnter(this._initialState);
    } else {
      log.debug('mesh-fsm', 'Loaded existing FSM state', {
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
    return this.stateData?.currentState || this._initialState;
  }

  /**
   * Get current state configuration
   */
  getCurrentStateConfig(): FSMStateConfig | undefined {
    return this.stateMap.get(this.getCurrentState());
  }

  /**
   * Get configuration for a specific state by name
   */
  getStateConfig(stateName: string): FSMStateConfig | undefined {
    return this.stateMap.get(stateName);
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
        log.debug('mesh-fsm', 'Exit routing: run literal state', {
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
            log.debug('mesh-fsm', 'Exit routing: run script output', {
              meshName: this.meshName,
              target: output,
              scriptOutput: result.stdout,
            });
            return output;
          } else {
            log.error('mesh-fsm', 'Exit routing: run script output invalid state', {
              meshName: this.meshName,
              output,
              validStates: Array.from(this.stateMap.keys()),
            });
          }
        } else {
          log.error('mesh-fsm', 'Exit routing: run script failed', {
            meshName: this.meshName,
            exitCode: result.exitCode,
            stderr: result.stderr,
          });
        }
      } catch (error) {
        log.error('mesh-fsm', 'Exit routing: run script exception', {
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
          log.debug('mesh-fsm', 'Exit routing: when clause matched', {
            meshName: this.meshName,
            condition: clause.condition,
            target: clause.target,
          });
          return clause.target;
        }
      }

      log.debug('mesh-fsm', 'Exit routing: no when clause matched', {
        meshName: this.meshName,
        whenClauseCount: exit.when.length,
      });
    }

    // 3. Check default
    if (exit.default) {
      log.debug('mesh-fsm', 'Exit routing: using default', {
        meshName: this.meshName,
        target: exit.default,
      });
      return exit.default;
    }

    // 4. No route found - error condition
    log.warn('mesh-fsm', 'Exit routing: no route found', {
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

    log.debug('mesh-fsm', 'Updated FSM context', {
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
    log.debug('mesh-fsm', 'Executing script', {
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
      log.error('mesh-fsm', 'Script execution failed - FATAL', {
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

    log.debug('mesh-fsm', 'Script completed', {
      meshName: this.meshName,
      scriptType,
      scriptPath,
      durationMs: result.durationMs,
      outputs: Object.keys(result.outputs),
    });

    return result;
  }

  /**
   * Transition to a state with trigger information
   * Used by dispatcher after ensemble completion
   */
  async transitionTo(
    toState: string,
    trigger: string,
    triggerAgent: string
  ): Promise<boolean> {
    return this.forceTransition(toState, `${trigger} by ${triggerAgent}`);
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
      log.warn('mesh-fsm', 'FSM not initialized', { meshName: this.meshName });
      return false;
    }

    const fromState = this.stateData.currentState;
    const toStateConfig = this.stateMap.get(toState);

    if (!toStateConfig) {
      log.error('mesh-fsm', 'Invalid target state', {
        meshName: this.meshName,
        toState,
      });
      return false;
    }

    log.warn('mesh-fsm', 'Forcing transition', {
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

    // Log FSM context after state change
    log.debug('mesh-fsm', 'FSM state changed', {
      meshName: this.meshName,
      from: fromState,
      to: toState,
      context: this.stateData.context,
    });

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
    this.stateData.currentState = this._initialState;
    this.stateData.context = this.config.context || {};
    this.stateData.gateRetries = {};
    this.stateData.lastTransitionAt = Date.now();
    this.stateData.updatedAt = Date.now();
    this.persistence.saveState(this.stateData);

    log.debug('mesh-fsm', 'FSM reset to initial state', {
      meshName: this.meshName,
      previousState,
      initialState: this._initialState,
      reason,
      context: this.stateData.context,
    });

    // Emit reset event
    this.emit('fsm:reset', {
      meshName: this.meshName,
      previousState,
      initialState: this._initialState,
      reason,
      timestamp: Date.now(),
    });

    // Execute onEnter for initial state
    await this.executeOnEnter(this._initialState);
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
  } {
    return {
      meshName: this.meshName,
      currentState: this.getCurrentState(),
      context: this.getContext(),
      gateRetries: { ...this.stateData?.gateRetries },
      lastTransitionAt: this.stateData?.lastTransitionAt || 0,
    };
  }

  /**
   * Get all state configurations
   */
  getStates(): FSMStateConfig[] {
    // Return from the normalized stateMap to handle both array and object formats
    return Array.from(this.stateMap.values());
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
   * Handle a message and validate/execute FSM transitions
   *
   * This is the central validation point for ALL message types.
   * Called before type-specific routing happens.
   *
   * Flow:
   * 1. Get current state config
   * 2. Merge rearmatter into context
   * 3. Execute exit.set operations (bash variable assignments)
   * 4. Evaluate exit routing to determine next state
   * 5. Validate agent's routing matches FSM's next state
   * 6. Execute state transition if valid
   *
   * @param from - Sender agent ID (e.g., "ralph-loop/ralph-build")
   * @param to - Target agent ID (e.g., "ralph-loop/ralph-build" or "core/core")
   * @param messageType - Message type (task-complete, ask, ask-human, etc.)
   * @param frontmatter - Message frontmatter
   * @param rearmatter - Message rearmatter (contains success_signal, etc.)
   * @returns true if message passes validation, false if rejected
   */
  async handleMessage(
    from: string,
    to: string,
    messageType: string,
    frontmatter: Record<string, unknown>,
    rearmatter?: Record<string, unknown>
  ): Promise<boolean> {
    if (!this.initialized || !this.stateData) {
      log.warn('mesh-fsm', 'FSM not initialized, skipping validation', {
        meshName: this.meshName,
      });
      return true; // Allow message if FSM not ready
    }

    const currentState = this.getCurrentState();
    const stateConfig = this.stateMap.get(currentState);

    if (!stateConfig) {
      log.warn('mesh-fsm', 'No state config found for current state', {
        meshName: this.meshName,
        currentState,
      });
      return true; // Allow message if no state config
    }

    // If no exit config, allow message (state doesn't control routing)
    if (!stateConfig.exit) {
      log.debug('mesh-fsm', 'State has no exit config, allowing message', {
        meshName: this.meshName,
        currentState,
      });
      return true;
    }

    log.debug('mesh-fsm', 'Validating message with FSM', {
      meshName: this.meshName,
      currentState,
      from,
      to,
      messageType,
      hasRearmatter: !!rearmatter,
    });

    // Build context with message and rearmatter data
    const context: Record<string, unknown> = {
      ...this.stateData.context,
      message: frontmatter,
      rearmatter: rearmatter || {},
    };

    // Execute exit.set operations to extract values from rearmatter
    if (stateConfig.exit.set) {
      for (const [key, valueExpr] of Object.entries(stateConfig.exit.set)) {
        try {
          // Build evaluation context combining FSM context, rearmatter, and message
          const evalContext: Record<string, unknown> = {
            ...this.stateData.context,
          };

          // Add rearmatter values with prefix for namespacing
          if (rearmatter) {
            for (const [rmKey, rmValue] of Object.entries(rearmatter)) {
              if (typeof rmValue === 'string' || typeof rmValue === 'number' || typeof rmValue === 'boolean') {
                evalContext[`rearmatter_${rmKey}`] = rmValue;
              }
            }
          }

          // Try simple expression evaluation first (arithmetic and string concat)
          // This avoids shell execution for common patterns like "$iteration + 1"
          const simpleResult = this.expressionEvaluator.evaluate(valueExpr, evalContext);

          if (simpleResult.success && simpleResult.isSimpleExpression) {
            const output = String(simpleResult.value);
            context[key] = output;
            this.updateContext({ [key]: output });
            log.debug('mesh-fsm', 'Exit.set evaluated (simple expression)', {
              meshName: this.meshName,
              key,
              value: output,
              expression: valueExpr,
            });
            continue;  // Move to next set operation
          }

          // Fall back to shell execution for complex expressions
          log.debug('mesh-fsm', 'Exit.set falling back to shell execution', {
            meshName: this.meshName,
            key,
            expression: valueExpr,
            simpleError: simpleResult.error,
          });

          // Substitute context variables in the expression for shell
          let expr = valueExpr;

          // Replace $rearmatter with JSON string
          if (expr.includes('$rearmatter')) {
            expr = expr.replace(/\$rearmatter/g, JSON.stringify(rearmatter || {}));
          }

          // Replace $message with JSON string
          if (expr.includes('$message')) {
            expr = expr.replace(/\$message/g, JSON.stringify(frontmatter));
          }

          // Replace context variable references like $varname
          for (const [ctxKey, ctxValue] of Object.entries(context)) {
            if (typeof ctxValue === 'string' || typeof ctxValue === 'number') {
              expr = expr.replace(new RegExp(`\\$${ctxKey}\\b`, 'g'), String(ctxValue));
            }
          }

          // Execute the expression via shell
          const scriptContext: ScriptContext = {
            fsmState: currentState,
            fsmMeshName: this.meshName,
            ...this.stateData.context,
          };

          // Also inject rearmatter values as individual env vars for yq access
          if (rearmatter) {
            for (const [rmKey, rmValue] of Object.entries(rearmatter)) {
              if (typeof rmValue === 'string' || typeof rmValue === 'number' || typeof rmValue === 'boolean') {
                scriptContext[`rearmatter_${rmKey}`] = rmValue;
              }
            }
          }

          const result = await this.scriptExecutor.executeInline(expr, scriptContext);

          if (result.success) {
            const output = result.stdout.trim();
            context[key] = output;
            // Also update FSM context for persistence
            this.updateContext({ [key]: output });
            log.debug('mesh-fsm', 'Exit.set evaluated (shell)', {
              meshName: this.meshName,
              key,
              value: output,
            });
          } else {
            log.warn('mesh-fsm', 'Exit.set evaluation failed', {
              meshName: this.meshName,
              key,
              expr: valueExpr,
              stderr: result.stderr,
            });
          }
        } catch (error) {
          log.error('mesh-fsm', 'Exit.set execution error', {
            meshName: this.meshName,
            key,
            error: (error as Error).message,
          });
          // Continue with other set operations
        }
      }
    }

    // Execute gates before routing (if configured)
    if (stateConfig.exit.gates) {
      const [, agentName] = from.split('/');
      const agentGates = stateConfig.exit.gates[agentName];

      if (agentGates && agentGates.length > 0) {
        for (const gateName of agentGates) {
          try {
            // Gates are scripts that must pass (exit 0) for routing to proceed
            const gateScriptContext: ScriptContext = {
              fsmState: currentState,
              fsmMeshName: this.meshName,
              ...this.stateData.context,
            };

            // Check if gate is a file path reference (starts with $workspace or is a path)
            if (gateName.startsWith('$') || gateName.includes('/')) {
              // File existence check gate
              const filePath = gateName.startsWith('$workspace')
                ? gateName.replace('$workspace', this.scriptExecutor['config'].workDir)
                : gateName;

              const fs = await import('node:fs');
              if (!fs.existsSync(filePath)) {
                log.warn('mesh-fsm', 'Gate file not found', {
                  meshName: this.meshName,
                  gateName,
                  filePath,
                  agentName,
                });
                // Increment retry counter
                this.stateData.gateRetries[gateName] = (this.stateData.gateRetries[gateName] || 0) + 1;
                if (this.stateData.gateRetries[gateName] >= 3) {
                  throw new Error(`Gate failed after 3 retries: file not found: ${filePath}`);
                }
                return false; // Block transition, will retry
              }
              log.debug('mesh-fsm', 'Gate file exists', {
                meshName: this.meshName,
                gateName,
                filePath,
              });
            } else {
              // Look up script from fsm.scripts config
              const scriptPath = this.config.scripts?.[gateName];
              if (!scriptPath) {
                log.warn('mesh-fsm', 'Gate script not found in config', {
                  meshName: this.meshName,
                  gateName,
                  agentName,
                  availableScripts: Object.keys(this.config.scripts || {}),
                });
                // Skip this gate if script not defined (non-blocking)
                continue;
              }

              // Execute the gate script
              const result = await this.scriptExecutor.execute(scriptPath, gateScriptContext);

              this.emit('fsm:gate-check', {
                meshName: this.meshName,
                state: currentState,
                gate: { type: 'script', script: scriptPath },
                passed: result.success,
                retryCount: this.stateData.gateRetries[gateName] || 0,
                timestamp: Date.now(),
              } as FSMGateEvent);

              if (!result.success) {
                log.warn('mesh-fsm', 'Gate script failed', {
                  meshName: this.meshName,
                  gateName,
                  scriptPath,
                  exitCode: result.exitCode,
                  stderr: result.stderr,
                });
                // Increment retry counter
                this.stateData.gateRetries[gateName] = (this.stateData.gateRetries[gateName] || 0) + 1;
                if (this.stateData.gateRetries[gateName] >= 3) {
                  throw new Error(`Gate script failed after 3 retries: ${gateName}`);
                }
                return false; // Block transition, will retry
              }

              log.debug('mesh-fsm', 'Gate script passed', {
                meshName: this.meshName,
                gateName,
                scriptPath,
              });
            }
          } catch (error) {
            log.error('mesh-fsm', 'Gate check failed', {
              meshName: this.meshName,
              gateName,
              error: (error as Error).message,
            });
            throw error; // Gate failures are fatal
          }
        }
      }
    }

    // Evaluate exit routing to determine next state
    const nextState = await this.evaluateExitRouting(stateConfig.exit, context);

    if (!nextState) {
      log.error('mesh-fsm', 'No valid exit route found', {
        meshName: this.meshName,
        currentState,
        from,
        to,
        messageType,
        context: Object.fromEntries(
          Object.entries(context).filter(([k]) => !['message', 'rearmatter'].includes(k))
        ),
      });
      return false; // Reject message - no valid route
    }

    log.debug('mesh-fsm', 'FSM determined next state', {
      meshName: this.meshName,
      currentState,
      nextState,
      from,
      to,
    });

    // Validate agent's routing matches FSM's next state
    // Extract target mesh and agent from 'to' field
    const [targetMesh, targetAgent] = to.split('/');
    const nextStateConfig = this.stateMap.get(nextState);

    // If routing to a different mesh (e.g., core/core), that's always allowed
    // FSM only validates intra-mesh routing
    if (targetMesh !== this.meshName) {
      log.debug('mesh-fsm', 'Message routes outside mesh, executing transition', {
        meshName: this.meshName,
        targetMesh,
        nextState,
      });

      // Execute transition to next state
      const transitioned = await this.executeTransition(currentState, nextState, from, messageType);
      return transitioned;
    }

    // Check if target agent is allowed in the next state
    if (nextStateConfig) {
      const allowedAgents: string[] = [];

      // Get coordinator
      if (nextStateConfig.coordinator) {
        allowedAgents.push(nextStateConfig.coordinator);
      }

      // Get participants
      if (nextStateConfig.participants) {
        allowedAgents.push(...nextStateConfig.participants);
      }

      // Check if target agent is in allowed list
      if (allowedAgents.length > 0 && !allowedAgents.includes(targetAgent)) {
        log.error('mesh-fsm', 'Agent routing violates FSM state', {
          meshName: this.meshName,
          currentState,
          nextState,
          agentRoutedTo: targetAgent,
          fsmAllowedAgents: allowedAgents,
        });
        return false; // Reject - routing violates FSM rules
      }
    }

    // Execute transition to next state
    const transitioned = await this.executeTransition(currentState, nextState, from, messageType);
    return transitioned;
  }

  /**
   * Execute state transition with proper lifecycle
   */
  private async executeTransition(
    fromState: string,
    toState: string,
    triggerAgent: string,
    triggerType: string
  ): Promise<boolean> {
    if (!this.stateData) return false;

    const startTime = Date.now();

    try {
      // Execute onExit for current state
      const fromStateConfig = this.stateMap.get(fromState);
      if (fromStateConfig?.onExit) {
        const scriptContext: ScriptContext = {
          fsmState: fromState,
          fsmMeshName: this.meshName,
          fsmTransition: `${fromState}->${toState}`,
          ...this.stateData.context,
        };
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
        trigger: triggerType,
        triggerAgent,
        timestamp: Date.now(),
        durationMs: Date.now() - startTime,
      };
      this.emit('fsm:transition', transitionEvent);

      log.info('mesh-fsm', 'FSM state transitioned', {
        meshName: this.meshName,
        from: fromState,
        to: toState,
        trigger: triggerType,
        triggerAgent,
      });

      // Execute onEnter for new state
      await this.executeOnEnter(toState);

      return true;
    } catch (error) {
      log.error('mesh-fsm', 'Transition failed', {
        meshName: this.meshName,
        from: fromState,
        to: toState,
        error: (error as Error).message,
      });
      throw error; // Re-throw for caller to handle
    }
  }
}

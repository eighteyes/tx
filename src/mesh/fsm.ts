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
import { log } from '../shared/logger.ts';

// Re-export for convenience
export { FSMPersistence, type FSMStateData } from './fsm-persistence.ts';
export { ScriptExecutor, type ScriptContext, type ScriptResult } from './fsm-scripts.ts';

/**
 * FSM state configuration (from mesh config)
 */
export interface FSMStateConfig {
  name: string;
  coordinator: string;  // Agent that coordinates this state
  participants?: string[];  // Other agents that participate
  gates?: FSMGateConfig[];  // Gates to check before transition
  onEnter?: string;  // Script to run on state entry
  onExit?: string;   // Script to run on state exit
}

/**
 * Gate configuration
 */
export interface FSMGateConfig {
  type: 'script' | 'agent-complete' | 'all-complete';
  script?: string;  // Path to gate script (for script type)
  agent?: string;   // Agent to check (for agent-complete type)
  maxRetries?: number;  // Override default 3 retries
}

/**
 * Transition configuration
 */
export interface FSMTransitionConfig {
  from: string;
  to: string;
  trigger: 'ask' | 'task-complete' | 'manual';
  triggerAgent?: string;  // Agent that triggers this transition
  script?: string;  // Transition script
}

/**
 * Full FSM configuration (from mesh config)
 */
export interface FSMConfig {
  initialState: string;
  states: FSMStateConfig[];
  transitions: FSMTransitionConfig[];
  context?: Record<string, unknown>;  // Initial context variables
}

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
}

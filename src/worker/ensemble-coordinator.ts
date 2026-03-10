/**
 * Ensemble Coordinator
 *
 * Orchestrates parallel execution of ensemble agents:
 * 1. Spawns N agents in parallel
 * 2. Collects results with timeout handling
 * 3. Aggregates results using configured strategy
 * 4. Returns synthesized output
 *
 * Phase 2 refactoring: Added orchestration methods extracted from dispatcher.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { EnsembleConfig, FSMStateConfig } from '../shared/types.ts';
import { AggregationEngine, type AgentResult } from '../mesh/aggregation.ts';
import { log } from '../shared/logger.ts';
import type { Message } from '../queue/index.ts';
import type { MeshFSM } from '../mesh/fsm.ts';
import type { SystemMessageWriter } from '../core/system-message-writer.ts';

export interface EnsembleExecutionState {
  ensembleId: string;
  meshName: string;
  config: EnsembleConfig;
  agentResults: Map<string, { agentName: string; content: string; error?: string; startTime: number; endTime?: number }>;
  agentStartTimes: Map<string, number>;  // Track when each agent was spawned (keyed by unique worker key)
  originalTask: Message;
  aggregationStarted: boolean;  // Prevents concurrent aggregation
}

/**
 * Options for triggering next state agent
 */
export interface TriggerNextAgentOptions {
  meshName: string;
  nextState: string;
  targetAgent: string;
  ensembleOutput: string;
  ensembleMetadata: Record<string, unknown>;
  msgsDir: string;
  writer?: SystemMessageWriter;
}

export class EnsembleCoordinator {
  private activeEnsembles = new Map<string, EnsembleExecutionState>();

  /**
   * Start ensemble execution
   * Returns ensemble ID for tracking
   */
  startEnsemble(
    meshName: string,
    config: EnsembleConfig,
    task: Message
  ): string {
    const ensembleId = `${meshName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const state: EnsembleExecutionState = {
      ensembleId,
      meshName,
      config,
      agentResults: new Map(),
      agentStartTimes: new Map(),
      originalTask: task,
      aggregationStarted: false,
    };

    this.activeEnsembles.set(ensembleId, state);

    log.info('ensemble', 'Started ensemble', {
      ensembleId,
      meshName,
      agents: config.agents.length,
      strategy: config.aggregation_strategy,
    });

    return ensembleId;
  }

  /**
   * Register when an agent starts execution
   * @param workerKey - Unique key for this worker (e.g., "runner-0", "runner-1" for N-same ensembles)
   */
  registerAgentStart(ensembleId: string, agentName: string, ensembleIndex?: number): void {
    const state = this.activeEnsembles.get(ensembleId);
    if (!state) {
      log.warn('ensemble', 'Cannot register start - ensemble not found', { ensembleId });
      return;
    }
    const workerKey = ensembleIndex !== undefined ? `${agentName}-${ensembleIndex}` : agentName;
    state.agentStartTimes.set(workerKey, Date.now());
  }

  /**
   * Record agent result
   * Returns completion status to avoid race conditions in aggregation
   * Uses ensembleIndex to create unique keys for N-same ensembles (same agent spawned N times)
   */
  recordAgentResult(
    ensembleId: string,
    agentName: string,
    content: string,
    error?: string,
    ensembleIndex?: number
  ): { isComplete: boolean; shouldAggregate: boolean } {
    const state = this.activeEnsembles.get(ensembleId);
    if (!state) {
      log.warn('ensemble', 'Ensemble not found', { ensembleId });
      return { isComplete: false, shouldAggregate: false };
    }

    // Use index-suffixed key for N-same ensembles to avoid Map key collision
    const workerKey = ensembleIndex !== undefined ? `${agentName}-${ensembleIndex}` : agentName;
    const startTime = state.agentStartTimes.get(workerKey) || Date.now();
    state.agentResults.set(workerKey, {
      agentName,
      content,
      error,
      startTime,
      endTime: Date.now(),
    });

    log.debug('ensemble', 'Agent result recorded', {
      ensembleId,
      agent: agentName,
      workerKey,
      success: !error,
      resultCount: state.agentResults.size,
    });

    // Check completion atomically
    const expectedCount = state.config.agents.length;
    const receivedCount = state.agentResults.size;
    const minRequired = state.config.fault_tolerance?.min_success_count || expectedCount;
    const isComplete = receivedCount >= minRequired;

    // Claim aggregation if complete and not already claimed
    const shouldAggregate = isComplete && !state.aggregationStarted;
    if (shouldAggregate) {
      state.aggregationStarted = true;
    }

    return { isComplete, shouldAggregate };
  }

  /**
   * Check if ensemble is complete
   */
  isComplete(ensembleId: string): boolean {
    const state = this.activeEnsembles.get(ensembleId);
    if (!state) return false;

    const expectedCount = state.config.agents.length;
    const receivedCount = state.agentResults.size;

    return receivedCount >= (state.config.fault_tolerance?.min_success_count || expectedCount);
  }

  /**
   * Get aggregated result
   * Claims aggregation if not already claimed (prevents concurrent aggregation)
   */
  async getAggregatedResult(ensembleId: string): Promise<{ output: string; metadata: any } | null> {
    const state = this.activeEnsembles.get(ensembleId);
    if (!state) return null;

    // Mark aggregation as started (idempotent — recordAgentResult may have already set this)
    state.aggregationStarted = true;

    // Collect successful results
    const results: AgentResult[] = [];
    const failed: string[] = [];

    for (const [workerKey, result] of state.agentResults) {
      if (!result.error && result.content) {
        results.push({ agent: result.agentName || workerKey, content: result.content });
      } else {
        failed.push(result.agentName || workerKey);
      }
    }

    const successCount = results.length;
    const minRequired = state.config.fault_tolerance?.min_success_count || state.config.agents.length;

    if (successCount < minRequired) {
      return {
        output: `Ensemble failed: ${successCount}/${state.config.agents.length} agents succeeded, need ${minRequired}`,
        metadata: {
          success: false,
          successful_agents: results.map(r => r.agent),
          failed_agents: failed,
          min_required: minRequired,
        },
      };
    }

    // Get custom aggregation prompt from message payload if available
    const customPrompt = state.originalTask.payload?.custom_aggregation_prompt as string | undefined;

    // Aggregate
    const aggregationResult = await AggregationEngine.aggregate(
      state.config.aggregation_strategy,
      results,
      {
        customPrompt,
        query: (prompt: string, opts?: any) => this.queryClaudeForAggregation(prompt, opts),
      }
    );

    log.info('ensemble', 'Ensemble aggregated', {
      ensembleId,
      strategy: state.config.aggregation_strategy,
      successCount,
      failedCount: failed.length,
    });

    return {
      output: aggregationResult.aggregated_content,
      metadata: {
        success: true,
        strategy: state.config.aggregation_strategy,
        successful_agents: results.map(r => r.agent),
        failed_agents: failed,
        aggregated_metadata: aggregationResult.metadata,
      },
    };
  }

  /**
   * Clean up ensemble
   */
  completeEnsemble(ensembleId: string): void {
    this.activeEnsembles.delete(ensembleId);
    log.debug('ensemble', 'Ensemble cleaned up', { ensembleId });
  }

  /**
   * Query Claude for custom aggregation (Phase 3)
   * Currently a placeholder - will be implemented in Phase 3
   */
  private async queryClaudeForAggregation(prompt: string, opts?: any): Promise<string> {
    log.warn('ensemble', 'Custom aggregation query not yet implemented (Phase 3)');
    return '';
  }

  /**
   * Get ensemble state (for testing)
   */
  getEnsembleState(ensembleId: string): EnsembleExecutionState | undefined {
    return this.activeEnsembles.get(ensembleId);
  }

  /**
   * Get active ensemble count (for monitoring)
   */
  getActiveEnsembleCount(): number {
    return this.activeEnsembles.size;
  }

  /**
   * Check if a mesh has any active ensembles.
   * Used to skip FSM validation on individual ensemble worker messages
   * (the ensemble coordinator handles exit routing separately).
   */
  hasActiveEnsembleForMesh(meshName: string): boolean {
    for (const state of this.activeEnsembles.values()) {
      if (state.meshName === meshName) return true;
    }
    return false;
  }

  // ============================================================================
  // Orchestration Methods (Phase 2 extraction from dispatcher)
  // ============================================================================

  /**
   * Resolve ensemble count from config
   * Can be a literal number or a $variable reference to FSM context
   */
  resolveEnsembleCount(count: number | string | undefined, fsm: MeshFSM): number {
    if (typeof count === 'number') return count;

    if (typeof count === 'string') {
      // Resolve from FSM context: $subtask_count
      const varName = count.startsWith('$') ? count.slice(1) : count;
      const value = fsm.getContext()[varName];
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed)) return parsed;
      }
      log.warn('ensemble', 'Could not resolve ensemble count from context', {
        varName,
        value,
        fallback: 3,
      });
      return 3;  // default fallback
    }

    return 3;  // default
  }

  /**
   * Wait for ensemble completion with timeout
   * Returns true if completed, false if timed out
   */
  async waitForCompletion(ensembleId: string, timeoutMs: number = 120000): Promise<boolean> {
    const startTime = Date.now();

    while (!this.isComplete(ensembleId)) {
      if (Date.now() - startTime > timeoutMs) {
        log.warn('ensemble', 'Ensemble timeout reached', {
          ensembleId,
          timeout: timeoutMs,
        });
        return false;
      }
      // Brief pause before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return true;
  }

  /**
   * Build the ensemble config from FSM state config
   */
  buildEnsembleConfig(
    stateConfig: FSMStateConfig,
    fsm: MeshFSM
  ): EnsembleConfig | null {
    const { ensemble } = stateConfig;
    if (!ensemble) return null;

    // Determine agents to spawn
    const agentsToSpawn = ensemble.agents
      || Array(this.resolveEnsembleCount(ensemble.count, fsm)).fill(ensemble.agent!);

    if (agentsToSpawn.length === 0) {
      return null;
    }

    return {
      agents: agentsToSpawn,
      aggregation_strategy: ensemble.aggregation,
      timeout_ms: ensemble.timeout_ms,
      fault_tolerance: ensemble.fault_tolerance,
    };
  }

  /**
   * Write a trigger message for the next state agent after ensemble completion
   */
  writeTriggerMessage(options: TriggerNextAgentOptions): { success: boolean; filepath?: string; error?: string } {
    const { meshName, nextState, targetAgent, ensembleOutput, ensembleMetadata, msgsDir, writer } = options;
    const targetAgentId = `${meshName}/${targetAgent}`;

    const body = `# Aggregated Ensemble Results

The following content has been collected and aggregated from parallel ensemble agents.

${ensembleOutput}

---
**Aggregation Metadata:**
- Strategy: ${ensembleMetadata.strategy || 'unknown'}
- Agent Count: ${ensembleMetadata.agent_count || 'unknown'}
- Success: ${ensembleMetadata.success ?? 'unknown'}`;

    if (writer) {
      const result = writer.write({
        to: targetAgentId,
        from: 'dispatcher/ensemble',
        type: 'task',
        headline: 'Ensemble aggregation complete',
        body,
      });
      return { success: true, filepath: result.filepath };
    }

    // Fallback: direct file write
    const msgId = `ensemble-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = Date.now();
    const toSafe = targetAgentId.replace(/\//g, '-');
    const filename = `${timestamp}-task-dispatcher--${toSafe}-${msgId}.md`;
    const filepath = path.join(msgsDir, filename);

    const messageContent = `---\nto: ${targetAgentId}\nfrom: dispatcher/ensemble\ntype: task\nmsg-id: ${msgId}\nheadline: Ensemble aggregation complete\ntimestamp: ${new Date().toISOString()}\n---\n\n${body}\n`;

    try {
      fs.writeFileSync(filepath, messageContent);
      return { success: true, filepath };
    } catch (err) {
      const error = (err as Error).message;
      log.error('ensemble', 'Failed to write trigger message', { meshName, targetAgent, error });
      return { success: false, error };
    }
  }

  /**
   * Process FSM exit block after ensemble completion
   * Evaluates routing and returns the next state
   */
  async evaluateExitRouting(
    fsm: MeshFSM,
    stateConfig: FSMStateConfig
  ): Promise<string | null> {
    const exit = stateConfig.exit;
    if (!exit) {
      log.warn('ensemble', 'No exit config for state, cannot route', {
        state: stateConfig.name,
      });
      return null;
    }

    // Process exit.set first if present (evaluate expressions before routing)
    if (exit.set) {
      log.debug('ensemble', 'Evaluating exit.set expressions', {
        state: stateConfig.name,
        vars: Object.keys(exit.set),
      });
      await fsm.evaluateSetExpressions(exit.set as Record<string, string>);
    }

    // Evaluate routing using FSM's evaluateExitRouting
    const context = fsm.getContext();
    const nextState = await fsm.evaluateExitRouting(exit, context);

    return nextState;
  }

  /**
   * Get the target agent for the next state
   * Returns the first agent in the state's agents list
   */
  getNextStateTargetAgent(fsm: MeshFSM, nextState: string): string | null {
    const nextStateConfig = fsm.getStateConfig(nextState);
    if (!nextStateConfig) {
      log.warn('ensemble', 'No state config for next state', { nextState });
      return null;
    }

    // FSM normalizes 'agents' to 'coordinator' + 'participants' during init
    // Check coordinator first (normalized form), then agents (raw form) for compatibility
    const targetAgent = nextStateConfig.coordinator || (nextStateConfig as any).agents?.[0];
    if (!targetAgent) {
      log.debug('ensemble', 'Next state has no agents', { nextState });
      return null;
    }

    return targetAgent;
  }
}

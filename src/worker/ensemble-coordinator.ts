/**
 * Ensemble Coordinator
 *
 * Orchestrates parallel execution of ensemble agents:
 * 1. Spawns N agents in parallel
 * 2. Collects results with timeout handling
 * 3. Aggregates results using configured strategy
 * 4. Returns synthesized output
 */

import type { EnsembleConfig } from '../shared/types.ts';
import { AggregationEngine, type AgentResult } from '../mesh/aggregation.ts';
import { log } from '../shared/logger.ts';
import type { Message } from '../queue/index.ts';

export interface EnsembleExecutionState {
  ensembleId: string;
  meshName: string;
  config: EnsembleConfig;
  agentResults: Map<string, { content: string; error?: string; startTime: number; endTime?: number }>;
  agentStartTimes: Map<string, number>;  // Track when each agent was spawned
  originalTask: Message;
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
   */
  registerAgentStart(ensembleId: string, agentName: string): void {
    const state = this.activeEnsembles.get(ensembleId);
    if (!state) {
      log.warn('ensemble', 'Cannot register start - ensemble not found', { ensembleId });
      return;
    }
    state.agentStartTimes.set(agentName, Date.now());
  }

  /**
   * Record agent result
   */
  recordAgentResult(
    ensembleId: string,
    agentName: string,
    content: string,
    error?: string
  ): void {
    const state = this.activeEnsembles.get(ensembleId);
    if (!state) {
      log.warn('ensemble', 'Ensemble not found', { ensembleId });
      return;
    }

    const startTime = state.agentStartTimes.get(agentName) || Date.now();
    state.agentResults.set(agentName, {
      content,
      error,
      startTime,
      endTime: Date.now(),
    });

    log.debug('ensemble', 'Agent result recorded', {
      ensembleId,
      agent: agentName,
      success: !error,
    });
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
   */
  async getAggregatedResult(ensembleId: string): Promise<{ output: string; metadata: any } | null> {
    const state = this.activeEnsembles.get(ensembleId);
    if (!state) return null;

    // Collect successful results
    const results: AgentResult[] = [];
    const failed: string[] = [];

    for (const [agent, result] of state.agentResults) {
      if (!result.error && result.content) {
        results.push({ agent, content: result.content });
      } else {
        failed.push(agent);
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
}

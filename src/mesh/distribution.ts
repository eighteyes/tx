/**
 * Distribution Engine
 *
 * Implements multiple strategies for distributing tasks into subtasks
 * for parallel execution by multiple agents.
 *
 * Strategies:
 * - equal: Divide task into N equal parts
 * - weighted: Distribute based on agent capabilities (Phase 2)
 * - adaptive: Use spawner agent to suggest optimal split (Phase 2)
 * - custom: Use provided prompt to guide decomposition (Phase 2)
 */

import type { DistributionResult } from '../shared/types.ts';

export class DistributionEngine {
  /**
   * Distribute a task into subtasks using the specified strategy
   *
   * @param strategy - The distribution strategy to use
   * @param task - The task description to distribute
   * @param subagents - List of agent names that will process subtasks
   * @param options - Optional configuration (customPrompt, subtaskCount, model)
   * @returns DistributionResult with list of subtasks
   */
  static async distribute(
    strategy: 'equal' | 'weighted' | 'adaptive' | 'custom',
    task: string,
    subagents: string[],
    options?: { customPrompt?: string; subtaskCount?: number; model?: string }
  ): Promise<DistributionResult> {
    const subtaskCount = options?.subtaskCount || subagents.length;
    let subtasks: Array<{ id: string; description: string; assigned_agent: string }> = [];

    switch (strategy) {
      case 'equal':
        subtasks = this.equal(task, subagents, subtaskCount);
        break;

      case 'weighted':
        // Phase 2: Use agent capabilities or performance history
        subtasks = this.weighted(task, subagents, subtaskCount);
        break;

      case 'adaptive':
        // Phase 2: Call spawner agent to suggest split
        subtasks = this.adaptive(task, subagents, subtaskCount, options?.customPrompt);
        break;

      case 'custom':
        // Phase 2: Call Claude with custom prompt
        subtasks = this.customPlaceholder(task, subagents, subtaskCount, options?.customPrompt);
        break;

      default:
        subtasks = this.equal(task, subagents, subtaskCount);
    }

    return {
      spawner: 'placeholder',  // Will be set by dispatcher in Phase 2
      subtask_count: subtasks.length,
      subtasks,
      results: [],
      synthesized_result: '',
      metadata: { strategy }
    };
  }

  /**
   * Equal strategy: Divide task into N equal parts
   * Each part is assigned to agents in round-robin fashion
   */
  private static equal(
    task: string,
    subagents: string[],
    subtaskCount: number
  ): Array<{ id: string; description: string; assigned_agent: string }> {
    const subtasks: Array<{ id: string; description: string; assigned_agent: string }> = [];
    const taskLength = task.length;
    const chunkSize = Math.ceil(taskLength / subtaskCount);

    for (let i = 0; i < subtaskCount; i++) {
      const agent = subagents[i % subagents.length];
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, taskLength);
      const taskSnippet = task.substring(start, end).trim();

      subtasks.push({
        id: `subtask-${i + 1}`,
        description: `Part ${i + 1}/${subtaskCount}: ${taskSnippet.substring(0, 100)}${taskSnippet.length > 100 ? '...' : ''}`,
        assigned_agent: agent
      });
    }

    return subtasks;
  }

  /**
   * Weighted strategy: Distribute based on agent capabilities
   * Currently defaults to equal distribution; Phase 2 will use capability matching
   */
  private static weighted(
    task: string,
    subagents: string[],
    subtaskCount: number
  ): Array<{ id: string; description: string; assigned_agent: string }> {
    // Phase 2: Query agent capabilities and weight distribution accordingly
    // For now, fall back to equal distribution
    return this.equal(task, subagents, subtaskCount);
  }

  /**
   * Adaptive strategy: Use spawner agent to suggest optimal split
   * Currently defaults to equal distribution; Phase 2 will invoke spawner
   */
  private static adaptive(
    task: string,
    subagents: string[],
    subtaskCount: number,
    _customPrompt?: string
  ): Array<{ id: string; description: string; assigned_agent: string }> {
    // Phase 2: Call spawner agent with prompt to decompose task optimally
    // For now, fall back to equal distribution
    return this.equal(task, subagents, subtaskCount);
  }

  /**
   * Custom strategy placeholder: Use provided prompt to guide decomposition
   * Currently defaults to equal distribution; Phase 2 will invoke Claude
   */
  private static customPlaceholder(
    task: string,
    subagents: string[],
    subtaskCount: number,
    _customPrompt?: string
  ): Array<{ id: string; description: string; assigned_agent: string }> {
    // Phase 2: Call Claude with customPrompt to decompose task
    // For now, fall back to equal distribution
    return this.equal(task, subagents, subtaskCount);
  }
}

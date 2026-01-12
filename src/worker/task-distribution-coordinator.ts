/**
 * TaskDistributionCoordinator
 *
 * Manages task distribution lifecycle:
 * - Register subtask batches from spawner
 * - Track subtask completion
 * - Collect results as they arrive
 * - Signal when all subtasks complete
 * - Provide aggregated results to reviewer
 *
 * Pattern:
 * 1. Spawner agent splits task into N subtasks
 * 2. Coordinator registers subtasks and spawns subagents
 * 3. Subagents process in parallel, writing task-complete messages
 * 4. Coordinator collects results
 * 5. When all complete, coordinator routes to reviewer with aggregated results
 */

import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';

/**
 * Subtask definition from spawner output
 */
export interface Subtask {
  id: string;              // Unique subtask identifier (e.g., "subtask-1")
  description: string;     // Task description for subagent
  assigned_agent: string;  // Agent name to process this subtask
}

/**
 * Subtask result from subagent completion
 */
export interface SubtaskResult {
  subtask_id: string;
  agent: string;
  output: string;
  success: boolean;
  error?: string;
  completed_at: number;
}

/**
 * Batch of subtasks registered by a spawner
 */
interface SubtaskBatch {
  parent_task_id: string;        // Original task ID
  spawner_agent: string;         // Agent that created subtasks
  reviewer_agent: string;        // Agent that will synthesize results
  subtasks: Subtask[];           // List of subtasks
  results: Map<string, SubtaskResult>;  // Completed results by subtask_id
  registered_at: number;
  timeout_ms: number;
  allow_partial_failure: boolean;
  timeout_timer?: NodeJS.Timeout;
}

/**
 * Event emitted when all subtasks complete
 */
export interface BatchCompleteEvent {
  parent_task_id: string;
  spawner_agent: string;
  reviewer_agent: string;
  subtask_count: number;
  successful_count: number;
  failed_count: number;
  results: SubtaskResult[];
  duration_ms: number;
}

/**
 * Event emitted when batch times out
 */
export interface BatchTimeoutEvent {
  parent_task_id: string;
  spawner_agent: string;
  reviewer_agent: string;
  subtask_count: number;
  completed_count: number;
  pending_subtasks: string[];
}

/**
 * Coordinator for task distribution pattern
 */
export class TaskDistributionCoordinator extends EventEmitter {
  private batches: Map<string, SubtaskBatch> = new Map();

  constructor() {
    super();
  }

  /**
   * Register a batch of subtasks from spawner
   * Returns the batch ID (same as parent_task_id)
   */
  registerBatch(
    parent_task_id: string,
    spawner_agent: string,
    reviewer_agent: string,
    subtasks: Subtask[],
    options?: {
      timeout_ms?: number;
      allow_partial_failure?: boolean;
    }
  ): string {
    if (this.batches.has(parent_task_id)) {
      log.warn('task-distribution', 'Batch already registered, replacing', {
        parent_task_id,
        existing_count: this.batches.get(parent_task_id)?.subtasks.length,
        new_count: subtasks.length,
      });
      // Clear existing timeout
      const existing = this.batches.get(parent_task_id);
      if (existing?.timeout_timer) {
        clearTimeout(existing.timeout_timer);
      }
    }

    const timeout_ms = options?.timeout_ms || 120000;
    const allow_partial_failure = options?.allow_partial_failure || false;

    const batch: SubtaskBatch = {
      parent_task_id,
      spawner_agent,
      reviewer_agent,
      subtasks,
      results: new Map(),
      registered_at: Date.now(),
      timeout_ms,
      allow_partial_failure,
    };

    // Set up timeout
    batch.timeout_timer = setTimeout(() => {
      this.handleBatchTimeout(parent_task_id);
    }, timeout_ms);

    this.batches.set(parent_task_id, batch);

    log.info('task-distribution', 'Registered subtask batch', {
      parent_task_id,
      spawner: spawner_agent,
      reviewer: reviewer_agent,
      subtask_count: subtasks.length,
      timeout_ms,
      allow_partial_failure,
    });

    this.emit('batch:registered', {
      parent_task_id,
      spawner_agent,
      reviewer_agent,
      subtask_count: subtasks.length,
    });

    return parent_task_id;
  }

  /**
   * Record a subtask result
   * Returns true if all subtasks are now complete
   */
  recordResult(
    parent_task_id: string,
    subtask_id: string,
    agent: string,
    output: string,
    success: boolean,
    error?: string
  ): boolean {
    const batch = this.batches.get(parent_task_id);
    if (!batch) {
      log.warn('task-distribution', 'Cannot record result: batch not found', {
        parent_task_id,
        subtask_id,
      });
      return false;
    }

    // Check if this subtask is part of the batch
    const subtask = batch.subtasks.find(st => st.id === subtask_id);
    if (!subtask) {
      log.warn('task-distribution', 'Cannot record result: subtask not in batch', {
        parent_task_id,
        subtask_id,
        expected_subtasks: batch.subtasks.map(st => st.id),
      });
      return false;
    }

    // Record the result
    const result: SubtaskResult = {
      subtask_id,
      agent,
      output,
      success,
      error,
      completed_at: Date.now(),
    };

    batch.results.set(subtask_id, result);

    log.info('task-distribution', 'Recorded subtask result', {
      parent_task_id,
      subtask_id,
      agent,
      success,
      completed: batch.results.size,
      total: batch.subtasks.length,
    });

    this.emit('subtask:complete', {
      parent_task_id,
      subtask_id,
      agent,
      success,
      completed_count: batch.results.size,
      total_count: batch.subtasks.length,
    });

    // Check if all subtasks are complete
    const allComplete = batch.results.size === batch.subtasks.length;
    if (allComplete) {
      this.handleBatchComplete(parent_task_id);
    }

    return allComplete;
  }

  /**
   * Handle batch completion
   */
  private handleBatchComplete(parent_task_id: string): void {
    const batch = this.batches.get(parent_task_id);
    if (!batch) return;

    // Clear timeout
    if (batch.timeout_timer) {
      clearTimeout(batch.timeout_timer);
      batch.timeout_timer = undefined;
    }

    const results = Array.from(batch.results.values());
    const successful_count = results.filter(r => r.success).length;
    const failed_count = results.filter(r => !r.success).length;
    const duration_ms = Date.now() - batch.registered_at;

    log.info('task-distribution', 'Batch complete', {
      parent_task_id,
      spawner: batch.spawner_agent,
      reviewer: batch.reviewer_agent,
      subtask_count: batch.subtasks.length,
      successful_count,
      failed_count,
      duration_ms,
    });

    const event: BatchCompleteEvent = {
      parent_task_id,
      spawner_agent: batch.spawner_agent,
      reviewer_agent: batch.reviewer_agent,
      subtask_count: batch.subtasks.length,
      successful_count,
      failed_count,
      results,
      duration_ms,
    };

    this.emit('batch:complete', event);

    // Keep batch for a while for debugging, but clear timeout
    // Cleanup happens in getBatchResults() after retrieval
  }

  /**
   * Handle batch timeout
   */
  private handleBatchTimeout(parent_task_id: string): void {
    const batch = this.batches.get(parent_task_id);
    if (!batch) return;

    const completed_subtasks = new Set(batch.results.keys());
    const pending_subtasks = batch.subtasks
      .filter(st => !completed_subtasks.has(st.id))
      .map(st => st.id);

    log.warn('task-distribution', 'Batch timeout', {
      parent_task_id,
      spawner: batch.spawner_agent,
      reviewer: batch.reviewer_agent,
      subtask_count: batch.subtasks.length,
      completed_count: batch.results.size,
      pending_count: pending_subtasks.length,
      pending_subtasks,
    });

    const event: BatchTimeoutEvent = {
      parent_task_id,
      spawner_agent: batch.spawner_agent,
      reviewer_agent: batch.reviewer_agent,
      subtask_count: batch.subtasks.length,
      completed_count: batch.results.size,
      pending_subtasks,
    };

    this.emit('batch:timeout', event);

    // If partial failure allowed, treat timeout as completion with partial results
    if (batch.allow_partial_failure && batch.results.size > 0) {
      this.handleBatchComplete(parent_task_id);
    }
  }

  /**
   * Get batch results (if complete)
   * Returns undefined if batch not found or not complete
   */
  getBatchResults(parent_task_id: string): BatchCompleteEvent | undefined {
    const batch = this.batches.get(parent_task_id);
    if (!batch) return undefined;

    // Check if complete
    const allComplete = batch.results.size === batch.subtasks.length;
    const partialAllowed = batch.allow_partial_failure && batch.results.size > 0;

    if (!allComplete && !partialAllowed) {
      return undefined;
    }

    const results = Array.from(batch.results.values());
    const successful_count = results.filter(r => r.success).length;
    const failed_count = results.filter(r => !r.success).length;
    const duration_ms = Date.now() - batch.registered_at;

    return {
      parent_task_id,
      spawner_agent: batch.spawner_agent,
      reviewer_agent: batch.reviewer_agent,
      subtask_count: batch.subtasks.length,
      successful_count,
      failed_count,
      results,
      duration_ms,
    };
  }

  /**
   * Get subtasks for a batch
   * Used by dispatcher to spawn subagents
   */
  getSubtasks(parent_task_id: string): Subtask[] | undefined {
    const batch = this.batches.get(parent_task_id);
    return batch?.subtasks;
  }

  /**
   * Check if batch is complete
   */
  isBatchComplete(parent_task_id: string): boolean {
    const batch = this.batches.get(parent_task_id);
    if (!batch) return false;

    return batch.results.size === batch.subtasks.length ||
      (batch.allow_partial_failure && batch.results.size > 0);
  }

  /**
   * Cleanup batch data after results retrieved
   */
  cleanupBatch(parent_task_id: string): void {
    const batch = this.batches.get(parent_task_id);
    if (batch?.timeout_timer) {
      clearTimeout(batch.timeout_timer);
    }
    this.batches.delete(parent_task_id);
    log.debug('task-distribution', 'Cleaned up batch', { parent_task_id });
  }

  /**
   * Get all active batches (for debugging/monitoring)
   */
  getActiveBatches(): Array<{
    parent_task_id: string;
    spawner_agent: string;
    reviewer_agent: string;
    subtask_count: number;
    completed_count: number;
    age_ms: number;
  }> {
    return Array.from(this.batches.values()).map(batch => ({
      parent_task_id: batch.parent_task_id,
      spawner_agent: batch.spawner_agent,
      reviewer_agent: batch.reviewer_agent,
      subtask_count: batch.subtasks.length,
      completed_count: batch.results.size,
      age_ms: Date.now() - batch.registered_at,
    }));
  }
}

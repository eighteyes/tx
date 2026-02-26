/**
 * WorkerLifecycleManager - Active Worker Tracking
 *
 * Manages the lifecycle of active worker instances:
 * - Tracks active workers per agent (supports parallel execution)
 * - Generates unique worker IDs
 * - Tracks messages sent by workers
 * - Persists worker state to disk for debugging
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { log } from '../shared/logger.ts';
import type { SdkRunner } from './sdk-runner.ts';
import type { WorkerStateMachine } from '../state-machine/index.ts';
import type { HookContext } from './hooks.ts';

/**
 * Tracked message sent by worker (for completion message enforcement)
 */
export interface TrackedMessage {
  to: string;
  type: string;
  msgId?: string;
  filepath: string;
}

/**
 * Active worker state
 */
export interface ActiveWorker {
  workerId: string;  // Unique instance ID (agentId-uuid) for parallel execution
  runner: SdkRunner;
  machine: WorkerStateMachine;
  startedAt: number;
  hookContext: HookContext;  // Lifecycle hook context (includes quality state)
  startedPromise?: Promise<void>;  // Resolves when FSM 'start' transition completes
  lastOutputAt?: number;  // Timestamp of last output (for stuck detection)
  messagesSent: TrackedMessage[];  // Messages written by this worker
  taskFrom?: string;  // Who sent the initial task (e.g., 'core/core')
  nudgeCount: number;  // Number of completion nudges sent
  sentTargets: Set<string>;  // Agent completion frontier: targets already sent to this session
}

/**
 * Worker state file structure (for persistence)
 */
interface WorkerStateFile {
  workers: Array<{
    id: string;
    agentId: string;
    status: string;
    startedAt: number;
    messagesProcessed: number;
    duration: number;
    awaitingResponses?: string[];
    awaitDuration?: number;
  }>;
  updatedAt: number;
}

/**
 * Options for adding a new worker
 */
export type AddWorkerOptions = Omit<ActiveWorker, 'workerId' | 'messagesSent' | 'nudgeCount' | 'sentTargets'>;

/**
 * Manages active worker instances and their lifecycle
 */
export class WorkerLifecycleManager {
  private activeWorkers: Map<string, ActiveWorker[]> = new Map();
  private stateFilePath: string;

  constructor(stateFilePath: string) {
    this.stateFilePath = stateFilePath;
  }

  /**
   * Add a worker instance to the active workers map
   * Generates a unique workerId for parallel execution tracking
   * @returns The generated workerId
   */
  add(agentId: string, workerData: AddWorkerOptions, taskFrom?: string): string {
    const workerId = `${agentId}-${crypto.randomUUID().slice(0, 8)}`;
    const workerWithId: ActiveWorker = {
      ...workerData,
      workerId,
      messagesSent: [],  // Initialize empty message tracking
      nudgeCount: 0,  // Initialize nudge counter
      taskFrom,  // Track who sent the initial task
      sentTargets: new Set(),  // Initialize agent completion frontier
    };

    const workers = this.activeWorkers.get(agentId) || [];
    workers.push(workerWithId);
    this.activeWorkers.set(agentId, workers);

    log.debug('worker-lifecycle', 'Added active worker', {
      workerId,
      agentId,
      taskFrom,
      totalWorkersForAgent: workers.length,
    });

    return workerId;
  }

  /**
   * Remove a specific worker instance by workerId
   * @returns true if worker was found and removed
   */
  remove(agentId: string, workerId: string): boolean {
    const workers = this.activeWorkers.get(agentId);
    if (!workers) return false;

    const filtered = workers.filter(w => w.workerId !== workerId);

    if (filtered.length === workers.length) {
      // Worker not found
      return false;
    }

    if (filtered.length === 0) {
      this.activeWorkers.delete(agentId);
    } else {
      this.activeWorkers.set(agentId, filtered);
    }

    log.debug('worker-lifecycle', 'Removed active worker', {
      workerId,
      agentId,
      remainingWorkersForAgent: filtered.length,
    });

    return true;
  }

  /**
   * Get a specific worker by workerId (searches across all agents)
   */
  getByWorkerId(workerId: string): { agentId: string; worker: ActiveWorker } | undefined {
    for (const [agentId, workers] of this.activeWorkers) {
      const worker = workers.find(w => w.workerId === workerId);
      if (worker) {
        return { agentId, worker };
      }
    }
    return undefined;
  }

  /**
   * Get the first worker for an agent (for backwards compatibility)
   * Used when a specific workerId is not available
   */
  getFirst(agentId: string): ActiveWorker | undefined {
    const workers = this.activeWorkers.get(agentId);
    return workers?.[0];
  }

  /**
   * Get all workers for an agent
   */
  getForAgent(agentId: string): ActiveWorker[] {
    return this.activeWorkers.get(agentId) || [];
  }

  /**
   * Check if agent has any active workers
   */
  hasWorkers(agentId: string): boolean {
    const workers = this.activeWorkers.get(agentId);
    return workers !== undefined && workers.length > 0;
  }

  /**
   * Track a message sent by an active worker
   * Called when consumer detects a message written by a worker
   */
  trackMessage(fromAgentId: string, toAgentId: string, messageType: string, filepath?: string): void {
    const workers = this.activeWorkers.get(fromAgentId);
    if (!workers || workers.length === 0) {
      // No active worker for this agent - might be a manual message or timing issue
      return;
    }

    // Track on the first (usually only) worker for this agent
    const worker = workers[0];
    worker.messagesSent.push({
      to: toAgentId,
      type: messageType,
      filepath: filepath || '',
    });

    log.debug('worker-lifecycle', 'Tracked message sent by worker', {
      fromAgentId,
      toAgentId,
      messageType,
      totalMessagesSent: worker.messagesSent.length,
    });
  }

  /**
   * Check if an agent has already sent to a target this session (agent completion frontier).
   * Returns true if target is already in the frontier (duplicate send).
   */
  hasSentToTarget(fromAgentId: string, toAgentId: string): boolean {
    const workers = this.activeWorkers.get(fromAgentId);
    if (!workers || workers.length === 0) {
      return false;
    }
    return workers[0].sentTargets.has(toAgentId);
  }

  /**
   * Add a target to an agent's completion frontier (mark as sent).
   */
  addSentTarget(fromAgentId: string, toAgentId: string): void {
    const workers = this.activeWorkers.get(fromAgentId);
    if (!workers || workers.length === 0) {
      return;
    }
    workers[0].sentTargets.add(toAgentId);
    log.debug('worker-lifecycle', 'Added target to completion frontier', {
      fromAgentId,
      toAgentId,
      frontierSize: workers[0].sentTargets.size,
    });
  }

  /**
   * Reset the completion frontier for a specific target (for ask-response loops).
   * When an agent receives an inbound response from a target, they can send to that target again.
   */
  resetSentTargetForResponse(agentId: string, respondingAgent: string): void {
    const workers = this.activeWorkers.get(agentId);
    if (!workers || workers.length === 0) {
      return;
    }
    if (workers[0].sentTargets.has(respondingAgent)) {
      workers[0].sentTargets.delete(respondingAgent);
      log.debug('worker-lifecycle', 'Reset completion frontier for ask-response', {
        agentId,
        respondingAgent,
        frontierSize: workers[0].sentTargets.size,
      });
    }
  }

  /**
   * Get the current completion frontier for an agent (for debugging/logging).
   */
  getSentTargets(agentId: string): Set<string> {
    const workers = this.activeWorkers.get(agentId);
    if (!workers || workers.length === 0) {
      return new Set();
    }
    return new Set(workers[0].sentTargets);  // Return copy
  }

  /**
   * Get total count of active workers across all agents
   */
  getCount(): number {
    let count = 0;
    for (const workers of this.activeWorkers.values()) {
      count += workers.length;
    }
    return count;
  }

  /**
   * Get all agent IDs that have active workers
   */
  getAllAgentIds(): string[] {
    return Array.from(this.activeWorkers.keys());
  }

  /**
   * Get all agent IDs that have active workers
   */
  getAgentIds(): string[] {
    return Array.from(this.activeWorkers.keys());
  }

  /**
   * Get all worker IDs across all agents
   */
  getAllWorkerIds(): string[] {
    const ids: string[] = [];
    for (const workers of this.activeWorkers.values()) {
      for (const w of workers) {
        ids.push(w.workerId);
      }
    }
    return ids;
  }

  /**
   * Kill all workers for a specific agent
   * @returns Number of workers killed
   */
  killForAgent(agentId: string, reason: string): number {
    const workers = this.activeWorkers.get(agentId);
    if (!workers) return 0;

    for (const worker of workers) {
      worker.runner.kill(reason);
    }
    this.activeWorkers.delete(agentId);
    return workers.length;
  }

  /**
   * Kill all active workers (used during shutdown)
   */
  killAll(reason: string): void {
    for (const [agentId, workers] of this.activeWorkers) {
      for (const worker of workers) {
        worker.runner.kill(`${reason}: agentId=${agentId}`);
      }
    }
    this.activeWorkers.clear();
  }

  /**
   * Clear all workers (without killing - for cleanup after workers have finished)
   */
  clear(): void {
    this.activeWorkers.clear();
  }

  /**
   * Delete all workers for an agent (for cleanup on failure)
   */
  deleteForAgent(agentId: string): void {
    this.activeWorkers.delete(agentId);
  }

  /**
   * Get all active agent IDs belonging to a specific mesh
   * Used by deferred mesh completion to check if workers are still running
   */
  getWorkersForMesh(meshName: string): string[] {
    const result: string[] = [];
    for (const [agentId, workers] of this.activeWorkers) {
      if (agentId.startsWith(`${meshName}/`) && workers.length > 0) {
        result.push(agentId);
      }
    }
    return result;
  }

  /**
   * Iterate over all workers
   */
  *entries(): IterableIterator<[string, ActiveWorker[]]> {
    yield* this.activeWorkers.entries();
  }

  /**
   * Write worker state to disk for debugging/monitoring
   */
  writeState(): void {
    const state: WorkerStateFile = {
      workers: Array.from(this.activeWorkers.entries()).flatMap(([agentId, workers]) =>
        workers.map((w) => {
          const status = w.machine.getStatus();
          const baseState = {
            id: w.workerId,
            agentId,
            status,
            startedAt: w.startedAt,
            messagesProcessed: w.machine.getMessagesProcessed(),
            duration: w.machine.getDuration()
          };

          // Add awaiting-specific fields if in awaiting state
          if (status === 'awaiting') {
            return {
              ...baseState,
              awaitingResponses: Array.from(w.machine.getAwaitingResponses()),
              awaitDuration: w.machine.getAwaitDuration()
            };
          }

          return baseState;
        })
      ),
      updatedAt: Date.now(),
    };
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Get raw map (for advanced operations - prefer specific methods)
   */
  getRawMap(): Map<string, ActiveWorker[]> {
    return this.activeWorkers;
  }
}

/**
 * LockManager - OAOM (One-Agent-One-Message) Lock Management
 *
 * Ensures each agent processes exactly one message at a time.
 * Subsequent messages queue until the current processing completes.
 *
 * Lock Reasons:
 * - 'processing': Agent is actively running a task
 * - 'awaiting-human': Agent sent ask-human and is waiting for response
 * - 'awaiting-agent': Agent sent ask to another agent and is waiting
 */

import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';

/**
 * Lock reason types
 */
export type LockReason = 'processing' | 'awaiting-human' | 'awaiting-agent';

/**
 * Agent lock state
 */
export interface AgentLock {
  reason: LockReason;
  since: number;
  workerId?: string;
  sessionId?: string;
}

/**
 * Events emitted by LockManager
 */
export interface LockManagerEvents {
  'agent:locked': { agentId: string; reason: LockReason };
  'agent:unlocked': { agentId: string; wasLocked: LockReason; duration: number };
}

/**
 * Callback invoked when a lock is released
 * Used to trigger processing of queued messages
 */
export type OnUnlockCallback = (agentId: string) => void;

/**
 * Manages OAOM (One-Agent-One-Message) locks for agents
 */
export class LockManager extends EventEmitter {
  private agentLocks: Map<string, AgentLock> = new Map();
  private onUnlockCallback?: OnUnlockCallback;

  constructor() {
    super();
  }

  /**
   * Set callback to be invoked when a lock is released
   * This is typically used to trigger processNextQueuedMessage
   */
  setOnUnlockCallback(callback: OnUnlockCallback): void {
    this.onUnlockCallback = callback;
  }

  /**
   * Check if an agent is currently locked
   */
  isLocked(agentId: string): boolean {
    return this.agentLocks.has(agentId);
  }

  /**
   * Acquire a lock for an agent before processing a message
   */
  acquire(
    agentId: string,
    reason: LockReason,
    workerId?: string,
    sessionId?: string
  ): void {
    this.agentLocks.set(agentId, {
      reason,
      since: Date.now(),
      workerId,
      sessionId,
    });
    this.emit('agent:locked', { agentId, reason });
    log.debug('lock-manager', 'Agent lock acquired', { agentId, reason, workerId });
  }

  /**
   * Update the reason for an existing lock (e.g., processing -> awaiting)
   */
  updateReason(agentId: string, reason: LockReason): void {
    const lock = this.agentLocks.get(agentId);
    if (lock) {
      const oldReason = lock.reason;
      lock.reason = reason;
      log.debug('lock-manager', 'Agent lock reason updated', { agentId, oldReason, newReason: reason });
    }
  }

  /**
   * Release an agent's lock
   * This will invoke the onUnlock callback to process next queued message
   */
  release(agentId: string): void {
    const lock = this.agentLocks.get(agentId);
    if (lock) {
      const duration = Date.now() - lock.since;
      this.agentLocks.delete(agentId);
      this.emit('agent:unlocked', {
        agentId,
        wasLocked: lock.reason,
        duration,
      });
      log.debug('lock-manager', 'Agent lock released', {
        agentId,
        wasLocked: lock.reason,
        duration,
      });

      // Invoke callback to check for queued messages
      if (this.onUnlockCallback) {
        this.onUnlockCallback(agentId);
      }
    }
  }

  /**
   * Get the current lock state for an agent
   */
  getState(agentId: string): AgentLock | undefined {
    return this.agentLocks.get(agentId);
  }

  /**
   * Check if an agent has a specific lock reason
   */
  hasLockWithReason(agentId: string, reason: LockReason): boolean {
    const lock = this.agentLocks.get(agentId);
    return lock?.reason === reason;
  }

  /**
   * Clear all locks for agents in a specific mesh
   * Used when a mesh completes or is reset
   */
  clearForMesh(meshName: string): number {
    let clearedCount = 0;
    for (const [agentId, _] of this.agentLocks) {
      if (agentId.startsWith(`${meshName}/`)) {
        this.agentLocks.delete(agentId);
        clearedCount++;
      }
    }
    if (clearedCount > 0) {
      log.debug('lock-manager', 'Cleared locks for mesh', { meshName, clearedCount });
    }
    return clearedCount;
  }

  /**
   * Get all locked agent IDs
   */
  getLockedAgentIds(): string[] {
    return Array.from(this.agentLocks.keys());
  }

  /**
   * Get all locks (for debugging/status display)
   */
  getAllLocks(): Map<string, AgentLock> {
    return new Map(this.agentLocks);
  }

  /**
   * Get the count of locked agents
   */
  getLockedCount(): number {
    return this.agentLocks.size;
  }
}

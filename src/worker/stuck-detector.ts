/**
 * StuckAgentDetector - Detects and nudges stuck agents
 *
 * The key scenario: "We've been waiting 5 minutes for a task-complete and everyone else is done!"
 *
 * Detection signals:
 * 1. In 'awaiting' state but all responses received (awaitingResponses empty)
 * 2. In 'idle' state for too long without completing
 * 3. In 'running' state but no output for extended period
 * 4. All mesh peers complete but this agent isn't
 *
 * Recovery: Progressive nudge → kill → escalate
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import { formatDuration } from '../shared/time.ts';
import type { WorkerStateMachine } from '../state-machine/index.ts';
import type { SdkRunner } from './sdk-runner.ts';
import type { HookContext } from './hooks.ts';

/**
 * Configuration for stuck agent detection
 */
export interface StuckAgentConfig {
  /** How long before considering an agent stuck (default: 5 minutes) */
  idleTimeoutMs: number;
  /** How often to check for stuck agents (default: 30 seconds) */
  activityCheckMs: number;
  /** Maximum nudges before escalation (default: 3) */
  maxNudges: number;
  /** Time between nudges (default: 2 minutes) */
  nudgeIntervalMs: number;
  /** Grace period after final warning (default: 2 minutes) */
  finalGracePeriodMs: number;
}

/**
 * Stuck agent detection info
 */
export interface StuckAgent {
  agentId: string;
  reason: 'awaiting-empty' | 'idle-timeout' | 'no-output' | 'peers-complete';
  lastActivity: number;
  duration: number;
  nudgeCount: number;
}

/**
 * Active worker info needed for detection
 */
export interface ActiveWorkerInfo {
  runner: SdkRunner;
  machine: WorkerStateMachine;
  startedAt: number;
  hookContext: HookContext;
  lastOutputAt?: number;
}

/**
 * Default configuration
 */
export const DEFAULT_STUCK_CONFIG: StuckAgentConfig = {
  idleTimeoutMs: 300000,      // 5 minutes
  activityCheckMs: 30000,     // 30 seconds
  maxNudges: 3,
  nudgeIntervalMs: 120000,    // 2 minutes
  finalGracePeriodMs: 120000, // 2 minutes
};

/**
 * StuckAgentDetector - Monitors workers and nudges stuck ones
 */
export class StuckAgentDetector extends EventEmitter {
  private config: StuckAgentConfig;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private nudgeCounts: Map<string, number> = new Map();
  private lastNudgeTime: Map<string, number> = new Map();
  private running = false;

  constructor(config: Partial<StuckAgentConfig> = {}) {
    super();
    this.config = { ...DEFAULT_STUCK_CONFIG, ...config };
  }

  /**
   * Start the detector interval
   */
  start(getActiveWorkers: () => Map<string, ActiveWorkerInfo>): void {
    if (this.running) return;

    this.running = true;
    this.checkInterval = setInterval(() => {
      this.detectAndHandle(getActiveWorkers());
    }, this.config.activityCheckMs);

    log.info('stuck-detector', 'Started stuck agent detector', {
      idleTimeoutMs: this.config.idleTimeoutMs,
      checkIntervalMs: this.config.activityCheckMs,
      maxNudges: this.config.maxNudges,
    });
  }

  /**
   * Stop the detector
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.running = false;
    this.nudgeCounts.clear();
    this.lastNudgeTime.clear();
  }

  /**
   * Detect stuck agents and handle them
   */
  private detectAndHandle(activeWorkers: Map<string, ActiveWorkerInfo>): void {
    const stuckAgents = this.detectStuckAgents(activeWorkers);

    for (const stuck of stuckAgents) {
      this.handleStuckAgent(stuck, activeWorkers.get(stuck.agentId)!);
    }
  }

  /**
   * Detect which agents are stuck based on multiple signals
   */
  detectStuckAgents(activeWorkers: Map<string, ActiveWorkerInfo>): StuckAgent[] {
    const now = Date.now();
    const stuck: StuckAgent[] = [];

    for (const [agentId, worker] of activeWorkers) {
      const { machine, startedAt, lastOutputAt, hookContext } = worker;
      const status = machine.getStatus();

      // Skip if recently started
      if (now - startedAt < this.config.idleTimeoutMs) continue;

      // Skip if in quality iteration loop (tracked via hookContext)
      if (hookContext.qualityIteration && hookContext.qualityIteration > 1) {
        // Give extra time for quality iterations - they naturally take longer
        const extraTime = (hookContext.qualityIteration - 1) * 120000; // 2 min per extra iteration
        if (now - startedAt < this.config.idleTimeoutMs + extraTime) continue;
      }

      const nudgeCount = this.nudgeCounts.get(agentId) || 0;

      // Check 1: In 'awaiting' state but all responses received
      if (status === 'awaiting') {
        const awaitingSet = machine.getAwaitingResponses();
        if (awaitingSet.size === 0) {
          // Has all responses but still in awaiting state - STUCK
          stuck.push({
            agentId,
            reason: 'awaiting-empty',
            lastActivity: machine.currentContext.createdAt,
            duration: now - startedAt,
            nudgeCount,
          });
          continue;
        }
      }

      // Check 2: In 'idle' state for too long
      if (status === 'idle') {
        const idleDuration = now - machine.lastTransitionAt;
        if (idleDuration > this.config.idleTimeoutMs) {
          stuck.push({
            agentId,
            reason: 'idle-timeout',
            lastActivity: machine.lastTransitionAt,
            duration: idleDuration,
            nudgeCount,
          });
          continue;
        }
      }

      // Check 3: In 'running' state but no output for too long
      if (status === 'running') {
        const lastOutput = lastOutputAt || startedAt;
        if (now - lastOutput > this.config.idleTimeoutMs) {
          stuck.push({
            agentId,
            reason: 'no-output',
            lastActivity: lastOutput,
            duration: now - lastOutput,
            nudgeCount,
          });
          continue;
        }
      }

      // Check 4: Mesh completion check - all peers done but this one isn't
      const meshPeers = this.getMeshPeers(activeWorkers, hookContext.meshInstance);
      const allPeersComplete = meshPeers.every(
        p => p.agentId === agentId || p.machine.getStatus() === 'complete'
      );
      if (allPeersComplete && status !== 'complete' && meshPeers.length > 1) {
        stuck.push({
          agentId,
          reason: 'peers-complete',
          lastActivity: machine.lastTransitionAt,
          duration: now - startedAt,
          nudgeCount,
        });
      }
    }

    return stuck;
  }

  /**
   * Get workers in the same mesh instance
   */
  private getMeshPeers(
    activeWorkers: Map<string, ActiveWorkerInfo>,
    meshInstance?: string
  ): Array<{ agentId: string; machine: WorkerStateMachine }> {
    if (!meshInstance) return [];

    const peers: Array<{ agentId: string; machine: WorkerStateMachine }> = [];
    for (const [agentId, worker] of activeWorkers) {
      if (worker.hookContext.meshInstance === meshInstance) {
        peers.push({ agentId, machine: worker.machine });
      }
    }
    return peers;
  }

  /**
   * Handle a stuck agent with progressive nudging
   */
  private async handleStuckAgent(stuck: StuckAgent, worker: ActiveWorkerInfo): Promise<void> {
    const { agentId, nudgeCount, reason, duration } = stuck;
    const now = Date.now();

    // Check if we should nudge (respect nudge interval)
    const lastNudge = this.lastNudgeTime.get(agentId) || 0;
    if (now - lastNudge < this.config.nudgeIntervalMs) {
      return; // Too soon since last nudge
    }

    if (nudgeCount >= this.config.maxNudges) {
      // Max nudges exceeded - escalate
      await this.escalateStuckAgent(agentId, worker, reason, duration);
      return;
    }

    // Send nudge
    const newNudgeCount = nudgeCount + 1;
    this.nudgeCounts.set(agentId, newNudgeCount);
    this.lastNudgeTime.set(agentId, now);

    await this.sendNudge(agentId, worker, newNudgeCount, reason, duration);
  }

  /**
   * Send a nudge to the stuck agent
   */
  private async sendNudge(
    agentId: string,
    worker: ActiveWorkerInfo,
    nudgeCount: number,
    reason: string,
    duration: number
  ): Promise<void> {
    const { runner } = worker;
    const sessionId = runner.getSessionId();

    if (!sessionId) {
      log.warn('stuck-detector', 'Cannot nudge agent without session ID', { agentId });
      return;
    }

    const nudgePrompts = [
      // Nudge 1: Gentle
      `## System Notice: Task Progress Check

You've been running for ${formatDuration(duration)} without completing.

**Detected Issue**: ${this.formatReason(reason)}

If you're still working, that's fine - just continue.
If you're stuck, please either:
1. Send a \`task-complete\` message with your results (even partial)
2. Send an \`ask-human\` message explaining what's blocking you

What would you like to do?`,

      // Nudge 2: Firm
      `## System Notice: Task Completion Required

**ATTENTION**: You have been running for ${formatDuration(duration)}.

This is your second reminder. Please complete your task now.

**Required Action**: Write a task-complete message or ask-human for assistance.

Do not continue working without responding to this notice.`,

      // Nudge 3: Final warning
      `## FINAL WARNING: Session Termination Imminent

Your session has been running for ${formatDuration(duration)} without completing.

**This is your final warning.**

If you do not send a \`task-complete\` or \`ask-human\` message within the next 2 minutes, your session will be **terminated** and the task will be marked as **failed**.

Respond NOW.`
    ];

    const prompt = nudgePrompts[Math.min(nudgeCount - 1, nudgePrompts.length - 1)];

    log.info('stuck-detector', `Nudging stuck agent (attempt ${nudgeCount})`, {
      agentId,
      reason,
      sessionId: sessionId.slice(0, 8),
      duration: formatDuration(duration),
    });

    this.emit('agent:nudged', {
      agentId,
      nudgeCount,
      reason,
      duration,
    });

    try {
      // Interrupt and resume with nudge prompt
      await runner.interrupt();
      const result = await runner.resume(sessionId, prompt);

      if (!result.success) {
        log.error('stuck-detector', 'Nudge resume failed', {
          agentId,
          error: result.error,
        });
      }
    } catch (error) {
      log.error('stuck-detector', 'Failed to nudge agent', {
        agentId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Escalate a stuck agent after max nudges
   */
  private async escalateStuckAgent(
    agentId: string,
    worker: ActiveWorkerInfo,
    reason: string,
    duration: number
  ): Promise<void> {
    const { runner, hookContext } = worker;
    const nudgeCount = this.nudgeCounts.get(agentId) || 0;

    log.warn('stuck-detector', 'Escalating stuck agent after max nudges', {
      agentId,
      nudges: nudgeCount,
      reason,
      duration: formatDuration(duration),
    });

    // Kill the worker
    runner.kill();

    // Clean up tracking
    this.nudgeCounts.delete(agentId);
    this.lastNudgeTime.delete(agentId);

    // Emit escalation event
    this.emit('agent:escalated', {
      agentId,
      reason,
      duration,
      nudgeCount,
    });

    // Write escalation message to core
    await this.writeEscalationMessage(agentId, worker, reason, duration, nudgeCount);
  }

  /**
   * Write escalation message to core/core
   */
  private async writeEscalationMessage(
    agentId: string,
    worker: ActiveWorkerInfo,
    reason: string,
    duration: number,
    nudgeCount: number
  ): Promise<void> {
    const { hookContext } = worker;
    const msgsDir = hookContext.msgsDir;

    if (!msgsDir) {
      log.error('stuck-detector', 'Cannot write escalation: msgsDir not set', { agentId });
      return;
    }

    const timestamp = Date.now();
    const msgId = `escalation-stuck-${timestamp}`;
    const filename = `${timestamp}-escalation-system--core-core-${msgId}.md`;
    const filepath = path.join(msgsDir, filename);

    const content = `---
to: core/core
from: system/stuck-detector
type: escalation
msg-id: ${msgId}
headline: Stuck agent terminated: ${agentId}
timestamp: ${new Date().toISOString()}
status: error
---

## Agent Stuck - Manual Intervention Required

**Agent**: ${agentId}
**Reason**: ${this.formatReason(reason)}
**Duration**: ${formatDuration(duration)}
**Nudge Attempts**: ${nudgeCount}

The agent was unresponsive after multiple nudge attempts and has been terminated.

**Original Task**:
${hookContext.taskBody?.slice(0, 500) || 'Unknown'}

**Recommended Actions**:
1. Review the session logs: \`tx logs --filter=${agentId}\`
2. Check for errors: \`tx logs --level=error\`
3. Retry the task manually if needed
`;

    try {
      fs.writeFileSync(filepath, content);
      log.info('stuck-detector', 'Wrote escalation message', { agentId, filepath });
    } catch (error) {
      log.error('stuck-detector', 'Failed to write escalation message', {
        agentId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Format stuck reason for human display
   */
  private formatReason(reason: string): string {
    switch (reason) {
      case 'awaiting-empty':
        return 'All responses received but session not completing';
      case 'idle-timeout':
        return 'Idle for extended period without task completion';
      case 'no-output':
        return 'No output or activity for extended period';
      case 'peers-complete':
        return 'All mesh peers completed but this agent is still running';
      default:
        return reason;
    }
  }

  /**
   * Clear nudge tracking for an agent (call when agent completes normally)
   */
  clearNudgeTracking(agentId: string): void {
    this.nudgeCounts.delete(agentId);
    this.lastNudgeTime.delete(agentId);
  }

  /**
   * Get current configuration
   */
  getConfig(): StuckAgentConfig {
    return { ...this.config };
  }

  /**
   * Check if detector is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

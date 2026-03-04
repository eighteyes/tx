/**
 * NudgeDetector - Auto-recovery for stalled mesh routing
 *
 * Responsibilities:
 * - Detect when a completing agent fails to forward work to the next route step
 * - Summarize the dead agent's output with Haiku
 * - Write recovery task to expected next agent via SystemMessageWriter
 * - Manage nudge timers and cancellation lifecycle
 */

import { log } from '../shared/logger.ts';
import { DispatchRouter } from './dispatch-router.ts';
import type { SystemMessageWriter } from '../core/system-message-writer.ts';
import type { MessageQueue } from '../queue/index.ts';
import type { TrackedMessage } from './worker-lifecycle.ts';
import { runHaikuQuery } from '../session/session-summarizer.ts';

export interface NudgeConfig {
  enabled: boolean;
  delayMs: number;
  maxNudgesPerAgent: number;
}

const DEFAULT_NUDGE_CONFIG: NudgeConfig = {
  enabled: true,
  delayMs: 15000,
  maxNudgesPerAgent: 1,
};

interface CompletionSnapshot {
  agentId: string;
  meshName: string;
  messagesSent: TrackedMessage[];
  output: string;
  taskBody: string;
  routing: Record<string, unknown>;
  agentNames: string[];
}

export class NudgeDetector {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private nudgeCounts: Map<string, number> = new Map();
  private config: NudgeConfig;
  private writer: SystemMessageWriter;
  private queue: MessageQueue;

  constructor(writer: SystemMessageWriter, queue: MessageQueue, config?: Partial<NudgeConfig>) {
    this.writer = writer;
    this.queue = queue;
    this.config = { ...DEFAULT_NUDGE_CONFIG, ...config };
  }

  /**
   * Schedule a nudge check after worker completion.
   * Call BEFORE removeActiveWorker so messagesSent is still available.
   */
  scheduleCheck(snapshot: CompletionSnapshot): void {
    if (!this.config.enabled) return;

    const { agentId, meshName } = snapshot;
    const currentNudges = this.nudgeCounts.get(agentId) || 0;

    if (currentNudges >= this.config.maxNudgesPerAgent) {
      log.debug('nudge-detector', 'Max nudges reached, skipping', { agentId, currentNudges });
      return;
    }

    // Cancel any existing timer for this agent
    this.cancelTimer(agentId);

    const timer = setTimeout(() => {
      this.timers.delete(agentId);
      this.evaluateAndNudge(snapshot).catch(err => {
        log.error('nudge-detector', 'Nudge evaluation failed', {
          agentId,
          error: (err as Error).message,
        });
      });
    }, this.config.delayMs);

    this.timers.set(agentId, timer);
    log.debug('nudge-detector', 'Scheduled nudge check', {
      agentId,
      delayMs: this.config.delayMs,
    });
  }

  /**
   * Evaluate whether a nudge is needed and execute if so
   */
  private async evaluateAndNudge(snapshot: CompletionSnapshot): Promise<void> {
    const { agentId, meshName, messagesSent, routing, agentNames } = snapshot;
    const agentName = agentId.split('/')[1];

    // Re-instantiate router from mesh config to resolve expected targets
    let router: DispatchRouter;
    try {
      router = new DispatchRouter(
        meshName,
        routing as Record<string, string | string[]>,
        agentNames
      );
    } catch (err) {
      log.debug('nudge-detector', 'Cannot build router, skipping nudge', {
        agentId,
        error: (err as Error).message,
      });
      return;
    }

    // Resolve expected targets for this agent (default outcome = 'complete')
    const resolved = router.resolve(agentName, 'complete');
    if (!resolved) {
      log.debug('nudge-detector', 'No route resolved, skipping nudge', { agentId });
      return;
    }

    const expectedTargets = resolved.targets || [resolved.target];

    // Skip if target is core/core (terminal agent)
    if (expectedTargets.every(t => t === 'core/core')) {
      log.debug('nudge-detector', 'Terminal agent (core/core target), skipping nudge', { agentId });
      return;
    }

    // Check each target: did the agent already send to it, or is there pending work?
    const sentTo = new Set(messagesSent.map(m => m.to));

    for (const target of expectedTargets) {
      if (target === 'core/core') continue;

      // Already sent
      if (sentTo.has(target)) continue;

      // Check queue for pending messages
      const pendingCount = this.queue.countPending(target);
      if (pendingCount > 0) continue;

      // Target has no work — trigger nudge
      log.warn('nudge-detector', 'Stalled route detected, sending nudge', {
        agentId,
        target,
        expectedTargets,
        messagesSent: messagesSent.map(m => m.to),
      });

      await this.sendNudge(snapshot, target);
    }
  }

  /**
   * Summarize dead agent output and send recovery task
   */
  private async sendNudge(snapshot: CompletionSnapshot, target: string): Promise<void> {
    const { agentId, output, taskBody } = snapshot;

    // Summarize the dead agent's output with Haiku
    let summary: string;
    try {
      summary = await runHaikuQuery(
        `Summarize the following agent output in 2-3 sentences. Focus on what was accomplished and what the next agent needs to do.\n\nAgent: ${agentId}\n\nOriginal task:\n${taskBody?.slice(0, 500) || '(no task body)'}\n\nAgent output:\n${output?.slice(0, 2000) || '(no output captured)'}`
      );
    } catch (err) {
      summary = `Agent ${agentId} completed but failed to forward work. Original task: ${taskBody?.slice(0, 200) || '(unknown)'}`;
      log.warn('nudge-detector', 'Haiku summary failed, using fallback', {
        agentId,
        error: (err as Error).message,
      });
    }

    // Write recovery task to target agent
    this.writer.write({
      to: target,
      from: 'system/nudge-detector',
      type: 'task',
      headline: `Recovery: ${agentId} completed without forwarding`,
      body: `# Auto-Recovery: Stalled Route

Agent \`${agentId}\` completed its work but did not forward a task to you as expected.

## Summary of Previous Agent's Work

${summary}

## Original Task Context

${taskBody?.slice(0, 500) || '(no task body available)'}

---

**Note**: This is an auto-recovery message. The previous agent may have completed its work but failed to write the handoff message. Please continue the workflow based on the summary above.`,
    });

    // Track nudge count
    const count = (this.nudgeCounts.get(agentId) || 0) + 1;
    this.nudgeCounts.set(agentId, count);

    log.info('nudge-detector', 'Nudge sent', {
      from: agentId,
      to: target,
      nudgeCount: count,
    });
  }

  /**
   * Cancel timer for a specific agent
   */
  cancelTimer(agentId: string): void {
    const timer = this.timers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(agentId);
    }
  }

  /**
   * Cancel all pending timers (shutdown)
   */
  cancelAll(): void {
    for (const [agentId, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    log.debug('nudge-detector', 'All timers cancelled');
  }

  /**
   * Cancel timers for all agents in a mesh
   */
  cancelForMesh(meshName: string): void {
    for (const [agentId, timer] of this.timers) {
      if (agentId.startsWith(`${meshName}/`)) {
        clearTimeout(timer);
        this.timers.delete(agentId);
      }
    }
  }

  /**
   * Reset nudge counts (e.g., on new mesh run)
   */
  resetCounts(): void {
    this.nudgeCounts.clear();
  }
}

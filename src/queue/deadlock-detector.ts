/**
 * DeadlockDetector - Detects and breaks circular ask chains
 *
 * Circular ask patterns that never resolve:
 * - A asks B, B asks C, C asks A (direct cycle)
 * - A asks B, B completes, A asks B again with same msg-id (self-loop)
 * - Multiple agents all waiting for each other
 *
 * Uses DFS with 3-color marking to detect cycles in the ask graph.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import type { MessageQueue, PendingAsk } from './index.ts';
import type { SystemMessageWriter } from '../core/system-message-writer.ts';

/**
 * Configuration for deadlock detection
 */
export interface DeadlockConfig {
  /** Whether deadlock detection is enabled */
  enabled: boolean;
  /** How often to scan for deadlocks (default: 1 minute) */
  scanIntervalMs: number;
  /** Auto-break cycles of this depth or less (default: 3) */
  autoBreakDepth: number;
  /** Escalate to human for cycles deeper than this (default: 5) */
  escalateDepth: number;
}

/**
 * Information about a detected cycle
 */
export interface CycleInfo {
  /** Agents involved in the cycle */
  agents: string[];
  /** Message IDs involved */
  msgIds: string[];
  /** When the cycle was detected */
  detectedAt: number;
  /** How many agents in the cycle */
  cycleDepth: number;
}

/**
 * Default configuration
 */
export const DEFAULT_DEADLOCK_CONFIG: DeadlockConfig = {
  enabled: true,
  scanIntervalMs: 60000,  // 1 minute
  autoBreakDepth: 3,
  escalateDepth: 5,
};

/**
 * DeadlockDetector - Periodic cycle detection in ask chains
 */
export class DeadlockDetector extends EventEmitter {
  private config: DeadlockConfig;
  private queue: MessageQueue;
  private msgsDir: string;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private writer?: SystemMessageWriter;

  constructor(queue: MessageQueue, msgsDir: string, config: Partial<DeadlockConfig> = {}, writer?: SystemMessageWriter) {
    super();
    this.queue = queue;
    this.msgsDir = msgsDir;
    this.config = { ...DEFAULT_DEADLOCK_CONFIG, ...config };
    this.writer = writer;
  }

  /**
   * Start the detector interval
   */
  start(): void {
    if (this.running || !this.config.enabled) return;

    this.running = true;
    this.checkInterval = setInterval(() => {
      this.detectAndHandle();
    }, this.config.scanIntervalMs);

    log.info('deadlock-detector', 'Started deadlock detector', {
      scanIntervalMs: this.config.scanIntervalMs,
      autoBreakDepth: this.config.autoBreakDepth,
      escalateDepth: this.config.escalateDepth,
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
  }

  /**
   * Detect cycles and handle them
   */
  detectAndHandle(): void {
    const cycles = this.detectCycles();

    if (cycles.length === 0) {
      return;
    }

    log.warn('deadlock-detector', `Detected ${cycles.length} deadlock(s)`, {
      cycles: cycles.map(c => ({
        agents: c.agents,
        depth: c.cycleDepth,
      })),
    });

    for (const cycle of cycles) {
      this.handleCycle(cycle);
    }
  }

  /**
   * Detect cycles in the pending asks graph using DFS with coloring
   */
  detectCycles(): CycleInfo[] {
    const pendingAsks = this.queue.getAllPendingAsks();

    if (pendingAsks.length === 0) {
      return [];
    }

    // Build adjacency list: from_agent → Set<to_agent>
    const graph = new Map<string, Set<string>>();
    const asksByEdge = new Map<string, PendingAsk[]>();  // "from→to" → asks

    for (const ask of pendingAsks) {
      if (!graph.has(ask.from_agent)) {
        graph.set(ask.from_agent, new Set());
      }
      graph.get(ask.from_agent)!.add(ask.to_agent);

      // Track asks by edge for later
      const edgeKey = `${ask.from_agent}→${ask.to_agent}`;
      if (!asksByEdge.has(edgeKey)) {
        asksByEdge.set(edgeKey, []);
      }
      asksByEdge.get(edgeKey)!.push(ask);
    }

    // DFS with 3-color marking (WHITE=0, GRAY=1, BLACK=2)
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const cycles: CycleInfo[] = [];

    const dfs = (node: string, path: string[]): void => {
      color.set(node, GRAY);
      path.push(node);

      for (const neighbor of graph.get(node) || []) {
        if (color.get(neighbor) === GRAY) {
          // Back edge found = cycle!
          const cycleStart = path.indexOf(neighbor);
          const cycleAgents = path.slice(cycleStart);

          // Collect msg-ids involved in the cycle
          const msgIds: string[] = [];
          for (let i = 0; i < cycleAgents.length; i++) {
            const from = cycleAgents[i];
            const to = cycleAgents[(i + 1) % cycleAgents.length];
            const edgeKey = `${from}→${to}`;
            const edgeAsks = asksByEdge.get(edgeKey) || [];
            for (const ask of edgeAsks) {
              msgIds.push(ask.msg_id);
            }
          }

          cycles.push({
            agents: cycleAgents,
            msgIds,
            detectedAt: Date.now(),
            cycleDepth: cycleAgents.length,
          });
        } else if (color.get(neighbor) !== BLACK) {
          dfs(neighbor, path);
        }
      }

      path.pop();
      color.set(node, BLACK);
    };

    // Run DFS from each unvisited node
    for (const node of graph.keys()) {
      if (!color.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  /**
   * Handle a detected cycle based on depth
   */
  private handleCycle(cycle: CycleInfo): void {
    this.emit('deadlock:detected', cycle);

    if (cycle.cycleDepth <= this.config.autoBreakDepth) {
      // Auto-break small cycles
      log.info('deadlock-detector', 'Auto-breaking cycle', {
        agents: cycle.agents,
        depth: cycle.cycleDepth,
      });
      this.breakCycle(cycle);
    } else if (cycle.cycleDepth <= this.config.escalateDepth) {
      // Break but also notify
      log.warn('deadlock-detector', 'Breaking medium-depth cycle with notification', {
        agents: cycle.agents,
        depth: cycle.cycleDepth,
      });
      this.breakCycle(cycle);
      this.notifyCore(cycle, 'broken');
    } else {
      // Escalate to human
      log.error('deadlock-detector', 'Escalating deep cycle to human', {
        agents: cycle.agents,
        depth: cycle.cycleDepth,
      });
      this.escalateCycle(cycle);
    }
  }

  /**
   * Break a cycle by sending synthetic error response to oldest ask
   */
  private breakCycle(cycle: CycleInfo): void {
    // Find the oldest ask in the cycle
    const pendingAsks = cycle.msgIds
      .map(id => this.queue.getPendingAskByMsgId(id))
      .filter((ask): ask is PendingAsk => ask !== undefined)
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

    if (pendingAsks.length === 0) {
      log.warn('deadlock-detector', 'No pending asks found for cycle', { cycle: cycle.agents });
      return;
    }

    const oldestAsk = pendingAsks[0];

    // Build synthetic ask-response content
    const cycleStr = cycle.agents.join(' → ') + ' → ' + cycle.agents[0];
    const syntheticResponse = `## DEADLOCK DETECTED

Your ask to **${oldestAsk.to_agent}** was part of a circular dependency.

**Cycle**: ${cycleStr}

This ask has been automatically resolved to break the deadlock.

**What to Do**:
1. Review your workflow design to prevent circular dependencies
2. Consider using fire-and-forget patterns for auxiliary requests

Your task should now continue. Handle this as an error response.`;

    // Clear the pending ask
    if (oldestAsk.id) {
      this.queue.clearPendingAsk(oldestAsk.id);
    }

    // Emit event with full response data for direct injection
    this.emit('deadlock:broken', {
      cycle,
      brokenAsk: oldestAsk,
      syntheticResponse: {
        from: 'system/deadlock-detector',
        to: oldestAsk.from_agent,
        content: syntheticResponse,
        headline: 'Deadlock detected and broken',
      },
    });
  }

  /**
   * Notify core about a cycle
   */
  private notifyCore(cycle: CycleInfo, status: 'broken' | 'escalated'): void {
    const cycleStr = cycle.agents.join(' → ') + ' → ' + cycle.agents[0];

    const body = `## Deadlock ${status === 'broken' ? 'Broken' : 'Escalated'}

A circular dependency was detected and ${status === 'broken' ? 'automatically resolved' : 'requires attention'}.

**Cycle**: ${cycleStr}
**Depth**: ${cycle.cycleDepth} agents
**Detected**: ${new Date(cycle.detectedAt).toISOString()}

${status === 'broken'
  ? 'The oldest ask in the cycle was automatically resolved with an error response.'
  : '**ACTION REQUIRED**: Please review the involved agents and break the cycle manually.'
}

**Involved Message IDs**:
${cycle.msgIds.map(id => `- ${id}`).join('\n')}`;

    if (this.writer) {
      this.writer.write({
        to: 'core/core',
        from: 'system/deadlock-detector',
        headline: `Deadlock ${status}: ${cycle.agents[0]}`,
        body,
        extraFrontmatter: { status: status === 'broken' ? 'complete' : 'error' },
      });
      return;
    }

    // Fallback: direct file write
    const timestamp = Date.now();
    const msgId = `deadlock-${status}-${timestamp}`;
    const filename = `${timestamp}-notification-system--core-core-${msgId}.md`;
    const filepath = path.join(this.msgsDir, filename);

    const content = `---\nto: core/core\nfrom: system/deadlock-detector\ntype: notification\nmsg-id: ${msgId}\nheadline: Deadlock ${status}: ${cycle.agents[0]}\ntimestamp: ${new Date().toISOString()}\nstatus: ${status === 'broken' ? 'complete' : 'error'}\n---\n\n${body}\n`;

    try {
      fs.writeFileSync(filepath, content);
    } catch (error) {
      log.error('deadlock-detector', 'Failed to write notification', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Escalate a deep cycle to human
   */
  private escalateCycle(cycle: CycleInfo): void {
    this.notifyCore(cycle, 'escalated');
    this.emit('deadlock:escalated', cycle);
  }

  /**
   * Get current configuration
   */
  getConfig(): DeadlockConfig {
    return { ...this.config };
  }

  /**
   * Check if detector is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Manually trigger a cycle check
   */
  check(): CycleInfo[] {
    return this.detectCycles();
  }
}

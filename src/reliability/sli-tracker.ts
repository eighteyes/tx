/**
 * SLITracker - Service Level Indicator tracking for mesh reliability
 *
 * Nine 4 pattern: You can't improve what you can't measure.
 * Track success rates, latencies, and failure categories per mesh.
 *
 * Tracks:
 * - Message delivery success rate (target: 99.99%)
 * - Worker completion rate
 * - Mean time to recovery (MTTR)
 * - Failure taxonomy (categorized failures for targeted fixes)
 * - Per-step success rate (for multi-step workflows)
 */

import { log } from '../shared/logger.ts';

export type FailureCategory =
  | 'model_error'        // API/model failure
  | 'routing_error'      // Message sent to wrong/missing agent
  | 'timeout'            // Worker exceeded time limit
  | 'guardrail_kill'     // Killed by guardrail enforcement
  | 'crash'              // Unexpected process crash
  | 'stuck'              // Agent stopped producing output
  | 'policy_violation'   // Usage policy error
  | 'gate_failure'       // FSM gate/script failure
  | 'circuit_open'       // Circuit breaker prevented execution
  | 'unknown';           // Uncategorized

export interface SLIConfig {
  /** How long to retain data in ms (default: 7 days) */
  retentionMs: number;
  /** Bucketing interval for rate calculations (default: 60000 = 1 min) */
  bucketMs: number;
}

interface EventRecord {
  timestamp: number;
  meshName: string;
  agentId: string;
  success: boolean;
  durationMs?: number;
  category?: FailureCategory;
  reason?: string;
}

export interface SLISnapshot {
  /** Overall success rate (0-1) */
  successRate: number;
  /** Total events tracked */
  totalEvents: number;
  /** Total successes */
  totalSuccesses: number;
  /** Total failures */
  totalFailures: number;
  /** Mean time to recovery in ms (avg time from failure to next success for same agent) */
  mttrMs: number | null;
  /** Failure breakdown by category */
  failuresByCategory: Record<string, number>;
  /** Per-mesh success rates */
  byMesh: Record<string, { success: number; total: number; rate: number }>;
  /** Per-agent success rates */
  byAgent: Record<string, { success: number; total: number; rate: number }>;
  /** Current nines level (e.g., "99.9%") */
  ninesLevel: string;
  /** Window start timestamp */
  windowStart: number;
  /** Window end timestamp */
  windowEnd: number;
}

const DEFAULT_CONFIG: SLIConfig = {
  retentionMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
  bucketMs: 60_000,
};

export class SLITracker {
  private events: EventRecord[] = [];
  private config: SLIConfig;
  private lastFailureByAgent: Map<string, number> = new Map();
  private mttrSamples: number[] = [];

  constructor(config?: Partial<SLIConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a successful operation
   */
  recordSuccess(meshName: string, agentId: string, durationMs?: number): void {
    const now = Date.now();
    this.events.push({
      timestamp: now,
      meshName,
      agentId,
      success: true,
      durationMs,
    });

    // MTTR: if this agent had a recent failure, record recovery time
    const lastFailure = this.lastFailureByAgent.get(agentId);
    if (lastFailure) {
      this.mttrSamples.push(now - lastFailure);
      this.lastFailureByAgent.delete(agentId);
    }

    this.gc();
  }

  /**
   * Record a failed operation
   */
  recordFailure(
    meshName: string,
    agentId: string,
    category: FailureCategory,
    reason?: string
  ): void {
    const now = Date.now();
    this.events.push({
      timestamp: now,
      meshName,
      agentId,
      success: false,
      category,
      reason,
    });

    this.lastFailureByAgent.set(agentId, now);

    log.warn('sli', 'Failure recorded', {
      meshName,
      agentId,
      category,
      reason,
    });

    this.gc();
  }

  /**
   * Get SLI snapshot for a time window
   */
  getSnapshot(windowMs?: number): SLISnapshot {
    const now = Date.now();
    const windowStart = windowMs ? now - windowMs : 0;
    const events = this.events.filter(e => e.timestamp >= windowStart);

    const totalEvents = events.length;
    const totalSuccesses = events.filter(e => e.success).length;
    const totalFailures = totalEvents - totalSuccesses;
    const successRate = totalEvents > 0 ? totalSuccesses / totalEvents : 1;

    // Failure breakdown
    const failuresByCategory: Record<string, number> = {};
    for (const e of events) {
      if (!e.success && e.category) {
        failuresByCategory[e.category] = (failuresByCategory[e.category] || 0) + 1;
      }
    }

    // Per-mesh rates
    const byMesh: Record<string, { success: number; total: number; rate: number }> = {};
    for (const e of events) {
      if (!byMesh[e.meshName]) {
        byMesh[e.meshName] = { success: 0, total: 0, rate: 0 };
      }
      byMesh[e.meshName].total++;
      if (e.success) byMesh[e.meshName].success++;
    }
    for (const mesh of Object.values(byMesh)) {
      mesh.rate = mesh.total > 0 ? mesh.success / mesh.total : 1;
    }

    // Per-agent rates
    const byAgent: Record<string, { success: number; total: number; rate: number }> = {};
    for (const e of events) {
      if (!byAgent[e.agentId]) {
        byAgent[e.agentId] = { success: 0, total: 0, rate: 0 };
      }
      byAgent[e.agentId].total++;
      if (e.success) byAgent[e.agentId].success++;
    }
    for (const agent of Object.values(byAgent)) {
      agent.rate = agent.total > 0 ? agent.success / agent.total : 1;
    }

    // MTTR
    const mttrMs = this.mttrSamples.length > 0
      ? this.mttrSamples.reduce((a, b) => a + b, 0) / this.mttrSamples.length
      : null;

    return {
      successRate,
      totalEvents,
      totalSuccesses,
      totalFailures,
      mttrMs,
      failuresByCategory,
      byMesh,
      byAgent,
      ninesLevel: this.calculateNines(successRate),
      windowStart,
      windowEnd: now,
    };
  }

  /**
   * Calculate human-readable nines level
   */
  private calculateNines(rate: number): string {
    if (rate >= 0.9999) return '99.99% (4 nines)';
    if (rate >= 0.999) return '99.9% (3 nines)';
    if (rate >= 0.99) return '99% (2 nines)';
    if (rate >= 0.9) return '90% (1 nine)';
    return `${(rate * 100).toFixed(1)}% (< 1 nine)`;
  }

  /**
   * Garbage collect old events
   */
  private gc(): void {
    const cutoff = Date.now() - this.config.retentionMs;
    this.events = this.events.filter(e => e.timestamp >= cutoff);

    // Also clean MTTR samples (keep last 100)
    if (this.mttrSamples.length > 100) {
      this.mttrSamples = this.mttrSamples.slice(-100);
    }
  }

  /**
   * Reset all tracking (e.g., fresh start)
   */
  reset(): void {
    this.events = [];
    this.lastFailureByAgent.clear();
    this.mttrSamples = [];
  }
}

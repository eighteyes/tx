/**
 * MetricsAggregator - Session and Worker Metrics Tracking
 *
 * Centralizes all metrics-related logic extracted from dispatcher:
 * - Session timing (start, end, duration)
 * - Message counts per worker
 * - Token usage tracking
 * - Tool usage statistics
 * - Worker lifecycle metrics
 * - Performance measurements
 *
 * Key features:
 * - Event-based: Emits 'metrics:updated' for real-time consumers
 * - Persistence: Writes to .ai/tx/data/metrics.json periodically
 * - Read-only observer: Doesn't modify when/how metrics are recorded
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';
import type { SessionMetrics, WorkerMetrics, QueryMetrics, SemanticModel } from '../shared/types.ts';

/**
 * Options for initializing a session
 */
export interface SessionInitOptions {
  meshInstance: string;
  meshName: string;
}

/**
 * Options for recording worker metrics
 */
export interface WorkerMetricsData {
  agentId: string;
  model: SemanticModel;
  queries?: QueryMetrics[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalDurationMs?: number;
  totalToolCalls?: number;
  startedAt: number;
  messageCount?: number;
  toolCalls?: number;
}

/**
 * Metrics summary for external consumers
 */
export interface MetricsSummary {
  activeSessions: number;
  totalWorkers: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalToolCalls: number;
  sessions: SessionMetrics[];
}

/**
 * Persisted metrics file structure
 */
interface MetricsFile {
  sessions: SessionMetrics[];
  updatedAt: number;
}

/**
 * Events emitted by MetricsAggregator
 */
export interface MetricsAggregatorEvents {
  'metrics:updated': { type: 'session' | 'worker'; meshInstance?: string; agentId?: string };
  'session:complete': SessionMetrics;
}

/**
 * Aggregates metrics for sessions and workers
 */
export class MetricsAggregator extends EventEmitter {
  private sessionMetrics: Map<string, SessionMetrics> = new Map();
  private dataDir: string;
  private metricsFilePath: string;
  private persistInterval: NodeJS.Timeout | null = null;
  private persistIntervalMs: number;

  constructor(workDir: string, persistIntervalMs = 30000) {
    super();
    this.dataDir = path.join(workDir, '.ai', 'tx', 'data');
    this.metricsFilePath = path.join(this.dataDir, 'metrics.json');
    this.persistIntervalMs = persistIntervalMs;
  }

  /**
   * Start periodic persistence (call after construction if persistence needed)
   */
  startPersistence(): void {
    if (this.persistInterval) return;

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.persistInterval = setInterval(() => {
      this.persist();
    }, this.persistIntervalMs);

    log.debug('metrics-aggregator', 'Started persistence', {
      intervalMs: this.persistIntervalMs,
      filePath: this.metricsFilePath,
    });
  }

  /**
   * Stop periodic persistence (call on shutdown)
   */
  stopPersistence(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;

      // Final persist on stop
      this.persist();

      log.debug('metrics-aggregator', 'Stopped persistence');
    }
  }

  // ============================================================================
  // Session Lifecycle
  // ============================================================================

  /**
   * Initialize metrics for a new mesh session
   * Called when first worker starts in a mesh instance
   */
  initSession(options: SessionInitOptions): void {
    const { meshInstance, meshName } = options;

    if (this.sessionMetrics.has(meshInstance)) {
      // Session already initialized - this is fine for parallel workers
      return;
    }

    const session: SessionMetrics = {
      meshInstance,
      meshName,
      workers: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
      totalToolCalls: 0,
      workerCount: 0,
      startedAt: Date.now(),
    };

    this.sessionMetrics.set(meshInstance, session);

    this.emit('metrics:updated', { type: 'session', meshInstance });

    log.debug('metrics-aggregator', 'Session initialized', {
      meshInstance,
      meshName,
    });
  }

  /**
   * Check if a session exists
   */
  hasSession(meshInstance: string): boolean {
    return this.sessionMetrics.has(meshInstance);
  }

  /**
   * Get session metrics by mesh instance
   */
  getSession(meshInstance: string): SessionMetrics | undefined {
    return this.sessionMetrics.get(meshInstance);
  }

  /**
   * Find session by mesh name (for cases where meshInstance isn't known)
   * Returns the first matching session
   */
  findSessionByMeshName(meshName: string): { key: string; session: SessionMetrics } | undefined {
    for (const [key, session] of this.sessionMetrics.entries()) {
      if (session.meshName === meshName) {
        return { key, session };
      }
    }
    return undefined;
  }

  // ============================================================================
  // Worker Metrics Tracking
  // ============================================================================

  /**
   * Track completed worker metrics
   * Accumulates worker metrics into session totals
   */
  trackWorkerComplete(meshInstance: string, metrics: WorkerMetricsData): void {
    const session = this.sessionMetrics.get(meshInstance);
    if (!session) {
      log.warn('metrics-aggregator', 'Cannot track worker: session not found', {
        meshInstance,
        agentId: metrics.agentId,
      });
      return;
    }

    // Create worker metrics record
    const workerMetrics: WorkerMetrics = {
      agentId: metrics.agentId,
      model: metrics.model,
      queries: metrics.queries || [],
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      totalCostUsd: metrics.totalCostUsd,
      totalDurationMs: metrics.totalDurationMs || 0,
      totalToolCalls: metrics.totalToolCalls || 0,
      startedAt: metrics.startedAt,
      completedAt: Date.now(),
    };

    // Accumulate into session
    session.workers.push(workerMetrics);
    session.totalInputTokens += metrics.totalInputTokens;
    session.totalOutputTokens += metrics.totalOutputTokens;
    session.totalCostUsd += metrics.totalCostUsd;
    session.totalToolCalls += metrics.totalToolCalls || 0;
    session.workerCount++;

    this.emit('metrics:updated', {
      type: 'worker',
      meshInstance,
      agentId: metrics.agentId,
    });

    log.debug('metrics-aggregator', 'Worker metrics tracked', {
      meshInstance,
      agentId: metrics.agentId,
      workerCount: session.workerCount,
      totalCost: session.totalCostUsd.toFixed(4),
    });
  }

  // ============================================================================
  // Session Completion
  // ============================================================================

  /**
   * Mark a session as complete
   * Sets completion timestamps and calculates duration
   */
  markSessionComplete(meshInstance: string): SessionMetrics | undefined {
    const session = this.sessionMetrics.get(meshInstance);
    if (!session) return undefined;

    session.completedAt = Date.now();
    session.totalDurationMs = session.completedAt - session.startedAt;

    this.emit('metrics:updated', { type: 'session', meshInstance });

    log.debug('metrics-aggregator', 'Session marked complete', {
      meshInstance,
      durationMs: session.totalDurationMs,
      workerCount: session.workerCount,
    });

    return session;
  }

  /**
   * Finalize and remove a session (called after logging/cleanup)
   * Emits session:complete event and removes from tracking
   */
  finalizeSession(meshInstance: string): SessionMetrics | undefined {
    const session = this.sessionMetrics.get(meshInstance);
    if (!session) return undefined;

    // Ensure completion timestamps are set
    if (!session.completedAt) {
      session.completedAt = Date.now();
      session.totalDurationMs = session.completedAt - session.startedAt;
    }

    // Emit completion event
    this.emit('session:complete', session);

    // Remove from tracking
    this.sessionMetrics.delete(meshInstance);

    log.debug('metrics-aggregator', 'Session finalized', {
      meshInstance,
      meshName: session.meshName,
      workerCount: session.workerCount,
      totalCost: session.totalCostUsd.toFixed(4),
    });

    return session;
  }

  // ============================================================================
  // Summary and Retrieval
  // ============================================================================

  /**
   * Get a summary of all tracked metrics
   */
  summarize(): MetricsSummary {
    const sessions = Array.from(this.sessionMetrics.values());

    let totalWorkers = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;
    let totalToolCalls = 0;

    for (const session of sessions) {
      totalWorkers += session.workerCount;
      totalInputTokens += session.totalInputTokens;
      totalOutputTokens += session.totalOutputTokens;
      totalCostUsd += session.totalCostUsd;
      totalToolCalls += session.totalToolCalls;
    }

    return {
      activeSessions: sessions.length,
      totalWorkers,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      totalToolCalls,
      sessions,
    };
  }

  /**
   * Get all session keys (mesh instances)
   */
  getSessionKeys(): string[] {
    return Array.from(this.sessionMetrics.keys());
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessionMetrics.size;
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Persist current metrics to disk
   */
  persist(): void {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      const data: MetricsFile = {
        sessions: Array.from(this.sessionMetrics.values()),
        updatedAt: Date.now(),
      };

      fs.writeFileSync(this.metricsFilePath, JSON.stringify(data, null, 2));

      log.debug('metrics-aggregator', 'Metrics persisted', {
        sessionCount: data.sessions.length,
      });
    } catch (error) {
      log.error('metrics-aggregator', 'Failed to persist metrics', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Load metrics from disk (for recovery/debugging)
   * Note: This replaces current in-memory state
   */
  loadFromDisk(): boolean {
    try {
      if (!fs.existsSync(this.metricsFilePath)) {
        return false;
      }

      const content = fs.readFileSync(this.metricsFilePath, 'utf-8');
      const data: MetricsFile = JSON.parse(content);

      this.sessionMetrics.clear();
      for (const session of data.sessions) {
        this.sessionMetrics.set(session.meshInstance, session);
      }

      log.info('metrics-aggregator', 'Metrics loaded from disk', {
        sessionCount: data.sessions.length,
        updatedAt: new Date(data.updatedAt).toISOString(),
      });

      return true;
    } catch (error) {
      log.error('metrics-aggregator', 'Failed to load metrics from disk', {
        error: (error as Error).message,
      });
      return false;
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear metrics for a specific mesh (by mesh name)
   * Returns number of sessions cleared
   */
  clearForMesh(meshName: string): number {
    let cleared = 0;
    for (const [key, session] of this.sessionMetrics.entries()) {
      if (session.meshName === meshName) {
        this.sessionMetrics.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      log.debug('metrics-aggregator', 'Cleared metrics for mesh', {
        meshName,
        cleared,
      });
    }

    return cleared;
  }

  /**
   * Clear all metrics (for shutdown or reset)
   */
  clear(): void {
    this.sessionMetrics.clear();
    log.debug('metrics-aggregator', 'All metrics cleared');
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    this.stopPersistence();
    this.persist();  // Final persist
    this.clear();
  }
}

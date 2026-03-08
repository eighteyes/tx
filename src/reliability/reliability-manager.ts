/**
 * ReliabilityManager - Central coordinator for all reliability features
 *
 * Provides a single integration point for the dispatcher to wire up:
 * - Dead letter queue (failed message recovery)
 * - Circuit breakers (cascading failure prevention)
 * - Heartbeat monitoring (stalled worker detection)
 * - SLI tracking (reliability measurement)
 * - Safe mode (gradual autonomy control)
 *
 * Usage in dispatcher.start():
 *   this.reliability = new ReliabilityManager(this.queue.getDb(), this.config.workDir);
 *   this.reliability.start();
 *
 * Wire events:
 *   // On worker complete
 *   this.reliability.recordSuccess(meshName, agentId, durationMs);
 *   // On worker error
 *   this.reliability.recordFailure(meshName, agentId, 'crash', error.message);
 *   // On worker output (heartbeat)
 *   this.reliability.heartbeat(agentId);
 */

import type Database from 'better-sqlite3';
import { DeadLetterQueue, type DLQStats, type ReplayResult } from './dead-letter-queue.ts';
import { CircuitBreaker, type CircuitBreakerState } from './circuit-breaker.ts';
import { HeartbeatMonitor, type AgentHealth } from './heartbeat-monitor.ts';
import { SLITracker, type SLISnapshot, type FailureCategory } from './sli-tracker.ts';
import { SafeMode, type SafeModeLevel, type SafeModeState } from './safe-mode.ts';
import type { SystemMessageWriter } from '../core/system-message-writer.ts';
import { log } from '../shared/logger.ts';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface ReliabilityConfig {
  circuitBreaker?: {
    failureThreshold?: number;
    cooldownMs?: number;
    windowMs?: number;
  };
  heartbeat?: {
    warnMs?: number;
    staleMs?: number;
    deadMs?: number;
    checkIntervalMs?: number;
  };
  safeMode?: {
    defaultLevel?: SafeModeLevel;
    autoEscalate?: boolean;
    cautiousThreshold?: number;
    restrictedThreshold?: number;
    lockdownThreshold?: number;
  };
  dlq?: {
    maxRetries?: number;
  };
  sli?: {
    retentionMs?: number;
  };
}

export interface ReliabilityStatus {
  sli: SLISnapshot;
  dlq: DLQStats;
  safeMode: SafeModeState;
  circuitBreakers: Array<{ agentId: string; state: CircuitBreakerState; failures: number }>;
  agentHealth: AgentHealth[];
}

export class ReliabilityManager {
  readonly dlq: DeadLetterQueue;
  readonly circuitBreaker: CircuitBreaker;
  readonly heartbeat: HeartbeatMonitor;
  readonly sli: SLITracker;
  readonly safeMode: SafeMode;
  private workDir: string;

  constructor(db: Database.Database, workDir: string, config?: ReliabilityConfig) {
    this.workDir = workDir;

    // Load config from config.yaml if exists
    const fileConfig = this.loadConfigFromFile(workDir);
    const merged = { ...fileConfig, ...config };

    this.dlq = new DeadLetterQueue(db, merged.dlq?.maxRetries);
    this.circuitBreaker = new CircuitBreaker(merged.circuitBreaker, db);
    this.heartbeat = new HeartbeatMonitor(merged.heartbeat);
    this.sli = new SLITracker(merged.sli);
    this.safeMode = new SafeMode(merged.safeMode);

    // Wire heartbeat callbacks
    this.heartbeat.on('stale', (health) => {
      log.warn('reliability', `Agent stale: ${health.agentId}`, {
        silenceMs: health.silenceMs,
      });
    });

    this.heartbeat.on('dead', (health) => {
      this.recordFailure(
        health.agentId.split('/')[0],
        health.agentId,
        'stuck',
        `No output for ${Math.round(health.silenceMs / 1000)}s`
      );
    });

    log.info('reliability', 'ReliabilityManager initialized', {
      dlqMaxRetries: merged.dlq?.maxRetries || 3,
      cbThreshold: merged.circuitBreaker?.failureThreshold || 3,
      safeModeDefault: merged.safeMode?.defaultLevel || 'normal',
      autoEscalate: merged.safeMode?.autoEscalate || false,
    });
  }

  /**
   * Load reliability config from .ai/tx/data/config.yaml
   */
  private loadConfigFromFile(workDir: string): ReliabilityConfig {
    const configPath = path.join(workDir, '.ai', 'tx', 'data', 'config.yaml');
    if (!fs.existsSync(configPath)) return {};

    try {
      const content = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
      return content?.reliability || {};
    } catch {
      return {};
    }
  }

  /**
   * Start monitoring (heartbeat timer)
   */
  start(): void {
    this.heartbeat.start();
    log.info('reliability', 'Monitoring started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.heartbeat.stop();
  }

  // ============================================================
  // Integration API (called by dispatcher)
  // ============================================================

  /**
   * Check if an agent can execute (circuit breaker + safe mode)
   * Returns { allowed, reason } — dispatcher should skip spawn if !allowed
   */
  canSpawn(meshName: string, agentId: string): { allowed: boolean; reason?: string } {
    // Circuit breaker check
    if (!this.circuitBreaker.canExecute(agentId)) {
      this.sli.recordFailure(meshName, agentId, 'circuit_open', 'Circuit breaker is open');
      return { allowed: false, reason: `Circuit breaker OPEN for ${agentId}` };
    }

    // Safe mode check
    const safeLevel = this.safeMode.getLevel(meshName);
    if (safeLevel === 'lockdown') {
      return { allowed: false, reason: `Safe mode LOCKDOWN for mesh ${meshName}` };
    }

    return { allowed: true };
  }

  /**
   * Register agent for heartbeat monitoring (call on spawn)
   */
  registerAgent(agentId: string): void {
    this.heartbeat.register(agentId);
  }

  /**
   * Record heartbeat (call on worker output)
   */
  recordHeartbeat(agentId: string): void {
    this.heartbeat.heartbeat(agentId);
  }

  /**
   * Record successful completion
   */
  recordSuccess(meshName: string, agentId: string, durationMs?: number): void {
    this.sli.recordSuccess(meshName, agentId, durationMs);
    this.circuitBreaker.recordSuccess(agentId);
    this.heartbeat.unregister(agentId);
  }

  /**
   * Record failure
   */
  recordFailure(
    meshName: string,
    agentId: string,
    category: FailureCategory,
    reason?: string
  ): void {
    this.sli.recordFailure(meshName, agentId, category, reason);
    this.circuitBreaker.recordFailure(agentId, reason || category);
    this.heartbeat.unregister(agentId);

    // Auto-evaluate safe mode after each failure
    const snapshot = this.sli.getSnapshot(300_000); // 5 min window
    this.safeMode.evaluateSLI(snapshot.successRate, meshName);
  }

  /**
   * Route a failed message to DLQ
   */
  deadLetter(msg: {
    from_agent: string;
    to_agent: string;
    type: string;
    payload: Record<string, unknown>;
    source_file?: string;
  }, reason: string, retryCount?: number): void {
    this.dlq.add({
      from_agent: msg.from_agent,
      to_agent: msg.to_agent,
      type: msg.type,
      payload: msg.payload,
      source_file: msg.source_file,
      failure_reason: reason,
      retry_count: retryCount,
    });
  }

  /**
   * Clean up for a mesh (call on mesh complete)
   */
  cleanupMesh(meshName: string): void {
    this.circuitBreaker.resetForMesh(meshName);
    this.heartbeat.clearForMesh(meshName);
  }

  // ============================================================
  // DLQ Replay API
  // ============================================================

  /**
   * Replay all pending DLQ entries via SystemMessageWriter.
   * Re-injects failed messages back into the live system.
   */
  replayDLQ(writer: SystemMessageWriter): ReplayResult[] {
    return this.dlq.replayAll(writer);
  }

  /**
   * Replay a single DLQ entry by ID.
   */
  replayDLQEntry(id: number, writer: SystemMessageWriter): ReplayResult {
    return this.dlq.replayOne(id, writer);
  }

  /**
   * Replay all DLQ entries for a specific agent.
   */
  replayDLQForAgent(agentId: string, writer: SystemMessageWriter): ReplayResult[] {
    return this.dlq.replayForAgent(agentId, writer);
  }

  // ============================================================
  // Status API (for CLI / monitoring)
  // ============================================================

  /**
   * Get comprehensive reliability status
   */
  getStatus(windowMs?: number): ReliabilityStatus {
    const cbStates = this.circuitBreaker.getAllStates();
    const circuitBreakers: Array<{ agentId: string; state: CircuitBreakerState; failures: number }> = [];
    for (const [agentId, info] of cbStates) {
      circuitBreakers.push({ agentId, ...info });
    }

    return {
      sli: this.sli.getSnapshot(windowMs),
      dlq: this.dlq.getStats(),
      safeMode: this.safeMode.getState(),
      circuitBreakers,
      agentHealth: this.heartbeat.checkAll(),
    };
  }

  /**
   * Write status to log file for monitoring
   */
  logStatus(): void {
    const status = this.getStatus(300_000); // 5 min window
    log.info('reliability', 'Status snapshot', {
      ninesLevel: status.sli.ninesLevel,
      successRate: status.sli.successRate,
      totalEvents: status.sli.totalEvents,
      dlqPending: status.dlq.pending,
      safeModeLevel: status.safeMode.level,
      openCircuits: status.circuitBreakers.filter(cb => cb.state === 'open').length,
    });
  }
}

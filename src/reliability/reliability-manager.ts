/**
 * ReliabilityManager - Central coordinator for all reliability features
 *
 * Provides a single integration point for the dispatcher to wire up:
 * - Dead letter queue (session-aware failure recovery)
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
 *   // On worker error (with session context for DLQ)
 *   this.reliability.recordFailure(meshName, agentId, 'crash', error.message, { sessionId, messagesSent });
 *   // On worker output (heartbeat)
 *   this.reliability.heartbeat(agentId);
 */

import type Database from 'better-sqlite3';
import { DeadLetterQueue, type DLQEntry, type DLQStats, type RecoveryMode, type RecoveryResult } from './dead-letter-queue.ts';
import { CircuitBreaker, type CircuitBreakerState } from './circuit-breaker.ts';
import { HeartbeatMonitor, type AgentHealth } from './heartbeat-monitor.ts';
import { SLITracker, type SLISnapshot, type FailureCategory } from './sli-tracker.ts';
import { SafeMode, type SafeModeLevel, type SafeModeState } from './safe-mode.ts';
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

/** Context captured at failure time for session-aware DLQ */
export interface FailureContext {
  sessionId?: string | null;
  messagesSent?: number;
  outputSnapshot?: string;
  sourceFile?: string;
  fromAgent?: string;
  toAgent?: string;
  msgType?: string;
  payload?: Record<string, unknown>;
}

/** Callback for session resume recovery */
export type SessionResumeHandler = (
  agentId: string,
  sessionId: string,
  meshName: string
) => Promise<{ success: boolean; error?: string }>;

/** Callback for message requeue recovery */
export type RequeueHandler = (entry: DLQEntry) => { success: boolean; error?: string };

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
   * Record failure with optional session context for DLQ routing.
   *
   * When failureCtx includes a sessionId, the DLQ entry is marked for
   * session_resume recovery (picks up exactly where the agent left off).
   * Without a sessionId, it falls back to message requeue.
   */
  recordFailure(
    meshName: string,
    agentId: string,
    category: FailureCategory,
    reason?: string,
    failureCtx?: FailureContext
  ): void {
    this.sli.recordFailure(meshName, agentId, category, reason);
    this.circuitBreaker.recordFailure(agentId, reason || category);
    this.heartbeat.unregister(agentId);

    // Auto-evaluate safe mode after each failure
    const snapshot = this.sli.getSnapshot(300_000); // 5 min window
    this.safeMode.evaluateSLI(snapshot.successRate, meshName);
  }

  /**
   * Route a failed operation to the DLQ with full session context.
   *
   * The DLQ auto-determines recovery mode:
   * - session_resume: sessionId present → can resume conversation
   * - requeue: no session → re-inject message into queue
   * - manual: retries exhausted → needs human intervention
   */
  deadLetter(
    meshName: string,
    agentId: string,
    category: FailureCategory,
    reason: string,
    ctx?: FailureContext
  ): void {
    this.dlq.add({
      agent_id: agentId,
      mesh_name: meshName,
      session_id: ctx?.sessionId || undefined,
      from_agent: ctx?.fromAgent || agentId,
      to_agent: ctx?.toAgent || agentId,
      type: ctx?.msgType || 'task',
      payload: ctx?.payload || {},
      source_file: ctx?.sourceFile,
      failure_reason: reason,
      failure_category: category,
      messages_sent: ctx?.messagesSent,
      output_snapshot: ctx?.outputSnapshot,
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
  // Session-Aware Recovery API
  // ============================================================

  /**
   * Recover all auto-recoverable DLQ entries.
   *
   * For session_resume entries: calls sessionResumeHandler to resume
   * the SDK session where it left off (preserves conversation history).
   *
   * For requeue entries: calls requeueHandler to re-inject the message
   * into the queue for fresh dispatch.
   */
  async recoverAll(
    sessionResumeHandler: SessionResumeHandler,
    requeueHandler: RequeueHandler
  ): Promise<RecoveryResult[]> {
    const entries = this.dlq.getRecoverable();
    const results: RecoveryResult[] = [];

    for (const entry of entries) {
      const result = await this.recoverEntry(entry, sessionResumeHandler, requeueHandler);
      results.push(result);
    }

    return results;
  }

  /**
   * Recover DLQ entries for a specific mesh.
   */
  async recoverForMesh(
    meshName: string,
    sessionResumeHandler: SessionResumeHandler,
    requeueHandler: RequeueHandler
  ): Promise<RecoveryResult[]> {
    const entries = this.dlq.getForMesh(meshName);
    const results: RecoveryResult[] = [];

    for (const entry of entries) {
      if (entry.recovery_mode === 'manual') continue;
      const result = await this.recoverEntry(entry, sessionResumeHandler, requeueHandler);
      results.push(result);
    }

    return results;
  }

  /**
   * Recover a single DLQ entry by ID.
   */
  async recoverById(
    id: number,
    sessionResumeHandler: SessionResumeHandler,
    requeueHandler: RequeueHandler
  ): Promise<RecoveryResult> {
    const entry = this.dlq.getById(id);
    if (!entry) {
      return { id, success: false, mode: 'manual', error: 'DLQ entry not found' };
    }
    return this.recoverEntry(entry, sessionResumeHandler, requeueHandler);
  }

  /**
   * Recover a single DLQ entry using the appropriate recovery mode.
   */
  private async recoverEntry(
    entry: DLQEntry,
    sessionResumeHandler: SessionResumeHandler,
    requeueHandler: RequeueHandler
  ): Promise<RecoveryResult> {
    if (entry.recovery_mode === 'session_resume' && entry.session_id) {
      // Resume the SDK session — preserves full conversation history
      try {
        const result = await sessionResumeHandler(entry.agent_id, entry.session_id, entry.mesh_name);
        if (result.success) {
          this.dlq.markRecovered(entry.id);
          log.info('reliability', 'DLQ entry recovered via session resume', {
            id: entry.id,
            agent: entry.agent_id,
            sessionId: entry.session_id.slice(0, 8),
          });
          return { id: entry.id, success: true, mode: 'session_resume', sessionId: entry.session_id };
        } else {
          // Session resume failed — escalate to manual
          this.dlq.escalateToManual(entry.id, result.error || 'Session resume failed');
          return { id: entry.id, success: false, mode: 'session_resume', error: result.error };
        }
      } catch (err) {
        this.dlq.escalateToManual(entry.id, (err as Error).message);
        return { id: entry.id, success: false, mode: 'session_resume', error: (err as Error).message };
      }
    } else if (entry.recovery_mode === 'requeue') {
      // Re-inject message into the queue
      const result = requeueHandler(entry);
      if (result.success) {
        this.dlq.markRecovered(entry.id);
        log.info('reliability', 'DLQ entry recovered via requeue', {
          id: entry.id,
          agent: entry.agent_id,
        });
        return { id: entry.id, success: true, mode: 'requeue' };
      } else {
        this.dlq.escalateToManual(entry.id, result.error || 'Requeue failed');
        return { id: entry.id, success: false, mode: 'requeue', error: result.error };
      }
    } else {
      return { id: entry.id, success: false, mode: 'manual', error: 'Requires manual intervention' };
    }
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

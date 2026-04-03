/**
 * ReliabilityManager - Central coordinator for all reliability features
 *
 * Provides a single integration point for the dispatcher:
 * - Dead letter queue (session-aware failure recovery)
 * - Circuit breakers (cascading failure prevention)
 * - Heartbeat monitoring (stalled worker detection + kill)
 * - SLI tracking (reliability measurement)
 * - Safe mode (gradual autonomy control via PreToolUse hooks)
 *
 * Usage in dispatcher.start():
 *   this.reliability = new ReliabilityManager(db, workDir);
 *   this.reliability.bindDispatcher({
 *     killAgent: (agentId, reason) => this.workerLifecycle.killForAgent(agentId, reason),
 *     requeueMessage: (from, to, type, payload) => this.systemWriter.write({...}),
 *     getActiveSessionId: (agentId) => worker?.runner.getSessionId(),
 *   });
 *   this.reliability.start();
 */

import type Database from 'better-sqlite3';
import { DeadLetterQueue, type DLQEntry, type DLQStats, type RecoveryMode, type RecoveryResult } from './dead-letter-queue.ts';
import { CircuitBreaker, type CircuitBreakerState } from './circuit-breaker.ts';
import { HeartbeatMonitor, type AgentHealth } from './heartbeat-monitor.ts';
import { SLITracker, type SLISnapshot, type FailureCategory } from './sli-tracker.ts';
import { SafeMode, type SafeModeLevel, type SafeModeState } from './safe-mode.ts';
import { CheckpointLog, type Checkpoint } from './checkpoint-log.ts';
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

/**
 * Dispatcher callbacks — these let the reliability manager
 * take real action (kill workers, requeue messages) without
 * importing the dispatcher directly.
 */
export interface DispatcherBindings {
  /** Kill all workers for an agent, returns count killed */
  killAgent: (agentId: string, reason: string) => number;
  /** Write a message into the queue (for requeue recovery) */
  requeueMessage: (from: string, to: string, payload: Record<string, unknown>, extraFrontmatter?: Record<string, string>) => void;
}

export class ReliabilityManager {
  readonly dlq: DeadLetterQueue;
  readonly circuitBreaker: CircuitBreaker;
  readonly heartbeat: HeartbeatMonitor;
  readonly sli: SLITracker;
  readonly safeMode: SafeMode;
  readonly checkpoints: CheckpointLog;
  private workDir: string;
  private bindings?: DispatcherBindings;

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
    this.checkpoints = new CheckpointLog(db);

    log.info('reliability', 'ReliabilityManager initialized', {
      dlqMaxRetries: merged.dlq?.maxRetries || 3,
      cbThreshold: merged.circuitBreaker?.failureThreshold || 3,
      safeModeDefault: merged.safeMode?.defaultLevel || 'normal',
      autoEscalate: merged.safeMode?.autoEscalate || false,
    });
  }

  /**
   * Bind dispatcher actions. Must be called before start().
   * This gives the reliability manager the ability to actually
   * kill stuck workers and requeue messages — not just observe.
   */
  bindDispatcher(bindings: DispatcherBindings): void {
    this.bindings = bindings;

    // Now that we can kill, wire the heartbeat dead callback
    this.heartbeat.on('stale', (health) => {
      log.warn('reliability', `Agent stale: ${health.agentId}`, {
        silenceMs: health.silenceMs,
      });
    });

    this.heartbeat.on('dead', (health) => {
      const meshName = health.agentId.split('/')[0];

      // Record failure (updates SLI, circuit breaker, safe mode)
      this.recordFailure(meshName, health.agentId, 'stuck',
        `No output for ${Math.round(health.silenceMs / 1000)}s`);

      // Kill the stuck worker — runner.kill() triggers wasGuardrailKill() → onGuardrailKill()
      // which handles DLQ capture via the unified convergence point
      const killed = this.bindings!.killAgent(health.agentId, `heartbeat dead: ${Math.round(health.silenceMs / 1000)}s silent`);
      log.warn('reliability', `Killed stuck agent`, {
        agentId: health.agentId,
        silenceMs: health.silenceMs,
        workersKilled: killed,
      });

      log.activity('reliability:heartbeat-kill', health.agentId,
        `Killed after ${Math.round(health.silenceMs / 1000)}s silence`);
    });

    log.info('reliability', 'Dispatcher bindings attached');
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
      log.warn('reliability', 'Spawn blocked: circuit breaker open', { meshName, agentId });
      return { allowed: false, reason: `Circuit breaker OPEN for ${agentId}` };
    }

    // Safe mode check
    const safeLevel = this.safeMode.getLevel(meshName);
    if (safeLevel === 'lockdown') {
      log.warn('reliability', 'Spawn blocked: safe mode lockdown', { meshName, agentId });
      return { allowed: false, reason: `Safe mode LOCKDOWN for mesh ${meshName}` };
    }

    return { allowed: true };
  }

  /**
   * Register agent for heartbeat monitoring (call on spawn)
   * Optional heartbeat config overrides global/runtime thresholds (from mesh config)
   */
  registerAgent(agentId: string, heartbeatConfig?: Partial<import('./heartbeat-monitor.ts').HeartbeatConfig>): void {
    this.heartbeat.register(agentId, heartbeatConfig);
  }

  /**
   * Unregister an agent from heartbeat monitoring (e.g. blocking HITL pause)
   */
  unregisterAgent(agentId: string): void {
    this.heartbeat.unregister(agentId);
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

    log.info('reliability', 'Agent completed successfully', {
      meshName, agentId, durationMs,
    });
  }

  /**
   * Record failure with optional session context for DLQ routing.
   */
  recordFailure(
    meshName: string,
    agentId: string,
    category: FailureCategory,
    reason?: string,
  ): void {
    this.sli.recordFailure(meshName, agentId, category, reason);
    this.circuitBreaker.recordFailure(agentId, reason || category);
    this.heartbeat.unregister(agentId);

    // Auto-evaluate safe mode after each failure
    const snapshot = this.sli.getSnapshot(300_000); // 5 min window
    const prevLevel = this.safeMode.getLevel(meshName);
    this.safeMode.evaluateSLI(snapshot.successRate, meshName);
    const newLevel = this.safeMode.getLevel(meshName);

    log.warn('reliability', 'Agent failure recorded', {
      meshName, agentId, category, reason,
      sliRate: snapshot.successRate,
      nines: snapshot.ninesLevel,
      safeMode: newLevel,
      safeModeEscalated: newLevel !== prevLevel ? `${prevLevel} → ${newLevel}` : undefined,
    });
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

    // Agent is dead — stop heartbeat monitoring to prevent ghost callbacks
    this.heartbeat.unregister(agentId);
  }

  /**
   * Create a PreToolUse hook that enforces safe mode tool restrictions.
   * Returns a hook object compatible with the dispatcher's chaos hooks.
   *
   * At 'restricted' level: blocks Write, Edit, NotebookEdit, Bash
   * At 'lockdown' level: blocks everything (spawn already blocked)
   * At 'cautious' level: allows all tools (restrictions are action-level)
   */
  createSafeModeHook(meshName: string, agentId: string): { matcher: string; hooks: Array<(input: unknown) => { decision: string; reason?: string }> } | null {
    const level = this.safeMode.getLevel(meshName);
    if (level === 'normal') return null;

    const state = this.safeMode.getState(meshName);
    const disabledTools = state.disabledTools;
    if (disabledTools.length === 0) return null;

    return {
      matcher: '*',  // Check all tools
      hooks: [(input: unknown) => {
        const toolInput = input as { tool_name?: string };
        const toolName = toolInput?.tool_name || '';

        if (disabledTools.includes(toolName)) {
          log.warn('safe-mode', `Blocked tool ${toolName}`, {
            agentId,
            meshName,
            level,
          });
          log.activity('safe-mode:blocked', agentId, `${toolName} blocked at ${level} level`);

          return {
            decision: 'block',
            reason: `Safe mode ${level}: ${toolName} is disabled. Current restrictions: ${disabledTools.join(', ')}`,
          };
        }
        return { decision: 'allow' };
      }],
    };
  }

  /**
   * Clean up for a mesh (call on mesh complete)
   */
  cleanupMesh(meshName: string): void {
    this.circuitBreaker.resetForMesh(meshName);
    this.heartbeat.clearForMesh(meshName);
  }

  // ============================================================
  // DLQ Recovery — triggered by CLI or front-matter message
  // ============================================================

  /**
   * Recover all auto-recoverable DLQ entries.
   *
   * For session_resume: writes a new message to the target agent
   * with session-id front-matter so the dispatcher spawns with resume.
   *
   * For requeue: re-injects the original message into the queue.
   *
   * Requires bindings — call bindDispatcher() first.
   */
  recoverAll(): RecoveryResult[] {
    if (!this.bindings) {
      log.error('reliability', 'Cannot recover: no dispatcher bindings');
      return [];
    }

    const entries = this.dlq.getRecoverable();
    if (entries.length === 0) return [];

    log.info('reliability', `Recovering ${entries.length} DLQ entries`);
    const results: RecoveryResult[] = [];

    for (const entry of entries) {
      results.push(this.recoverEntry(entry));
    }

    return results;
  }

  /**
   * Recover DLQ entries for a specific mesh.
   * If rewindTo is specified, override the session ID with the
   * checkpoint for that FSM state (instead of the crash-point session).
   */
  recoverForMesh(meshName: string, rewindTo?: string): RecoveryResult[] {
    if (!this.bindings) return [];

    // If rewind-to is specified, look up the checkpoint for that state
    let overrideSessionId: string | undefined;
    if (rewindTo) {
      const checkpoint = this.checkpoints.lookup(meshName, rewindTo);
      if (checkpoint) {
        overrideSessionId = checkpoint.session_id;
        log.info('reliability', `Rewind-to resolved`, {
          meshName,
          state: rewindTo,
          sessionId: checkpoint.session_id.slice(0, 8),
          agent: checkpoint.agent_id,
        });
      } else {
        log.warn('reliability', `No checkpoint found for rewind-to state`, {
          meshName, state: rewindTo,
          available: this.checkpoints.latestPerState(meshName).map(c => c.state_name),
        });
      }
    }

    const entries = this.dlq.getForMesh(meshName);
    const results: RecoveryResult[] = [];

    for (const entry of entries) {
      if (entry.recovery_mode === 'manual') continue;
      results.push(this.recoverEntry(entry, overrideSessionId));
    }

    return results;
  }

  /**
   * Recover a single DLQ entry by ID.
   */
  recoverById(id: number): RecoveryResult {
    if (!this.bindings) {
      return { id, success: false, mode: 'manual', error: 'No dispatcher bindings' };
    }

    const entry = this.dlq.getById(id);
    if (!entry) {
      return { id, success: false, mode: 'manual', error: 'DLQ entry not found' };
    }
    return this.recoverEntry(entry);
  }

  /**
   * Recover a single DLQ entry using the appropriate recovery mode.
   *
   * session_resume: Write a message to the agent with session-id in
   * front-matter. The dispatcher's existing session-id handling spawns
   * a new worker that resumes the SDK conversation.
   *
   * requeue: Re-inject the original message from→to with its payload.
   */
  /**
   * @param overrideSessionId - If set (from rewind-to), use this session
   *   instead of the DLQ entry's crash-point session.
   */
  private recoverEntry(entry: DLQEntry, overrideSessionId?: string): RecoveryResult {
    try {
      // Use override session (from rewind-to checkpoint) or the crash-point session
      const sessionId = overrideSessionId || entry.session_id;

      if ((entry.recovery_mode === 'session_resume' || overrideSessionId) && sessionId) {
        // Write a recovery message with session-id front-matter
        // The dispatcher already handles session-id: spawns worker resuming that session
        const isRewind = overrideSessionId && overrideSessionId !== entry.session_id;
        this.bindings!.requeueMessage(
          'system/dlq-recovery',
          entry.agent_id,
          {
            headline: isRewind
              ? `DLQ recovery: rewinding to checkpoint ${sessionId.slice(0, 8)}`
              : `DLQ recovery: resuming session ${sessionId.slice(0, 8)}`,
            body: isRewind
              ? `Rewinding past failure. Original failure: ${entry.failure_reason}`
              : `Resuming failed work. Original failure: ${entry.failure_reason}`,
            'resume-mesh': 'true',
          },
          { 'session-id': sessionId }
        );

        this.dlq.markRecovered(entry.id);
        log.info('reliability', `DLQ entry recovered via ${isRewind ? 'rewind' : 'session resume'}`, {
          id: entry.id,
          agent: entry.agent_id,
          sessionId: sessionId.slice(0, 8),
          rewind: isRewind || false,
        });
        log.activity('reliability:recovered', entry.agent_id,
          isRewind ? `Rewound to checkpoint (sid:${sessionId.slice(0, 8)})` : `Session resume (sid:${sessionId.slice(0, 8)})`);

        return { id: entry.id, success: true, mode: 'session_resume', sessionId };

      } else if (entry.recovery_mode === 'requeue') {
        // Re-inject the original message
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(entry.payload);
        } catch {
          payload = { body: entry.payload };
        }

        this.bindings!.requeueMessage(
          entry.from_agent,
          entry.to_agent,
          { ...payload, headline: payload.headline || `DLQ requeue: ${entry.failure_reason.slice(0, 50)}` },
        );

        this.dlq.markRecovered(entry.id);
        log.info('reliability', 'DLQ entry recovered via requeue', {
          id: entry.id,
          agent: entry.agent_id,
          from: entry.from_agent,
          to: entry.to_agent,
        });
        log.activity('reliability:recovered', entry.agent_id, 'Message requeued');

        return { id: entry.id, success: true, mode: 'requeue' };

      } else {
        return { id: entry.id, success: false, mode: 'manual', error: 'Requires manual intervention' };
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.dlq.escalateToManual(entry.id, msg);
      log.error('reliability', 'Recovery failed', { id: entry.id, error: msg });
      return { id: entry.id, success: false, mode: entry.recovery_mode, error: msg };
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

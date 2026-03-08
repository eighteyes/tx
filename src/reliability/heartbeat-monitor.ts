/**
 * HeartbeatMonitor - Detect stalled/hung workers
 *
 * Nine 3 pattern: Workers that stop producing output are likely stuck.
 * Monitor last output timestamps and escalate when stale.
 *
 * Stale detection levels:
 * 1. Warning (60s no output): Log, could be thinking
 * 2. Stale (120s no output): Inject nudge to worker
 * 3. Dead (300s no output): Kill worker, route to DLQ
 */

import { log } from '../shared/logger.ts';

export interface HeartbeatConfig {
  /** Warn threshold in ms (default: 60000 = 1 min) */
  warnMs: number;
  /** Stale threshold in ms (default: 120000 = 2 min) */
  staleMs: number;
  /** Dead threshold in ms (default: 300000 = 5 min) */
  deadMs: number;
  /** Check interval in ms (default: 15000 = 15s) */
  checkIntervalMs: number;
}

export type HealthStatus = 'healthy' | 'warn' | 'stale' | 'dead';

export interface AgentHealth {
  agentId: string;
  status: HealthStatus;
  lastOutputAt: number;
  silenceMs: number;
  startedAt: number;
}

const DEFAULT_CONFIG: HeartbeatConfig = {
  warnMs: 60_000,
  staleMs: 120_000,
  deadMs: 300_000,
  checkIntervalMs: 15_000,
};

type HeartbeatCallback = (health: AgentHealth) => void;

export class HeartbeatMonitor {
  private agents: Map<string, { lastOutputAt: number; startedAt: number }> = new Map();
  private config: HeartbeatConfig;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private onStale: HeartbeatCallback | null = null;
  private onDead: HeartbeatCallback | null = null;
  private onWarn: HeartbeatCallback | null = null;
  /** Track which agents have already been notified at each level to avoid spam */
  private notified: Map<string, HealthStatus> = new Map();

  constructor(config?: Partial<HeartbeatConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register callbacks for health state changes
   */
  on(event: 'warn' | 'stale' | 'dead', callback: HeartbeatCallback): void {
    switch (event) {
      case 'warn': this.onWarn = callback; break;
      case 'stale': this.onStale = callback; break;
      case 'dead': this.onDead = callback; break;
    }
  }

  /**
   * Register an agent for monitoring
   */
  register(agentId: string): void {
    const now = Date.now();
    this.agents.set(agentId, { lastOutputAt: now, startedAt: now });
    this.notified.delete(agentId);
  }

  /**
   * Record output from an agent (heartbeat)
   */
  heartbeat(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (entry) {
      entry.lastOutputAt = Date.now();
      // Reset notification level on activity
      this.notified.delete(agentId);
    }
  }

  /**
   * Unregister an agent (worker completed/killed)
   */
  unregister(agentId: string): void {
    this.agents.delete(agentId);
    this.notified.delete(agentId);
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAll();
    }, this.config.checkIntervalMs);

    log.debug('heartbeat', 'Monitor started', {
      checkIntervalMs: this.config.checkIntervalMs,
    });
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check health of all registered agents
   */
  checkAll(): AgentHealth[] {
    const now = Date.now();
    const results: AgentHealth[] = [];

    for (const [agentId, entry] of this.agents) {
      const silenceMs = now - entry.lastOutputAt;
      const health = this.classify(agentId, silenceMs, entry);
      results.push(health);

      // Fire callbacks only on state escalation (don't re-notify at same level)
      const prevLevel = this.notified.get(agentId);
      if (health.status !== 'healthy' && health.status !== prevLevel) {
        this.notified.set(agentId, health.status);
        this.fireCallback(health);
      }
    }

    return results;
  }

  /**
   * Get health for a specific agent
   */
  getHealth(agentId: string): AgentHealth | null {
    const entry = this.agents.get(agentId);
    if (!entry) return null;
    const silenceMs = Date.now() - entry.lastOutputAt;
    return this.classify(agentId, silenceMs, entry);
  }

  private classify(
    agentId: string,
    silenceMs: number,
    entry: { lastOutputAt: number; startedAt: number }
  ): AgentHealth {
    let status: HealthStatus = 'healthy';
    if (silenceMs >= this.config.deadMs) status = 'dead';
    else if (silenceMs >= this.config.staleMs) status = 'stale';
    else if (silenceMs >= this.config.warnMs) status = 'warn';

    return {
      agentId,
      status,
      lastOutputAt: entry.lastOutputAt,
      silenceMs,
      startedAt: entry.startedAt,
    };
  }

  private fireCallback(health: AgentHealth): void {
    switch (health.status) {
      case 'warn':
        log.warn('heartbeat', 'Agent quiet', {
          agentId: health.agentId,
          silenceMs: health.silenceMs,
        });
        this.onWarn?.(health);
        break;
      case 'stale':
        log.warn('heartbeat', 'Agent stale', {
          agentId: health.agentId,
          silenceMs: health.silenceMs,
        });
        this.onStale?.(health);
        break;
      case 'dead':
        log.error('heartbeat', 'Agent presumed dead', {
          agentId: health.agentId,
          silenceMs: health.silenceMs,
        });
        this.onDead?.(health);
        break;
    }
  }

  /**
   * Clear all monitoring state (mesh reset)
   */
  clear(): void {
    this.agents.clear();
    this.notified.clear();
  }

  /**
   * Clear monitoring for a specific mesh
   */
  clearForMesh(meshName: string): void {
    for (const agentId of this.agents.keys()) {
      if (agentId.startsWith(`${meshName}/`)) {
        this.agents.delete(agentId);
        this.notified.delete(agentId);
      }
    }
  }
}

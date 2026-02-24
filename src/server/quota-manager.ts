/**
 * QuotaManager - Quota enforcement and usage metering for tx-server
 *
 * Responsibilities:
 * - Enforce per-tenant quotas (sessions, messages, workers)
 * - Track usage metrics in real-time
 * - Provide usage reports for billing
 * - Emit quota events (warnings, exceeded)
 */

import { EventEmitter } from 'node:events';
import type { StorageProvider } from '../storage/index.ts';
import type { TenantQuotas } from './auth.ts';
import { log } from '../shared/logger.ts';

export interface UsageMetrics {
  tenantId: string;
  period: string;  // YYYY-MM-DD or YYYY-MM for monthly
  sessions: {
    created: number;
    active: number;
    peak: number;
  };
  messages: {
    sent: number;
    received: number;
    tokens: number;  // Approximate token usage
  };
  workers: {
    spawned: number;
    peakConcurrent: number;
    totalProcessingMs: number;
  };
  api: {
    requests: number;
    errors: number;
  };
}

export interface QuotaCheckResult {
  allowed: boolean;
  quotaType?: string;
  current?: number;
  limit?: number;
  message?: string;
}

export interface QuotaManagerConfig {
  storage: StorageProvider;
  persistInterval?: number;  // How often to persist metrics (ms)
}

export interface QuotaManagerEvents {
  'quota:warning': (data: { tenantId: string; quotaType: string; usage: number; limit: number }) => void;
  'quota:exceeded': (data: { tenantId: string; quotaType: string; usage: number; limit: number }) => void;
  'usage:updated': (metrics: UsageMetrics) => void;
}

export class QuotaManager extends EventEmitter {
  private storage: StorageProvider;
  private tenantQuotas: Map<string, TenantQuotas> = new Map();
  private usageCache: Map<string, UsageMetrics> = new Map();
  private persistInterval: number;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(config: QuotaManagerConfig) {
    super();
    this.storage = config.storage;
    this.persistInterval = config.persistInterval || 60000;  // 1 minute default
  }

  /**
   * Start the quota manager (begins persist loop)
   */
  start(): void {
    this.persistTimer = setInterval(() => this.persistUsage(), this.persistInterval);
    log.info('quota-manager', 'Started', { persistInterval: this.persistInterval });
  }

  /**
   * Stop the quota manager
   */
  async stop(): Promise<void> {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    // Final persist
    await this.persistUsage();
    log.info('quota-manager', 'Stopped');
  }

  /**
   * Set quotas for a tenant
   */
  setQuotas(tenantId: string, quotas: TenantQuotas): void {
    this.tenantQuotas.set(tenantId, quotas);
    log.debug('quota-manager', 'Quotas set', { tenantId, quotas });
  }

  /**
   * Get quotas for a tenant
   */
  getQuotas(tenantId: string): TenantQuotas | null {
    return this.tenantQuotas.get(tenantId) || null;
  }

  /**
   * Check if an action is allowed within quotas
   */
  checkQuota(tenantId: string, action: 'session' | 'message' | 'worker'): QuotaCheckResult {
    const quotas = this.tenantQuotas.get(tenantId);
    if (!quotas) {
      // No quotas set = unlimited (or use defaults)
      return { allowed: true };
    }

    const usage = this.getOrCreateUsage(tenantId);

    switch (action) {
      case 'session': {
        if (usage.sessions.active >= quotas.maxSessions) {
          this.emit('quota:exceeded', {
            tenantId,
            quotaType: 'sessions',
            usage: usage.sessions.active,
            limit: quotas.maxSessions,
          });
          return {
            allowed: false,
            quotaType: 'sessions',
            current: usage.sessions.active,
            limit: quotas.maxSessions,
            message: `Session limit exceeded: ${usage.sessions.active}/${quotas.maxSessions}`,
          };
        }
        // Warn at 80%
        if (usage.sessions.active >= quotas.maxSessions * 0.8) {
          this.emit('quota:warning', {
            tenantId,
            quotaType: 'sessions',
            usage: usage.sessions.active,
            limit: quotas.maxSessions,
          });
        }
        return { allowed: true };
      }

      case 'message': {
        // Check messages per minute (rolling window approximation)
        const messagesThisMinute = usage.messages.sent; // Simplified - would need rolling window
        if (messagesThisMinute >= quotas.maxMessagesPerMinute) {
          this.emit('quota:exceeded', {
            tenantId,
            quotaType: 'messages',
            usage: messagesThisMinute,
            limit: quotas.maxMessagesPerMinute,
          });
          return {
            allowed: false,
            quotaType: 'messages',
            current: messagesThisMinute,
            limit: quotas.maxMessagesPerMinute,
            message: `Message rate limit exceeded`,
          };
        }
        return { allowed: true };
      }

      case 'worker': {
        if (usage.workers.peakConcurrent >= quotas.maxConcurrentWorkers) {
          this.emit('quota:exceeded', {
            tenantId,
            quotaType: 'workers',
            usage: usage.workers.peakConcurrent,
            limit: quotas.maxConcurrentWorkers,
          });
          return {
            allowed: false,
            quotaType: 'workers',
            current: usage.workers.peakConcurrent,
            limit: quotas.maxConcurrentWorkers,
            message: `Concurrent worker limit exceeded`,
          };
        }
        return { allowed: true };
      }
    }
  }

  /**
   * Record session created
   */
  recordSessionCreated(tenantId: string): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.sessions.created++;
    usage.sessions.active++;
    usage.sessions.peak = Math.max(usage.sessions.peak, usage.sessions.active);
    this.emit('usage:updated', usage);
  }

  /**
   * Record session destroyed
   */
  recordSessionDestroyed(tenantId: string): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.sessions.active = Math.max(0, usage.sessions.active - 1);
    this.emit('usage:updated', usage);
  }

  /**
   * Record message sent
   */
  recordMessageSent(tenantId: string, estimatedTokens?: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.messages.sent++;
    if (estimatedTokens) {
      usage.messages.tokens += estimatedTokens;
    }
    this.emit('usage:updated', usage);
  }

  /**
   * Record message received (response)
   */
  recordMessageReceived(tenantId: string, estimatedTokens?: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.messages.received++;
    if (estimatedTokens) {
      usage.messages.tokens += estimatedTokens;
    }
    this.emit('usage:updated', usage);
  }

  /**
   * Record worker spawned
   */
  recordWorkerSpawned(tenantId: string, concurrentCount: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.workers.spawned++;
    usage.workers.peakConcurrent = Math.max(usage.workers.peakConcurrent, concurrentCount);
    this.emit('usage:updated', usage);
  }

  /**
   * Record worker completed
   */
  recordWorkerCompleted(tenantId: string, processingMs: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.workers.totalProcessingMs += processingMs;
    this.emit('usage:updated', usage);
  }

  /**
   * Record API request
   */
  recordApiRequest(tenantId: string, isError: boolean = false): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.api.requests++;
    if (isError) {
      usage.api.errors++;
    }
  }

  /**
   * Get usage metrics for a tenant
   */
  getUsage(tenantId: string): UsageMetrics | null {
    return this.usageCache.get(this.usageKey(tenantId)) || null;
  }

  /**
   * Get usage report for a tenant (for billing)
   */
  async getUsageReport(tenantId: string, period?: string): Promise<UsageMetrics | null> {
    const key = this.usageKey(tenantId, period);

    // Check cache first
    const cached = this.usageCache.get(key);
    if (cached) return cached;

    // In production, would load from persistent storage
    // For now, return current period only
    return this.getUsage(tenantId);
  }

  /**
   * Get or create usage metrics for current period
   */
  private getOrCreateUsage(tenantId: string): UsageMetrics {
    const key = this.usageKey(tenantId);
    let usage = this.usageCache.get(key);

    if (!usage) {
      usage = {
        tenantId,
        period: this.currentPeriod(),
        sessions: { created: 0, active: 0, peak: 0 },
        messages: { sent: 0, received: 0, tokens: 0 },
        workers: { spawned: 0, peakConcurrent: 0, totalProcessingMs: 0 },
        api: { requests: 0, errors: 0 },
      };
      this.usageCache.set(key, usage);
    }

    return usage;
  }

  /**
   * Generate usage key
   */
  private usageKey(tenantId: string, period?: string): string {
    return `${tenantId}:${period || this.currentPeriod()}`;
  }

  /**
   * Get current period (YYYY-MM-DD)
   */
  private currentPeriod(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Persist usage to storage (for billing/analytics)
   */
  private async persistUsage(): Promise<void> {
    // In production, this would write to Redis/database
    // For now, just log
    // Intentionally silent — usage is in-memory only for now.
    // When production persistence is added, log at info level on write.
  }

  /**
   * Reset usage for a tenant (e.g., at billing period start)
   */
  resetUsage(tenantId: string): void {
    const key = this.usageKey(tenantId);
    this.usageCache.delete(key);
    log.info('quota-manager', 'Usage reset', { tenantId });
  }
}

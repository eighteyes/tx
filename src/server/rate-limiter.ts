/**
 * RateLimiter - Token bucket rate limiting for tx-server
 *
 * Responsibilities:
 * - Per-tenant rate limiting
 * - Token bucket algorithm (smooth rate limiting)
 * - Support different limits per endpoint
 * - Track usage statistics
 */

import { log } from '../shared/logger.ts';

export interface RateLimitConfig {
  enabled: boolean;
  defaultLimit: number;  // Requests per minute
  defaultBurst: number;  // Max burst size
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;  // Seconds until next allowed request
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  limit: number;  // Tokens per minute
  burst: number;  // Max tokens
}

export class RateLimiter {
  private config: RateLimitConfig;
  private buckets: Map<string, TokenBucket> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Start the rate limiter (begins cleanup loop)
   */
  start(): void {
    // Clean up old buckets every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    log.info('rate-limiter', 'Started', {
      enabled: this.config.enabled,
      defaultLimit: this.config.defaultLimit,
    });
  }

  /**
   * Stop the rate limiter
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Check if a request is allowed
   */
  check(key: string, limit?: number, burst?: number): RateLimitResult {
    if (!this.config.enabled) {
      return { allowed: true, remaining: Infinity, resetAt: 0 };
    }

    const effectiveLimit = limit || this.config.defaultLimit;
    const effectiveBurst = burst || this.config.defaultBurst;

    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: effectiveBurst,
        lastRefill: Date.now(),
        limit: effectiveLimit,
        burst: effectiveBurst,
      };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on time elapsed
    this.refillBucket(bucket);

    // Check if we have tokens
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAt: bucket.lastRefill + 60000,  // 1 minute window
      };
    }

    // Calculate retry after
    const tokensNeeded = 1 - bucket.tokens;
    const refillRate = bucket.limit / 60;  // Tokens per second
    const retryAfter = Math.ceil(tokensNeeded / refillRate);

    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.lastRefill + 60000,
      retryAfter,
    };
  }

  /**
   * Consume tokens for a request (call after check passes)
   */
  consume(key: string, tokens: number = 1): void {
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.tokens = Math.max(0, bucket.tokens - tokens);
    }
  }

  /**
   * Get current limit status for a key
   */
  getStatus(key: string): { remaining: number; limit: number; resetAt: number } | null {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return null;
    }

    this.refillBucket(bucket);

    return {
      remaining: Math.floor(bucket.tokens),
      limit: bucket.burst,
      resetAt: bucket.lastRefill + 60000,
    };
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / 60000) * bucket.limit;  // Tokens earned since last refill

    bucket.tokens = Math.min(bucket.burst, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  /**
   * Clean up old buckets (ones not used in last 10 minutes)
   */
  private cleanup(): void {
    const now = Date.now();
    const expireTime = 10 * 60 * 1000;  // 10 minutes
    let cleaned = 0;

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > expireTime) {
        this.buckets.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug('rate-limiter', 'Cleaned up buckets', { cleaned, remaining: this.buckets.size });
    }
  }

  /**
   * Update limits for a key (e.g., when tenant tier changes)
   */
  updateLimits(key: string, limit: number, burst: number): void {
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.limit = limit;
      bucket.burst = burst;
    }
  }
}

/**
 * Create a rate limit key for a tenant + endpoint
 */
export function rateLimitKey(tenantId: string, endpoint?: string): string {
  if (endpoint) {
    return `${tenantId}:${endpoint}`;
  }
  return tenantId;
}

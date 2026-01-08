/**
 * Auth Middleware - API key authentication for tx-server
 *
 * Responsibilities:
 * - Validate API keys from Authorization header
 * - Extract tenant ID from API key
 * - Support multiple auth schemes (API key, JWT future)
 */

import type { IncomingMessage } from 'node:http';
import { log } from '../shared/logger.ts';

export interface AuthConfig {
  enabled: boolean;
  apiKeys?: Map<string, TenantInfo>;  // key -> tenant info
  jwtSecret?: string;  // For future JWT support
}

export interface TenantInfo {
  tenantId: string;
  name: string;
  tier: 'free' | 'pro' | 'enterprise';
  quotas: TenantQuotas;
}

export interface TenantQuotas {
  maxSessions: number;
  maxMessagesPerMinute: number;
  maxConcurrentWorkers: number;
}

export interface AuthResult {
  authenticated: boolean;
  tenantId?: string;
  tenant?: TenantInfo;
  error?: string;
}

const DEFAULT_QUOTAS: TenantQuotas = {
  maxSessions: 10,
  maxMessagesPerMinute: 60,
  maxConcurrentWorkers: 5,
};

/**
 * Default tenant for unauthenticated requests (when auth disabled)
 */
const DEFAULT_TENANT: TenantInfo = {
  tenantId: 'default',
  name: 'Default Tenant',
  tier: 'free',
  quotas: DEFAULT_QUOTAS,
};

export class AuthMiddleware {
  private config: AuthConfig;
  private apiKeys: Map<string, TenantInfo>;

  constructor(config: AuthConfig) {
    this.config = config;
    this.apiKeys = config.apiKeys || new Map();
  }

  /**
   * Add an API key for a tenant
   */
  addApiKey(apiKey: string, tenant: TenantInfo): void {
    this.apiKeys.set(apiKey, tenant);
    log.info('auth', 'API key added', { tenantId: tenant.tenantId });
  }

  /**
   * Remove an API key
   */
  removeApiKey(apiKey: string): void {
    this.apiKeys.delete(apiKey);
  }

  /**
   * Authenticate a request
   */
  authenticate(req: IncomingMessage): AuthResult {
    // If auth is disabled, return default tenant
    if (!this.config.enabled) {
      return {
        authenticated: true,
        tenantId: DEFAULT_TENANT.tenantId,
        tenant: DEFAULT_TENANT,
      };
    }

    // Extract API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return {
        authenticated: false,
        error: 'Missing Authorization header',
      };
    }

    // Support "Bearer <key>" or just "<key>"
    let apiKey: string;
    if (authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7);
    } else {
      apiKey = authHeader;
    }

    // Look up tenant
    const tenant = this.apiKeys.get(apiKey);
    if (!tenant) {
      log.warn('auth', 'Invalid API key attempted', { keyPrefix: apiKey.slice(0, 8) });
      return {
        authenticated: false,
        error: 'Invalid API key',
      };
    }

    return {
      authenticated: true,
      tenantId: tenant.tenantId,
      tenant,
    };
  }

  /**
   * Get tenant info by ID
   */
  getTenant(tenantId: string): TenantInfo | null {
    for (const tenant of this.apiKeys.values()) {
      if (tenant.tenantId === tenantId) {
        return tenant;
      }
    }
    return null;
  }

  /**
   * Load API keys from environment variable
   * Format: TX_API_KEYS="key1:tenant1:pro,key2:tenant2:free"
   */
  loadFromEnv(): void {
    const keysEnv = process.env.TX_API_KEYS;
    if (!keysEnv) return;

    const entries = keysEnv.split(',');
    for (const entry of entries) {
      const [key, tenantId, tier] = entry.split(':');
      if (key && tenantId) {
        this.addApiKey(key, {
          tenantId,
          name: tenantId,
          tier: (tier as 'free' | 'pro' | 'enterprise') || 'free',
          quotas: this.getQuotasForTier((tier as 'free' | 'pro' | 'enterprise') || 'free'),
        });
      }
    }

    log.info('auth', 'Loaded API keys from environment', { count: entries.length });
  }

  /**
   * Get default quotas for a tier
   */
  private getQuotasForTier(tier: 'free' | 'pro' | 'enterprise'): TenantQuotas {
    switch (tier) {
      case 'enterprise':
        return {
          maxSessions: 1000,
          maxMessagesPerMinute: 1000,
          maxConcurrentWorkers: 100,
        };
      case 'pro':
        return {
          maxSessions: 100,
          maxMessagesPerMinute: 300,
          maxConcurrentWorkers: 20,
        };
      case 'free':
      default:
        return DEFAULT_QUOTAS;
    }
  }
}

/**
 * Generate a random API key
 */
export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'tx_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

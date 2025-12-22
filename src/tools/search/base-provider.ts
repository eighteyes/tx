/**
 * Base Search Provider
 *
 * Abstract base class for all search providers. Provides common
 * functionality for health checks, caching, and result normalization.
 */

import { log } from '../../shared/logger.ts';

export interface SearchResult {
  title: string;
  url: string;
  content?: string;
  snippet?: string;
  engine: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  topic?: string;
  sort?: 'relevance' | 'date' | 'votes';
}

export interface ProviderHealth {
  healthy: boolean;
  lastCheck: number;
  error?: string;
  latencyMs?: number;
}

export abstract class BaseSearchProvider {
  public readonly name: string;
  public readonly description: string;
  public readonly aliases: string[];
  public readonly requiresAuth: boolean;

  protected baseUrl: string;
  protected health: ProviderHealth;
  protected readonly healthCacheTtlMs: number = 5 * 60 * 1000; // 5 minutes

  constructor(config: {
    name: string;
    description: string;
    aliases?: string[];
    baseUrl: string;
    requiresAuth?: boolean;
  }) {
    this.name = config.name;
    this.description = config.description;
    this.aliases = config.aliases || [];
    this.baseUrl = config.baseUrl;
    this.requiresAuth = config.requiresAuth || false;
    this.health = {
      healthy: true,
      lastCheck: 0
    };
  }

  /**
   * Perform search - must be implemented by subclasses
   */
  abstract search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    const health = await this.checkHealth();
    return health.healthy;
  }

  /**
   * Get cached health status or run fresh check
   */
  async checkHealth(forceRefresh = false): Promise<ProviderHealth> {
    const now = Date.now();
    const cacheExpired = now - this.health.lastCheck > this.healthCacheTtlMs;

    if (!forceRefresh && !cacheExpired && this.health.lastCheck > 0) {
      return this.health;
    }

    try {
      const startTime = Date.now();
      await this.healthCheck();
      const latencyMs = Date.now() - startTime;

      this.health = {
        healthy: true,
        lastCheck: now,
        latencyMs
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('search-provider', `Health check failed for ${this.name}`, { error: message });

      this.health = {
        healthy: false,
        lastCheck: now,
        error: message
      };
    }

    return this.health;
  }

  /**
   * Provider-specific health check - override in subclass if needed
   */
  protected async healthCheck(): Promise<void> {
    // Default: just check the base URL responds
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'HEAD',
        signal: controller.signal
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Make an HTTP request with timeout and error handling
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 10000
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'tx-cli/4.0 (search tool)',
          'Accept': 'application/json',
          ...options.headers
        }
      });

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Normalize and clean search results
   */
  protected normalizeResults(results: SearchResult[], limit = 10): SearchResult[] {
    return results
      .filter(r => r.title && r.url)
      .slice(0, limit)
      .map(r => ({
        ...r,
        engine: this.name,
        title: this.cleanText(r.title),
        content: r.content ? this.cleanText(r.content) : undefined,
        snippet: r.snippet ? this.cleanText(r.snippet) : undefined
      }));
  }

  /**
   * Clean up text content
   */
  protected cleanText(text: string): string {
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}

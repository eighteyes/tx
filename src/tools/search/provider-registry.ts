/**
 * Provider Registry
 *
 * Manages search provider registration, discovery, and health tracking.
 * Supports aliases and fallback chains.
 */

import { log } from '../../shared/logger.ts';
import { BaseSearchProvider, ProviderHealth } from './base-provider.ts';

export interface ProviderInfo {
  name: string;
  description: string;
  aliases: string[];
  available: boolean;
  requiresAuth: boolean;
  health?: ProviderHealth;
  reason?: string;
}

class ProviderRegistry {
  private providers: Map<string, BaseSearchProvider> = new Map();
  private aliases: Map<string, string> = new Map();

  /**
   * Register a provider
   */
  register(provider: BaseSearchProvider): void {
    this.providers.set(provider.name, provider);

    // Register aliases
    for (const alias of provider.aliases) {
      this.aliases.set(alias.toLowerCase(), provider.name);
    }

    log.debug('search-provider', `Registered provider: ${provider.name} (aliases: ${provider.aliases.join(', ') || 'none'})`);
  }

  /**
   * Get a provider by name or alias
   */
  get(nameOrAlias: string): BaseSearchProvider | undefined {
    const normalizedName = nameOrAlias.toLowerCase();

    // Try direct name first
    if (this.providers.has(normalizedName)) {
      return this.providers.get(normalizedName);
    }

    // Try alias
    const resolvedName = this.aliases.get(normalizedName);
    if (resolvedName) {
      return this.providers.get(resolvedName);
    }

    return undefined;
  }

  /**
   * Get all registered providers
   */
  getAll(): BaseSearchProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * List all providers with their status
   */
  async list(): Promise<ProviderInfo[]> {
    const results: ProviderInfo[] = [];

    for (const provider of this.providers.values()) {
      const health = await provider.checkHealth();

      results.push({
        name: provider.name,
        description: provider.description,
        aliases: provider.aliases,
        available: health.healthy,
        requiresAuth: provider.requiresAuth,
        health,
        reason: health.healthy ? undefined : health.error
      });
    }

    return results;
  }

  /**
   * Check health of all providers (or specific one)
   */
  async healthCheck(providerName?: string): Promise<Record<string, ProviderHealth>> {
    const results: Record<string, ProviderHealth> = {};

    if (providerName) {
      const provider = this.get(providerName);
      if (provider) {
        results[provider.name] = await provider.checkHealth(true);
      } else {
        results[providerName] = {
          healthy: false,
          lastCheck: Date.now(),
          error: `Provider not found: ${providerName}`
        };
      }
    } else {
      // Check all providers
      for (const provider of this.providers.values()) {
        results[provider.name] = await provider.checkHealth(true);
      }
    }

    return results;
  }

  /**
   * Get available providers (healthy ones only)
   */
  async getAvailable(): Promise<BaseSearchProvider[]> {
    const available: BaseSearchProvider[] = [];

    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) {
        available.push(provider);
      }
    }

    return available;
  }

  /**
   * Get provider names for a topic
   * Returns providers relevant to a topic in order of preference
   */
  getProvidersForTopic(topic: string): string[] {
    const topicProviders: Record<string, string[]> = {
      'code': ['stackoverflow', 'github', 'devto'],
      'programming': ['stackoverflow', 'github', 'devto'],
      'research': ['arxiv', 'semanticscholar', 'crossref', 'pubmed', 'wikipedia'],
      'papers': ['arxiv', 'semanticscholar', 'crossref'],
      'science': ['arxiv', 'pubmed', 'semanticscholar', 'wikipedia'],
      'medical': ['pubmed', 'semanticscholar', 'crossref'],
      'academic': ['semanticscholar', 'arxiv', 'crossref', 'pubmed'],
      'news': ['hackernews', 'brave'],
      'tech': ['hackernews', 'github', 'devto'],
      'general': ['brave', 'wikipedia', 'duckduckgo'],
      'reference': ['wikipedia', 'duckduckgo'],
      'video': ['youtube'],
      'media': ['youtube'],
      'developer': ['devto', 'stackoverflow', 'github', 'hackernews']
    };

    const normalizedTopic = topic.toLowerCase();
    return topicProviders[normalizedTopic] || ['stackoverflow', 'github', 'hackernews', 'wikipedia'];
  }

  /**
   * Clear registry (for testing)
   */
  clear(): void {
    this.providers.clear();
    this.aliases.clear();
  }
}

// Singleton instance
export const registry = new ProviderRegistry();

// Convenience exports
export function registerProvider(provider: BaseSearchProvider): void {
  registry.register(provider);
}

export function getProvider(name: string): BaseSearchProvider | undefined {
  return registry.get(name);
}

export function getAllProviders(): BaseSearchProvider[] {
  return registry.getAll();
}

export async function listProviders(): Promise<ProviderInfo[]> {
  return registry.list();
}

export async function checkHealth(providerName?: string): Promise<Record<string, ProviderHealth>> {
  return registry.healthCheck(providerName);
}

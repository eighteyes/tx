/**
 * Search and Web Fetching Tools
 *
 * Provides search across multiple providers and URL fetching with archive fallback.
 */

// Re-export main search functionality
export { search, searchSource, getAvailableProviders, initializeProviders } from './search.ts';

// Re-export URL fetching
export { fetchUrl, fetchUrls } from './get-www.ts';
export type { FetchResult, FetchOptions } from './get-www.ts';

// Re-export registry functions
export { checkHealth as checkHealthRaw, registerProvider, getProvider } from './provider-registry.ts';
export { listProviders as listProvidersRaw } from './provider-registry.ts';
export type { ProviderInfo } from './provider-registry.ts';

// Import initializeProviders to wrap functions
import { initializeProviders } from './search.ts';
import { listProviders as listProvidersFromRegistry } from './provider-registry.ts';
import type { ProviderInfo } from './provider-registry.ts';

/**
 * List providers (ensures they're initialized first)
 */
export async function listProviders(): Promise<ProviderInfo[]> {
  initializeProviders();
  return listProvidersFromRegistry();
}

// Re-export base types
export { BaseSearchProvider } from './base-provider.ts';
export type { SearchResult, SearchOptions, ProviderHealth } from './base-provider.ts';

// Re-export providers for direct use
export { StackOverflowProvider } from './providers/stackoverflow.ts';
export { GitHubProvider } from './providers/github.ts';
export { HackerNewsProvider } from './providers/hackernews.ts';
export { ArxivProvider } from './providers/arxiv.ts';
export { WikipediaProvider } from './providers/wikipedia.ts';
export { YouTubeProvider } from './providers/youtube.ts';
export { BraveProvider } from './providers/brave.ts';
export { DuckDuckGoProvider } from './providers/duckduckgo.ts';
export { PubMedProvider } from './providers/pubmed.ts';
export { SemanticScholarProvider } from './providers/semanticscholar.ts';
export { CrossRefProvider } from './providers/crossref.ts';
export { DevToProvider } from './providers/devto.ts';

// Legacy compatibility types (matching old stub interface)
export interface Provider {
  name: string;
  description: string;
  available: boolean;
  requiresAuth: boolean;
  reason?: string;
}

export interface HealthResult {
  healthy: boolean;
  error?: string;
}

import { checkHealth as checkHealthFromRegistry } from './provider-registry.ts';

/**
 * Health check wrapper (ensures providers are initialized)
 */
export async function healthCheck(provider?: string): Promise<Record<string, HealthResult>> {
  initializeProviders();
  const results = await checkHealthFromRegistry(provider);

  // Convert to legacy format
  const legacy: Record<string, HealthResult> = {};
  for (const [name, health] of Object.entries(results)) {
    legacy[name] = {
      healthy: health.healthy,
      error: health.error
    };
  }
  return legacy;
}

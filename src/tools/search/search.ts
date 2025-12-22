/**
 * Search Orchestrator
 *
 * Main entry point for searches. Handles provider selection, fallback chains,
 * and result aggregation.
 */

import { log } from '../../shared/logger.ts';
import { SearchResult, SearchOptions } from './base-provider.ts';
import { registry, getProvider } from './provider-registry.ts';

// Import and register all providers
import { StackOverflowProvider } from './providers/stackoverflow.ts';
import { GitHubProvider } from './providers/github.ts';
import { HackerNewsProvider } from './providers/hackernews.ts';
import { ArxivProvider } from './providers/arxiv.ts';
import { WikipediaProvider } from './providers/wikipedia.ts';
import { YouTubeProvider } from './providers/youtube.ts';
import { BraveProvider } from './providers/brave.ts';
import { DuckDuckGoProvider } from './providers/duckduckgo.ts';
import { PubMedProvider } from './providers/pubmed.ts';
import { SemanticScholarProvider } from './providers/semanticscholar.ts';
import { CrossRefProvider } from './providers/crossref.ts';
import { DevToProvider } from './providers/devto.ts';

// Register providers on module load
let initialized = false;

function initializeProviders(): void {
  if (initialized) return;

  // Core providers (always available, no auth needed)
  registry.register(new StackOverflowProvider());
  registry.register(new GitHubProvider());
  registry.register(new HackerNewsProvider());
  registry.register(new ArxivProvider());
  registry.register(new WikipediaProvider());

  // Free providers (no auth needed)
  registry.register(new DuckDuckGoProvider());
  registry.register(new DevToProvider());

  // Academic providers (free, no auth needed)
  registry.register(new PubMedProvider());
  registry.register(new SemanticScholarProvider());
  registry.register(new CrossRefProvider());

  // Providers requiring API keys
  registry.register(new YouTubeProvider());
  registry.register(new BraveProvider());

  initialized = true;
  log.debug('search-provider', 'Search providers initialized');
}

export interface SearchConfig extends SearchOptions {
  source?: string;
  sources?: string[];
  fallback?: boolean;
}

/**
 * Perform a search across one or more providers
 */
export async function search(query: string, config: SearchConfig = {}): Promise<SearchResult[]> {
  initializeProviders();

  const { source, sources, fallback = true, limit = 10, topic, sort } = config;

  // Determine which providers to use
  let providerNames: string[];

  if (source) {
    // Single specific source
    providerNames = [source];
  } else if (sources && sources.length > 0) {
    // Multiple specific sources
    providerNames = sources;
  } else if (topic) {
    // Get providers for topic
    providerNames = registry.getProvidersForTopic(topic);
  } else {
    // Default: use all providers
    providerNames = registry.getAll().map(p => p.name);
  }

  log.debug('search-provider', `Searching with providers: ${providerNames.join(', ')}`);

  // Try each provider
  const allResults: SearchResult[] = [];
  let lastError: Error | null = null;

  for (const name of providerNames) {
    const provider = getProvider(name);
    if (!provider) {
      log.warn('search-provider', `Unknown provider: ${name}`);
      continue;
    }

    try {
      const results = await provider.search(query, { limit, sort });

      if (results.length > 0) {
        allResults.push(...results);
        log.info('search-provider', `${provider.name}: Found ${results.length} results`);

        // If not in fallback mode, stop after first successful provider
        if (!fallback && !sources) {
          break;
        }
      } else {
        log.debug('search-provider', `${provider.name}: No results`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn('search-provider', `${provider.name} search failed`, { error: lastError.message });

      // Continue to next provider if fallback is enabled
      if (!fallback) {
        throw lastError;
      }
    }
  }

  // If all providers failed, throw the last error
  if (allResults.length === 0 && lastError) {
    throw lastError;
  }

  // Deduplicate results by URL
  const seen = new Set<string>();
  const uniqueResults = allResults.filter(result => {
    const key = result.url.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // Sort by score if multiple sources
  if (sources && sources.length > 1) {
    uniqueResults.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  return uniqueResults.slice(0, limit);
}

/**
 * Search a specific source
 */
export async function searchSource(
  source: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  initializeProviders();

  const provider = getProvider(source);
  if (!provider) {
    throw new Error(`Unknown provider: ${source}`);
  }

  return provider.search(query, options);
}

/**
 * Get available provider names
 */
export function getAvailableProviders(): string[] {
  initializeProviders();
  return registry.getAll().map(p => p.name);
}

// Re-export for convenience
export { initializeProviders };

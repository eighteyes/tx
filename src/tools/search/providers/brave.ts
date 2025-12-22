/**
 * Brave Search Provider
 *
 * Uses the Brave Search API for web search results.
 * Requires BRAVE_API_KEY environment variable.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface BraveWebResult {
  url: string;
  title: string;
  description: string;
  age?: string;
  language?: string;
  family_friendly?: boolean;
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
  query?: {
    original: string;
    show_strict_warning?: boolean;
  };
}

export class BraveProvider extends BaseSearchProvider {
  private apiKey?: string;

  constructor() {
    super({
      name: 'brave',
      description: 'Brave Search - Modern, privacy-focused web search',
      aliases: [],
      baseUrl: 'https://api.search.brave.com/res/v1/web/search',
      requiresAuth: true
    });
    this.apiKey = process.env.BRAVE_API_KEY;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10 } = options;

    if (!this.apiKey) {
      log.warn('search-provider', 'Brave search requires BRAVE_API_KEY environment variable');
      return [];
    }

    // Build API URL
    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(limit, 20))
    });

    const url = `${this.baseUrl}?${params}`;
    log.debug('search-provider', `Brave search: ${url}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': this.apiKey
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid or expired API key');
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as BraveSearchResponse;

      if (!data.web?.results) {
        return [];
      }

      const results = data.web.results.map(item => this.mapResult(item));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'Brave search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(item: BraveWebResult): SearchResult {
    return {
      title: item.title,
      url: item.url,
      snippet: item.description || '',
      content: this.formatContent(item),
      engine: this.name,
      metadata: {
        age: item.age,
        language: item.language
      }
    };
  }

  /**
   * Format result content for display
   */
  private formatContent(item: BraveWebResult): string {
    const lines: string[] = [
      `# ${item.title}`,
      '',
      item.description || '*No description available*',
      ''
    ];

    if (item.age) {
      lines.push(`**Age**: ${item.age}`);
    }

    lines.push('');
    lines.push(`[View page](${item.url})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('BRAVE_API_KEY not configured');
    }

    const params = new URLSearchParams({
      q: 'test',
      count: '1'
    });

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}?${params}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': this.apiKey
        }
      },
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

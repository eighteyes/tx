/**
 * DuckDuckGo Search Provider
 *
 * Uses the DuckDuckGo Instant Answer API.
 * Free, no API key required.
 * Note: This API returns instant answers/related topics, not full web search results.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface DuckDuckGoResult {
  FirstURL: string;
  Text: string;
  Result?: string;
  Icon?: {
    URL: string;
    Height: number;
    Width: number;
  };
}

interface DuckDuckGoResponse {
  Abstract: string;
  AbstractText: string;
  AbstractSource: string;
  AbstractURL: string;
  Image: string;
  Heading: string;
  Answer: string;
  AnswerType: string;
  Results: DuckDuckGoResult[];
  RelatedTopics: DuckDuckGoResult[];
  Type: string;
}

export class DuckDuckGoProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'duckduckgo',
      description: 'DuckDuckGo - Privacy-focused instant answers',
      aliases: ['ddg'],
      baseUrl: 'https://api.duckduckgo.com',
      requiresAuth: false
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10 } = options;

    // Build API URL
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_redirect: '1',
      no_html: '1'
    });

    const url = `${this.baseUrl}/?${params}`;
    log.debug('search-provider', `DuckDuckGo search: ${url}`);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as DuckDuckGoResponse;
      const results: SearchResult[] = [];

      // Add main abstract if present
      if (data.AbstractURL && data.AbstractText) {
        results.push({
          title: data.Heading || query,
          url: data.AbstractURL,
          snippet: data.AbstractText,
          content: this.formatAbstract(data),
          engine: this.name,
          score: 100, // Primary result gets highest score
          metadata: {
            source: data.AbstractSource,
            type: 'abstract'
          }
        });
      }

      // Add direct results
      if (data.Results && Array.isArray(data.Results)) {
        for (const result of data.Results) {
          if (result.FirstURL && result.Text && results.length < limit) {
            results.push({
              title: result.Text,
              url: result.FirstURL,
              snippet: result.Text,
              engine: this.name,
              metadata: {
                type: 'result'
              }
            });
          }
        }
      }

      // Add related topics
      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (topic.FirstURL && results.length < limit) {
            results.push({
              title: topic.Text || 'Related topic',
              url: topic.FirstURL,
              snippet: topic.Text || '',
              engine: this.name,
              metadata: {
                type: 'related'
              }
            });
          }
        }
      }

      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'DuckDuckGo search failed', { error: message });
      throw error;
    }
  }

  /**
   * Format abstract content for display
   */
  private formatAbstract(data: DuckDuckGoResponse): string {
    const lines: string[] = [
      `# ${data.Heading || 'DuckDuckGo Result'}`,
      '',
      data.AbstractText || '*No description available*',
      ''
    ];

    if (data.AbstractSource) {
      lines.push(`**Source**: ${data.AbstractSource}`);
    }

    if (data.Answer) {
      lines.push('');
      lines.push(`**Instant Answer**: ${data.Answer}`);
    }

    lines.push('');
    lines.push(`[Learn more](${data.AbstractURL})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    const params = new URLSearchParams({
      q: 'test',
      format: 'json',
      no_redirect: '1'
    });

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/?${params}`,
      {},
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

/**
 * CrossRef Search Provider
 *
 * Uses the CrossRef API to search DOI metadata.
 * Free, no API key required.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface CrossRefWork {
  DOI: string;
  URL: string;
  title: string[];
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
  }>;
  published?: {
    'date-parts': number[][];
  };
  'container-title'?: string[];
  type?: string;
  abstract?: string;
  'is-referenced-by-count'?: number;
}

interface CrossRefResponse {
  status: string;
  'message-type': string;
  message: {
    items: CrossRefWork[];
    'total-results': number;
  };
}

export class CrossRefProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'crossref',
      description: 'CrossRef - DOI database and scholarly metadata',
      aliases: ['doi'],
      baseUrl: 'https://api.crossref.org',
      requiresAuth: false
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, sort = 'relevance' } = options;

    // Build API URL
    const params = new URLSearchParams({
      query,
      rows: String(Math.min(limit, 100)),
      sort: this.mapSort(sort)
    });

    const url = `${this.baseUrl}/works?${params}`;
    log.debug('search-provider', `CrossRef search: ${url}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'tx-cli/4.0 (https://github.com/tx-cli; mailto:search@tx-cli.dev)'
        }
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as CrossRefResponse;

      if (!data.message?.items?.length) {
        return [];
      }

      const results = data.message.items.map(item => this.mapResult(item));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'CrossRef search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map sort option to API parameter
   */
  private mapSort(sort: string): string {
    switch (sort) {
      case 'date':
        return 'published';
      case 'votes':
        return 'is-referenced-by-count';
      case 'relevance':
      default:
        return 'relevance';
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(item: CrossRefWork): SearchResult {
    const title = item.title?.[0] || 'CrossRef Item';
    const url = item.URL || `https://doi.org/${item.DOI}`;
    const authors = this.formatAuthors(item.author);
    const published = this.formatDate(item.published);

    return {
      title,
      url,
      snippet: `${authors} - DOI: ${item.DOI}${published ? ` (${published})` : ''}`,
      content: this.formatContent(item),
      engine: this.name,
      score: item['is-referenced-by-count'] || 0,
      metadata: {
        doi: item.DOI,
        type: item.type,
        journal: item['container-title']?.[0],
        citationCount: item['is-referenced-by-count'],
        published
      }
    };
  }

  /**
   * Format author list
   */
  private formatAuthors(authors?: CrossRefWork['author']): string {
    if (!authors?.length) return 'Unknown authors';

    return authors
      .slice(0, 3)
      .map(a => {
        if (a.name) return a.name;
        if (a.family && a.given) return `${a.given} ${a.family}`;
        return a.family || 'Unknown';
      })
      .join(', ');
  }

  /**
   * Format publication date
   */
  private formatDate(published?: CrossRefWork['published']): string {
    const dateParts = published?.['date-parts']?.[0];
    if (!dateParts?.length) return '';

    if (dateParts.length === 1) return String(dateParts[0]);
    if (dateParts.length === 2) return `${dateParts[1]}/${dateParts[0]}`;
    return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
  }

  /**
   * Format work content for display
   */
  private formatContent(item: CrossRefWork): string {
    const lines: string[] = [
      `# ${item.title?.[0] || 'CrossRef Item'}`,
      ''
    ];

    if (item.abstract) {
      lines.push(item.abstract.substring(0, 500));
      lines.push('');
    }

    const authors = this.formatAuthors(item.author);
    lines.push(`**Authors**: ${authors}`);
    lines.push(`**DOI**: ${item.DOI}`);

    if (item['container-title']?.length) {
      lines.push(`**Journal**: ${item['container-title'][0]}`);
    }

    if (item.type) {
      lines.push(`**Type**: ${item.type}`);
    }

    const published = this.formatDate(item.published);
    if (published) {
      lines.push(`**Published**: ${published}`);
    }

    if (item['is-referenced-by-count'] !== undefined) {
      lines.push(`**Citations**: ${item['is-referenced-by-count'].toLocaleString()}`);
    }

    lines.push('');
    lines.push(`[View on CrossRef](${item.URL || `https://doi.org/${item.DOI}`})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    const params = new URLSearchParams({
      query: 'test',
      rows: '1'
    });

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/works?${params}`,
      {
        headers: {
          'User-Agent': 'tx-cli/4.0 (https://github.com/tx-cli; mailto:search@tx-cli.dev)'
        }
      },
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

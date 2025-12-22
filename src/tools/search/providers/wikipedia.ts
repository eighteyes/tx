/**
 * Wikipedia Search Provider
 *
 * Uses the Wikipedia API to search for articles.
 * No API key required.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface WikiSearchResult {
  pageid: number;
  title: string;
  snippet: string;
  size: number;
  wordcount: number;
  timestamp: string;
}

interface WikiSearchResponse {
  query: {
    searchinfo: {
      totalhits: number;
    };
    search: WikiSearchResult[];
  };
}

interface WikiPageResponse {
  query: {
    pages: Record<string, {
      pageid: number;
      title: string;
      extract: string;
      fullurl: string;
      description?: string;
      categories?: Array<{ title: string }>;
    }>;
  };
}

export class WikipediaProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'wikipedia',
      description: 'Wikipedia - Encyclopedia articles',
      aliases: ['wiki', 'w'],
      baseUrl: 'https://en.wikipedia.org/w/api.php'
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10 } = options;

    // Step 1: Search for matching articles
    const searchParams = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: String(Math.min(limit, 50)),
      srprop: 'snippet|size|wordcount|timestamp',
      format: 'json',
      origin: '*'
    });

    const searchUrl = `${this.baseUrl}?${searchParams}`;
    log.debug('search-provider', `Wikipedia search: ${searchUrl}`);

    try {
      const searchResponse = await this.fetchWithTimeout(searchUrl);

      if (!searchResponse.ok) {
        throw new Error(`API error: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json() as WikiSearchResponse;
      const searchResults = searchData.query?.search || [];

      if (searchResults.length === 0) {
        return [];
      }

      // Step 2: Get extracts for the found pages
      const pageIds = searchResults.map(r => r.pageid).join('|');
      const extractParams = new URLSearchParams({
        action: 'query',
        pageids: pageIds,
        prop: 'extracts|info|categories',
        exintro: 'true',
        explaintext: 'true',
        exsentences: '5',
        inprop: 'url',
        cllimit: '5',
        format: 'json',
        origin: '*'
      });

      const extractUrl = `${this.baseUrl}?${extractParams}`;
      const extractResponse = await this.fetchWithTimeout(extractUrl);

      if (!extractResponse.ok) {
        // Fall back to search results without extracts
        return this.normalizeResults(
          searchResults.map(item => this.mapSearchResult(item)),
          limit
        );
      }

      const extractData = await extractResponse.json() as WikiPageResponse;
      const pages = extractData.query?.pages || {};

      // Merge search results with extracts
      const results = searchResults.map(searchItem => {
        const page = pages[String(searchItem.pageid)];
        return this.mapResult(searchItem, page);
      });

      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'Wikipedia search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map search result (without extract) to SearchResult
   */
  private mapSearchResult(item: WikiSearchResult): SearchResult {
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;

    return {
      title: item.title,
      url: url,
      snippet: this.cleanText(item.snippet),
      content: this.formatBasicContent(item, url),
      engine: this.name,
      metadata: {
        pageId: item.pageid,
        size: item.size,
        wordCount: item.wordcount,
        timestamp: item.timestamp
      }
    };
  }

  /**
   * Map search result with page details to SearchResult
   */
  private mapResult(searchItem: WikiSearchResult, page?: WikiPageResponse['query']['pages'][string]): SearchResult {
    const url = page?.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(searchItem.title.replace(/ /g, '_'))}`;
    const extract = page?.extract || this.cleanText(searchItem.snippet);

    return {
      title: searchItem.title,
      url: url,
      snippet: extract.substring(0, 300) + (extract.length > 300 ? '...' : ''),
      content: this.formatContent(searchItem, page),
      engine: this.name,
      metadata: {
        pageId: searchItem.pageid,
        size: searchItem.size,
        wordCount: searchItem.wordcount,
        timestamp: searchItem.timestamp,
        categories: page?.categories?.map(c => c.title.replace('Category:', ''))
      }
    };
  }

  /**
   * Format basic content (without extract)
   */
  private formatBasicContent(item: WikiSearchResult, url: string): string {
    const lines: string[] = [
      `# ${item.title}`,
      '',
      this.cleanText(item.snippet),
      '',
      `**Word count**: ${item.wordcount.toLocaleString()}`,
      `**Last updated**: ${new Date(item.timestamp).toLocaleDateString()}`,
      '',
      `[Read on Wikipedia](${url})`
    ];

    return lines.join('\n');
  }

  /**
   * Format full content with extract
   */
  private formatContent(searchItem: WikiSearchResult, page?: WikiPageResponse['query']['pages'][string]): string {
    const url = page?.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(searchItem.title.replace(/ /g, '_'))}`;

    const lines: string[] = [
      `# ${searchItem.title}`,
      ''
    ];

    if (page?.extract) {
      lines.push(page.extract);
      lines.push('');
    } else {
      lines.push(this.cleanText(searchItem.snippet));
      lines.push('');
    }

    lines.push(`**Word count**: ${searchItem.wordcount.toLocaleString()}`);
    lines.push(`**Last updated**: ${new Date(searchItem.timestamp).toLocaleDateString()}`);

    if (page?.categories && page.categories.length > 0) {
      const cats = page.categories.map(c => c.title.replace('Category:', '')).slice(0, 5);
      lines.push(`**Categories**: ${cats.join(', ')}`);
    }

    lines.push('');
    lines.push(`[Read full article on Wikipedia](${url})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    // Check API availability with a simple query
    const params = new URLSearchParams({
      action: 'query',
      meta: 'siteinfo',
      format: 'json',
      origin: '*'
    });

    const url = `${this.baseUrl}?${params}`;
    const response = await this.fetchWithTimeout(url, {}, 5000);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

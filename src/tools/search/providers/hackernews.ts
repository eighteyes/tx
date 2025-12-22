/**
 * Hacker News Search Provider
 *
 * Uses the Algolia HN Search API to search Hacker News stories, comments, and polls.
 * No API key required.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface HNHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string;
  points: number | null;
  story_text: string | null;
  comment_text: string | null;
  num_comments: number | null;
  created_at: string;
  created_at_i: number;
  _tags: string[];
  _highlightResult?: {
    title?: { value: string };
    story_text?: { value: string };
  };
}

interface HNSearchResponse {
  hits: HNHit[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  processingTimeMS: number;
}

export class HackerNewsProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'hackernews',
      description: 'Hacker News - Tech news and discussions',
      aliases: ['hn', 'hacker'],
      baseUrl: 'https://hn.algolia.com/api/v1'
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, sort = 'relevance' } = options;

    // Build API URL
    const endpoint = sort === 'date' ? 'search_by_date' : 'search';
    const params = new URLSearchParams({
      query: query,
      tags: 'story', // Only search stories (not comments)
      hitsPerPage: String(Math.min(limit, 50))
    });

    const url = `${this.baseUrl}/${endpoint}?${params}`;
    log.debug('search-provider', `HackerNews search: ${url}`);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as HNSearchResponse;
      const results = data.hits.map(item => this.mapResult(item));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'HackerNews search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(item: HNHit): SearchResult {
    // HN items may not have a URL (Ask HN, Show HN, etc.)
    const hnUrl = `https://news.ycombinator.com/item?id=${item.objectID}`;
    const url = item.url || hnUrl;
    const title = item.title || 'Untitled';

    const snippet = item.story_text
      ? this.cleanText(item.story_text.substring(0, 300))
      : item.url
        ? `Link: ${item.url}`
        : 'No description available';

    return {
      title: title,
      url: url,
      snippet: snippet,
      content: this.formatContent(item),
      engine: this.name,
      score: item.points || 0,
      metadata: {
        hnId: item.objectID,
        points: item.points,
        numComments: item.num_comments,
        author: item.author,
        createdAt: item.created_at,
        discussionUrl: hnUrl,
        tags: item._tags
      }
    };
  }

  /**
   * Format story content for display
   */
  private formatContent(item: HNHit): string {
    const hnUrl = `https://news.ycombinator.com/item?id=${item.objectID}`;
    const title = item.title || 'Untitled';

    const lines: string[] = [
      `# ${title}`,
      ''
    ];

    if (item.url) {
      lines.push(`**Link**: ${item.url}`);
    }

    lines.push(`**Points**: ${item.points || 0} | **Comments**: ${item.num_comments || 0}`);
    lines.push(`**Author**: ${item.author}`);
    lines.push(`**Posted**: ${new Date(item.created_at).toLocaleDateString()}`);
    lines.push('');

    if (item.story_text) {
      lines.push('## Story');
      lines.push('');
      lines.push(this.cleanText(item.story_text));
      lines.push('');
    }

    lines.push(`[View discussion on HN](${hnUrl})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    // Check API availability with a simple search
    const url = `${this.baseUrl}/search?query=test&hitsPerPage=1`;
    const response = await this.fetchWithTimeout(url, {}, 5000);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

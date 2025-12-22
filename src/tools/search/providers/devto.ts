/**
 * Dev.to Search Provider
 *
 * Uses the Dev.to Forem API to search articles.
 * Free, no API key required.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface DevToArticle {
  id: number;
  title: string;
  description: string;
  url: string;
  published_at: string;
  published_timestamp: string;
  positive_reactions_count: number;
  comments_count: number;
  reading_time_minutes: number;
  tag_list: string[];
  user: {
    name: string;
    username: string;
    profile_image: string;
  };
  cover_image: string | null;
}

export class DevToProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'devto',
      description: 'Dev.to - Developer community articles',
      aliases: ['dev.to', 'dev'],
      baseUrl: 'https://dev.to/api',
      requiresAuth: false
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10 } = options;

    // Try the search API first
    try {
      const searchResults = await this.searchArticles(query, limit);
      if (searchResults.length > 0) {
        return searchResults;
      }
    } catch (error) {
      log.debug('search-provider', 'Dev.to search API failed, trying tag-based approach');
    }

    // Fall back to tag-based search
    try {
      return await this.searchByTag(query, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'Dev.to search failed', { error: message });
      throw error;
    }
  }

  /**
   * Search using the articles endpoint with per_page
   */
  private async searchArticles(query: string, limit: number): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      per_page: String(Math.min(limit, 30)),
      state: 'fresh'
    });

    // Dev.to API doesn't have a direct search parameter for articles endpoint
    // We need to use the articles endpoint and filter
    const url = `${this.baseUrl}/articles?${params}`;
    log.debug('search-provider', `Dev.to articles search: ${url}`);

    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as DevToArticle[];

    if (!Array.isArray(data)) {
      return [];
    }

    // Filter articles that match the query in title or description
    const queryLower = query.toLowerCase();
    const filtered = data.filter(article =>
      article.title.toLowerCase().includes(queryLower) ||
      article.description?.toLowerCase().includes(queryLower) ||
      article.tag_list?.some(tag => tag.toLowerCase().includes(queryLower))
    );

    const results = filtered.slice(0, limit).map(article => this.mapResult(article));
    return this.normalizeResults(results, limit);
  }

  /**
   * Search by treating query as a tag
   */
  private async searchByTag(query: string, limit: number): Promise<SearchResult[]> {
    // Clean up query to use as tag (remove spaces, special chars)
    const tag = query.toLowerCase().replace(/[^a-z0-9]/g, '');

    const params = new URLSearchParams({
      tag,
      per_page: String(Math.min(limit, 30)),
      state: 'rising'
    });

    const url = `${this.baseUrl}/articles?${params}`;
    log.debug('search-provider', `Dev.to tag search: ${url}`);

    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as DevToArticle[];

    if (!Array.isArray(data) || data.length === 0) {
      // If tag search fails, just get popular articles
      return this.getPopularArticles(limit);
    }

    const results = data.slice(0, limit).map(article => this.mapResult(article));
    return this.normalizeResults(results, limit);
  }

  /**
   * Get popular articles as fallback
   */
  private async getPopularArticles(limit: number): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      per_page: String(Math.min(limit, 30)),
      top: '7' // Top articles from last 7 days
    });

    const url = `${this.baseUrl}/articles?${params}`;
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as DevToArticle[];

    if (!Array.isArray(data)) {
      return [];
    }

    const results = data.slice(0, limit).map(article => this.mapResult(article));
    return this.normalizeResults(results, limit);
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(article: DevToArticle): SearchResult {
    return {
      title: article.title,
      url: article.url,
      snippet: article.description?.substring(0, 200) || '',
      content: this.formatContent(article),
      engine: this.name,
      score: article.positive_reactions_count || 0,
      metadata: {
        author: article.user?.name,
        username: article.user?.username,
        reactions: article.positive_reactions_count,
        comments: article.comments_count,
        readingTime: article.reading_time_minutes,
        tags: article.tag_list,
        publishedAt: article.published_at
      }
    };
  }

  /**
   * Format article content for display
   */
  private formatContent(article: DevToArticle): string {
    const lines: string[] = [
      `# ${article.title}`,
      '',
      article.description || '*No description available*',
      ''
    ];

    if (article.user) {
      lines.push(`**Author**: ${article.user.name} (@${article.user.username})`);
    }

    if (article.tag_list?.length) {
      lines.push(`**Tags**: ${article.tag_list.join(', ')}`);
    }

    lines.push(`**Reactions**: ${article.positive_reactions_count || 0}`);
    lines.push(`**Comments**: ${article.comments_count || 0}`);

    if (article.reading_time_minutes) {
      lines.push(`**Reading Time**: ${article.reading_time_minutes} min`);
    }

    lines.push(`**Published**: ${new Date(article.published_at).toLocaleDateString()}`);
    lines.push('');
    lines.push(`[Read on Dev.to](${article.url})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    const params = new URLSearchParams({
      per_page: '1'
    });

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/articles?${params}`,
      {},
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

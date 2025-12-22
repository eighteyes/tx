/**
 * GitHub Search Provider
 *
 * Uses the GitHub Search API to search repositories, code, and issues.
 * No API key required for basic usage (but has stricter rate limits).
 * With GITHUB_TOKEN, rate limits are higher.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
  updated_at: string;
  created_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  license?: {
    name: string;
    spdx_id: string;
  };
}

interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepository[];
}

export class GitHubProvider extends BaseSearchProvider {
  private token?: string;

  constructor() {
    super({
      name: 'github',
      description: 'GitHub - Search repositories, code, and projects',
      aliases: ['gh'],
      baseUrl: 'https://api.github.com'
    });
    this.token = process.env.GITHUB_TOKEN;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, sort = 'relevance' } = options;

    // Build API URL
    const params = new URLSearchParams({
      q: query,
      sort: this.mapSort(sort),
      order: 'desc',
      per_page: String(Math.min(limit, 100))
    });

    const url = `${this.baseUrl}/search/repositories?${params}`;
    log.debug('search-provider', `GitHub search: ${url}`);

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'tx-cli/4.0'
      };

      if (this.token) {
        headers['Authorization'] = `token ${this.token}`;
      }

      const response = await this.fetchWithTimeout(url, { headers });

      // Check rate limits
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining && parseInt(remaining, 10) < 5) {
        log.warn('search-provider', `GitHub API rate limit low: ${remaining} remaining`);
      }

      if (!response.ok) {
        if (response.status === 403) {
          const resetTime = response.headers.get('x-ratelimit-reset');
          const resetDate = resetTime ? new Date(parseInt(resetTime, 10) * 1000) : null;
          throw new Error(`Rate limited. Resets at: ${resetDate?.toISOString() || 'unknown'}`);
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as GitHubSearchResponse;
      const results = data.items.map(item => this.mapResult(item));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'GitHub search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map sort option to API parameter
   */
  private mapSort(sort: string): string {
    switch (sort) {
      case 'date':
        return 'updated';
      case 'votes':
        return 'stars';
      case 'relevance':
      default:
        return ''; // Empty for best match
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(item: GitHubRepository): SearchResult {
    return {
      title: item.full_name,
      url: item.html_url,
      snippet: item.description || 'No description available',
      content: this.formatContent(item),
      engine: this.name,
      score: item.stargazers_count,
      metadata: {
        stars: item.stargazers_count,
        forks: item.forks_count,
        language: item.language,
        topics: item.topics,
        license: item.license?.spdx_id,
        owner: item.owner.login,
        updatedAt: item.updated_at,
        createdAt: item.created_at
      }
    };
  }

  /**
   * Format repository content for display
   */
  private formatContent(item: GitHubRepository): string {
    const lines: string[] = [
      `# ${item.full_name}`,
      '',
      item.description || '*No description available*',
      '',
      `**Stars**: ${item.stargazers_count.toLocaleString()} | **Forks**: ${item.forks_count.toLocaleString()}`,
      `**Language**: ${item.language || 'Not specified'}`
    ];

    if (item.license) {
      lines.push(`**License**: ${item.license.name}`);
    }

    if (item.topics && item.topics.length > 0) {
      lines.push(`**Topics**: ${item.topics.join(', ')}`);
    }

    lines.push('');
    lines.push(`**Owner**: [@${item.owner.login}](https://github.com/${item.owner.login})`);
    lines.push(`**Updated**: ${new Date(item.updated_at).toLocaleDateString()}`);
    lines.push('');
    lines.push(`[View on GitHub](${item.html_url})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'tx-cli/4.0'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/rate_limit`,
      { headers },
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

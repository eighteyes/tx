/**
 * Stack Overflow Search Provider
 *
 * Uses the Stack Exchange API to search Stack Overflow questions.
 * No API key required for basic usage (but has rate limits).
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface StackOverflowQuestion {
  question_id: number;
  title: string;
  link: string;
  score: number;
  answer_count: number;
  is_answered: boolean;
  body_markdown?: string;
  body?: string;
  tags: string[];
  creation_date: number;
  accepted_answer_id?: number;
  owner?: {
    display_name: string;
    reputation?: number;
  };
}

interface StackOverflowResponse {
  items: StackOverflowQuestion[];
  has_more: boolean;
  quota_max: number;
  quota_remaining: number;
}

export class StackOverflowProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'stackoverflow',
      description: 'Stack Overflow Q&A - Programming questions and answers',
      aliases: ['so', 'stack', 'stackexchange'],
      baseUrl: 'https://api.stackexchange.com/2.3'
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, sort = 'relevance' } = options;

    // Build API URL
    const params = new URLSearchParams({
      order: 'desc',
      sort: this.mapSort(sort),
      intitle: query,
      site: 'stackoverflow',
      filter: 'withbody', // Include body content
      pagesize: String(Math.min(limit, 30)) // API max is 100
    });

    const url = `${this.baseUrl}/search/advanced?${params}`;
    log.debug('search-provider', `StackOverflow search: ${url}`);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        const errorText = await response.text();
        log.error('search-provider', `StackOverflow API error: ${response.status}`, { errorText });
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as StackOverflowResponse;

      if (data.quota_remaining < 10) {
        log.warn('search-provider', `StackOverflow API quota low: ${data.quota_remaining} remaining`);
      }

      const results = data.items.map(item => this.mapResult(item));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'StackOverflow search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map sort option to API parameter
   */
  private mapSort(sort: string): string {
    switch (sort) {
      case 'date':
        return 'creation';
      case 'votes':
        return 'votes';
      case 'relevance':
      default:
        return 'relevance';
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(item: StackOverflowQuestion): SearchResult {
    const snippet = item.body_markdown || item.body || '';
    const truncatedSnippet = snippet.length > 500
      ? snippet.substring(0, 500) + '...'
      : snippet;

    return {
      title: item.title,
      url: item.link,
      snippet: truncatedSnippet,
      content: this.formatContent(item),
      engine: this.name,
      score: item.score,
      metadata: {
        questionId: item.question_id,
        score: item.score,
        answerCount: item.answer_count,
        isAnswered: item.is_answered,
        hasAcceptedAnswer: !!item.accepted_answer_id,
        tags: item.tags,
        createdAt: new Date(item.creation_date * 1000).toISOString(),
        author: item.owner?.display_name
      }
    };
  }

  /**
   * Format question content for display
   */
  private formatContent(item: StackOverflowQuestion): string {
    const lines: string[] = [
      `# ${item.title}`,
      '',
      `**Score**: ${item.score} | **Answers**: ${item.answer_count} | **Answered**: ${item.is_answered ? 'Yes' : 'No'}`,
      `**Tags**: ${item.tags.join(', ')}`,
      ''
    ];

    if (item.body_markdown || item.body) {
      lines.push('## Question');
      lines.push('');
      lines.push(item.body_markdown || item.body || '');
    }

    lines.push('');
    lines.push(`[View on Stack Overflow](${item.link})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    // Check API availability with a simple request
    const url = `${this.baseUrl}/info?site=stackoverflow`;
    const response = await this.fetchWithTimeout(url, {}, 5000);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

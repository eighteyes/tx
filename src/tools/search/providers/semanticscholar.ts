/**
 * Semantic Scholar Search Provider
 *
 * Uses the Semantic Scholar Academic Graph API to search research papers.
 * Free, no API key required.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  url: string | null;
  citationCount: number;
  year: number | null;
  authors: Array<{
    authorId: string;
    name: string;
  }>;
  venue?: string;
  publicationDate?: string;
}

interface SemanticScholarResponse {
  total: number;
  offset: number;
  data: SemanticScholarPaper[];
}

export class SemanticScholarProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'semanticscholar',
      description: 'Semantic Scholar - Academic research papers',
      aliases: ['semscholar', 'semantic-scholar', 's2'],
      baseUrl: 'https://api.semanticscholar.org/graph/v1',
      requiresAuth: false
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10 } = options;

    // Build API URL
    const params = new URLSearchParams({
      query,
      limit: String(Math.min(limit, 100)),
      fields: 'title,abstract,url,citationCount,year,authors,venue,publicationDate'
    });

    const url = `${this.baseUrl}/paper/search?${params}`;
    log.debug('search-provider', `Semantic Scholar search: ${url}`);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as SemanticScholarResponse;

      if (!data.data?.length) {
        return [];
      }

      const results = data.data.map(paper => this.mapResult(paper));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'Semantic Scholar search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(paper: SemanticScholarPaper): SearchResult {
    const paperUrl = paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`;
    const authors = paper.authors?.map(a => a.name).slice(0, 3).join(', ') || 'Unknown authors';

    return {
      title: paper.title,
      url: paperUrl,
      snippet: paper.abstract?.substring(0, 200) || `${authors} - ${paper.year || 'Unknown year'}`,
      content: this.formatContent(paper),
      engine: this.name,
      score: paper.citationCount || 0,
      metadata: {
        paperId: paper.paperId,
        citationCount: paper.citationCount,
        year: paper.year,
        venue: paper.venue,
        authors: paper.authors?.map(a => a.name)
      }
    };
  }

  /**
   * Format paper content for display
   */
  private formatContent(paper: SemanticScholarPaper): string {
    const lines: string[] = [
      `# ${paper.title}`,
      ''
    ];

    if (paper.abstract) {
      lines.push(paper.abstract);
      lines.push('');
    }

    if (paper.authors?.length) {
      lines.push(`**Authors**: ${paper.authors.map(a => a.name).join(', ')}`);
    }

    if (paper.venue) {
      lines.push(`**Venue**: ${paper.venue}`);
    }

    if (paper.year) {
      lines.push(`**Year**: ${paper.year}`);
    }

    if (paper.citationCount !== undefined) {
      lines.push(`**Citations**: ${paper.citationCount.toLocaleString()}`);
    }

    lines.push('');
    const url = paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`;
    lines.push(`[View on Semantic Scholar](${url})`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    const params = new URLSearchParams({
      query: 'test',
      limit: '1',
      fields: 'title'
    });

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/paper/search?${params}`,
      {},
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

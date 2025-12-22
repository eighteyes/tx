/**
 * PubMed Search Provider
 *
 * Uses the NCBI E-utilities API to search PubMed medical and scientific literature.
 * Free, no API key required.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface PubMedSearchResponse {
  esearchresult: {
    count: string;
    retmax: string;
    retstart: string;
    idlist: string[];
  };
}

interface PubMedSummaryResponse {
  result: {
    [key: string]: {
      uid: string;
      pubdate: string;
      title: string;
      authors: Array<{ name: string; authtype: string }>;
      source: string;
      volume?: string;
      issue?: string;
      pages?: string;
      sortfirstauthor?: string;
    };
    uids: string[];
  };
}

export class PubMedProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'pubmed',
      description: 'PubMed - Medical and scientific research',
      aliases: ['ncbi'],
      baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
      requiresAuth: false
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, sort = 'relevance' } = options;

    try {
      // Step 1: Search for article IDs
      const searchParams = new URLSearchParams({
        db: 'pubmed',
        term: query,
        retmax: String(Math.min(limit, 100)),
        retmode: 'json',
        sort: this.mapSort(sort)
      });

      const searchUrl = `${this.baseUrl}/esearch.fcgi?${searchParams}`;
      log.debug('search-provider', `PubMed search: ${searchUrl}`);

      const searchResponse = await this.fetchWithTimeout(searchUrl);

      if (!searchResponse.ok) {
        throw new Error(`API error: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json() as PubMedSearchResponse;

      if (!searchData.esearchresult?.idlist?.length) {
        return [];
      }

      const ids = searchData.esearchresult.idlist;

      // Step 2: Get article summaries
      const summaryParams = new URLSearchParams({
        db: 'pubmed',
        id: ids.join(','),
        retmode: 'json'
      });

      const summaryUrl = `${this.baseUrl}/esummary.fcgi?${summaryParams}`;
      const summaryResponse = await this.fetchWithTimeout(summaryUrl);

      if (!summaryResponse.ok) {
        // Fall back to basic results without summaries
        return ids.map((id, idx) => ({
          title: `PubMed Article ${idx + 1}`,
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          snippet: 'Medical/scientific research article',
          engine: this.name,
          metadata: { pmid: id }
        }));
      }

      const summaryData = await summaryResponse.json() as PubMedSummaryResponse;

      const results = ids.map(id => this.mapResult(id, summaryData));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'PubMed search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map sort option to API parameter
   */
  private mapSort(sort: string): string {
    switch (sort) {
      case 'date':
        return 'pub_date';
      case 'relevance':
      default:
        return 'relevance';
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(id: string, summaryData: PubMedSummaryResponse): SearchResult {
    const article = summaryData.result?.[id];

    if (!article) {
      return {
        title: `PubMed Article (PMID: ${id})`,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        snippet: 'Medical/scientific research article',
        engine: this.name,
        metadata: { pmid: id }
      };
    }

    const authors = article.authors?.map(a => a.name).slice(0, 3).join(', ') || 'Unknown authors';
    const snippet = `${authors} - ${article.source || 'Unknown journal'} (${article.pubdate || 'Unknown date'})`;

    return {
      title: article.title || `PubMed Article (PMID: ${id})`,
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      snippet,
      content: this.formatContent(id, article),
      engine: this.name,
      metadata: {
        pmid: id,
        journal: article.source,
        pubdate: article.pubdate,
        authors: article.authors?.map(a => a.name)
      }
    };
  }

  /**
   * Format article content for display
   */
  private formatContent(id: string, article: PubMedSummaryResponse['result'][string]): string {
    const lines: string[] = [
      `# ${article.title || 'PubMed Article'}`,
      ''
    ];

    if (article.authors?.length) {
      const authorList = article.authors.map(a => a.name).join(', ');
      lines.push(`**Authors**: ${authorList}`);
    }

    if (article.source) {
      let citation = `**Journal**: ${article.source}`;
      if (article.volume) {
        citation += ` ${article.volume}`;
        if (article.issue) citation += `(${article.issue})`;
      }
      if (article.pages) citation += `:${article.pages}`;
      lines.push(citation);
    }

    if (article.pubdate) {
      lines.push(`**Published**: ${article.pubdate}`);
    }

    lines.push(`**PMID**: ${id}`);
    lines.push('');
    lines.push(`[View on PubMed](https://pubmed.ncbi.nlm.nih.gov/${id}/)`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    const params = new URLSearchParams({
      db: 'pubmed',
      term: 'test',
      retmax: '1',
      retmode: 'json'
    });

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/esearch.fcgi?${params}`,
      {},
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

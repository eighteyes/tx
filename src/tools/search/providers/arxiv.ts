/**
 * arXiv Search Provider
 *
 * Uses the arXiv API to search for research papers.
 * No API key required. Uses XML Atom feed format.
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  pdfLink?: string;
  absLink?: string;
}

export class ArxivProvider extends BaseSearchProvider {
  constructor() {
    super({
      name: 'arxiv',
      description: 'arXiv - Scientific research papers',
      aliases: ['papers', 'research'],
      baseUrl: 'https://export.arxiv.org/api'
    });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, sort = 'relevance' } = options;

    // Build API URL - arXiv uses query string format
    const sortBy = sort === 'date' ? 'submittedDate' : 'relevance';
    const sortOrder = 'descending';

    // Encode query for arXiv search syntax
    const searchQuery = this.buildSearchQuery(query);

    const params = new URLSearchParams({
      search_query: searchQuery,
      start: '0',
      max_results: String(Math.min(limit, 50)),
      sortBy: sortBy,
      sortOrder: sortOrder
    });

    const url = `${this.baseUrl}/query?${params}`;
    log.debug('search-provider', `arXiv search: ${url}`);

    try {
      const response = await this.fetchWithTimeout(url, {
        headers: {
          'Accept': 'application/atom+xml'
        }
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const xml = await response.text();
      const entries = this.parseAtomFeed(xml);
      const results = entries.map(entry => this.mapResult(entry));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'arXiv search failed', { error: message });
      throw error;
    }
  }

  /**
   * Build arXiv search query
   * arXiv supports field-specific searches: ti: (title), au: (author), abs: (abstract), all: (all fields)
   */
  private buildSearchQuery(query: string): string {
    // Default to searching all fields
    return `all:${query}`;
  }

  /**
   * Parse Atom XML feed from arXiv
   */
  private parseAtomFeed(xml: string): ArxivEntry[] {
    const entries: ArxivEntry[] = [];

    // Extract all entry blocks
    const entryMatches = xml.match(/<entry>([\s\S]*?)<\/entry>/g);
    if (!entryMatches) {
      return entries;
    }

    for (const entryXml of entryMatches) {
      const entry = this.parseEntry(entryXml);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Parse a single entry from XML
   */
  private parseEntry(xml: string): ArxivEntry | null {
    // Extract ID
    const idMatch = xml.match(/<id>([^<]+)<\/id>/);
    if (!idMatch) return null;

    // Extract title
    const titleMatch = xml.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? this.cleanText(titleMatch[1]) : 'Untitled';

    // Extract summary/abstract
    const summaryMatch = xml.match(/<summary>([^]*?)<\/summary>/);
    const summary = summaryMatch ? this.cleanText(summaryMatch[1]) : '';

    // Extract authors
    const authors: string[] = [];
    const authorMatches = xml.matchAll(/<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g);
    for (const match of authorMatches) {
      authors.push(match[1].trim());
    }

    // Extract dates
    const publishedMatch = xml.match(/<published>([^<]+)<\/published>/);
    const updatedMatch = xml.match(/<updated>([^<]+)<\/updated>/);

    // Extract categories
    const categories: string[] = [];
    const categoryMatches = xml.matchAll(/<category[^>]*term="([^"]+)"/g);
    for (const match of categoryMatches) {
      categories.push(match[1]);
    }

    // Extract links
    let pdfLink: string | undefined;
    let absLink: string | undefined;
    const linkMatches = xml.matchAll(/<link[^>]*href="([^"]+)"[^>]*(?:title="([^"]+)")?[^>]*(?:type="([^"]+)")?[^>]*\/>/g);
    for (const match of linkMatches) {
      const href = match[1];
      const linkTitle = match[2];
      const linkType = match[3];

      if (linkTitle === 'pdf' || href.includes('/pdf/')) {
        pdfLink = href;
      } else if (linkType === 'text/html' || href.includes('/abs/')) {
        absLink = href;
      }
    }

    return {
      id: idMatch[1],
      title,
      summary,
      authors,
      published: publishedMatch ? publishedMatch[1] : '',
      updated: updatedMatch ? updatedMatch[1] : '',
      categories,
      pdfLink,
      absLink
    };
  }

  /**
   * Map entry to SearchResult
   */
  private mapResult(entry: ArxivEntry): SearchResult {
    // Extract arXiv ID from full URL
    const arxivIdMatch = entry.id.match(/(\d+\.\d+)/);
    const arxivId = arxivIdMatch ? arxivIdMatch[1] : entry.id;

    const url = entry.absLink || `https://arxiv.org/abs/${arxivId}`;

    return {
      title: entry.title,
      url: url,
      snippet: entry.summary.substring(0, 300) + (entry.summary.length > 300 ? '...' : ''),
      content: this.formatContent(entry, arxivId),
      engine: this.name,
      metadata: {
        arxivId: arxivId,
        authors: entry.authors,
        categories: entry.categories,
        published: entry.published,
        updated: entry.updated,
        pdfUrl: entry.pdfLink || `https://arxiv.org/pdf/${arxivId}.pdf`
      }
    };
  }

  /**
   * Format paper content for display
   */
  private formatContent(entry: ArxivEntry, arxivId: string): string {
    const lines: string[] = [
      `# ${entry.title}`,
      '',
      `**Authors**: ${entry.authors.join(', ')}`,
      `**arXiv ID**: ${arxivId}`,
      `**Categories**: ${entry.categories.join(', ')}`,
      `**Published**: ${new Date(entry.published).toLocaleDateString()}`,
      ''
    ];

    if (entry.updated && entry.updated !== entry.published) {
      lines.push(`**Last Updated**: ${new Date(entry.updated).toLocaleDateString()}`);
      lines.push('');
    }

    lines.push('## Abstract');
    lines.push('');
    lines.push(entry.summary);
    lines.push('');
    lines.push('## Links');
    lines.push('');
    lines.push(`- [Abstract](https://arxiv.org/abs/${arxivId})`);
    lines.push(`- [PDF](https://arxiv.org/pdf/${arxivId}.pdf)`);

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    // Check API availability with a simple query
    const url = `${this.baseUrl}/query?search_query=all:test&max_results=1`;
    const response = await this.fetchWithTimeout(url, {}, 5000);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }
}

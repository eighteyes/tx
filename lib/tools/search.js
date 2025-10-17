const axios = require('axios');
const { Logger } = require('../logger');

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:12321';

class Search {
  /**
   * Search using SearXNG
   * Returns array of results with URL and content
   */
  static async query(searchTerm, categories = ['general'], limit = 10) {
    try {
      Logger.log('search', `Searching: ${searchTerm}`, {
        categories,
        limit
      });

      const response = await axios.post(
        `${SEARXNG_URL}/search`,
        {
          q: searchTerm,
          categories: categories.join(','),
          format: 'json'
        },
        {
          timeout: 30000,
          headers: {
            'User-Agent': 'TX-Watch/2.0'
          }
        }
      );

      const results = response.data.results || [];
      const processed = results.slice(0, limit).map(r => ({
        url: r.url,
        title: r.title,
        content: r.content || '',
        engine: r.engine || 'unknown'
      }));

      Logger.log('search', `Found ${processed.length} results`, {
        searchTerm,
        count: processed.length
      });

      return processed;
    } catch (error) {
      Logger.error('search', `Search failed: ${error.message}`, {
        searchTerm,
        error: error.message,
        searxngUrl: SEARXNG_URL
      });

      // Try fallback
      return await Search._fallback(searchTerm, limit);
    }
  }

  /**
   * Fallback search (if SearXNG unavailable)
   * Returns empty array (user would need to implement WebSearch or curl fallback)
   */
  static async _fallback(searchTerm, limit) {
    Logger.warn('search', 'SearXNG unavailable, using fallback', {
      searchTerm
    });

    // In production, could use:
    // - WebSearch API
    // - curl with DuckDuckGo
    // - Other search engines

    return [];
  }

  /**
   * Check if SearXNG is available
   */
  static async isAvailable() {
    try {
      const response = await axios.get(`${SEARXNG_URL}/status`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      Logger.warn('search', `SearXNG not available at ${SEARXNG_URL}`);
      return false;
    }
  }

  /**
   * Format search results for display
   */
  static formatResults(results) {
    return results
      .map(
        (r, i) =>
          `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content.substring(0, 100)}...`
      )
      .join('\n\n');
  }
}

module.exports = { Search };

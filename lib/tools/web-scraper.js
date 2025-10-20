const axios = require('axios');
const cheerio = require('cheerio');
const { Logger } = require('../logger');

class WebScraper {
  /**
   * Scrape a URL and extract results using CSS selectors
   * @param {string} url - Base URL to scrape
   * @param {object} config - Configuration object
   * @param {object} config.params - URL query parameters (automatically encoded)
   * @param {string} config.itemSelector - CSS selector for result items
   * @param {object} config.fields - Field mappings { fieldName: cssSelector }
   * @param {number} config.limit - Max results to return
   * @param {object} config.headers - Custom headers (defaults to realistic User-Agent)
   * @param {number} config.timeout - Request timeout in ms (default: 15000)
   * @returns {array} Array of extracted results
   */
  static async scrape(url, config = {}) {
    const {
      params = {},
      itemSelector = 'div[data-rp]',
      fields = {},
      limit = 10,
      headers = {},
      timeout = 15000,
      name = 'scraper'
    } = config;

    // Default User-Agent to avoid being blocked
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      ...headers
    };

    try {
      Logger.log('web-scraper', `Scraping: ${url}`, { params, name });

      const response = await axios.get(url, {
        params,
        headers: defaultHeaders,
        timeout
      });

      const $ = cheerio.load(response.data);
      const results = [];

      $(itemSelector).each((i, el) => {
        if (results.length >= limit) return;

        const item = {};
        let hasData = false;

        // Extract fields using provided selectors
        Object.entries(fields).forEach(([fieldName, selector]) => {
          if (typeof selector === 'string') {
            // CSS selector
            const $el = $(el).find(selector);
            if ($el.length) {
              item[fieldName] = $el.text().trim() || $el.attr('href');
              hasData = true;
            }
          } else if (typeof selector === 'function') {
            // Custom extraction function
            try {
              item[fieldName] = selector($(el), $);
              hasData = true;
            } catch (e) {
              Logger.warn('web-scraper', `Field extraction failed for ${fieldName}`, { error: e.message });
            }
          }
        });

        if (hasData) {
          results.push(item);
        }
      });

      Logger.log('web-scraper', `Scraped ${results.length} results`, { name, count: results.length });
      return results;
    } catch (error) {
      Logger.error('web-scraper', `Scraping failed: ${error.message}`, {
        url,
        name,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Scrape with custom HTML parsing logic
   * @param {string} url - URL to scrape
   * @param {function} parser - Function that receives ($cheerio, responseData) and returns results array
   * @param {object} config - Request config (params, headers, timeout)
   */
  static async scrapeCustom(url, parser, config = {}) {
    const {
      params = {},
      headers = {},
      timeout = 15000,
      name = 'custom-scraper'
    } = config;

    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...headers
    };

    try {
      Logger.log('web-scraper', `Custom scraping: ${url}`, { name });

      const response = await axios.get(url, {
        params,
        headers: defaultHeaders,
        timeout
      });

      const $ = cheerio.load(response.data);
      const results = parser($, response.data);

      Logger.log('web-scraper', `Custom scraped ${results.length} results`, { name });
      return results || [];
    } catch (error) {
      Logger.error('web-scraper', `Custom scraping failed: ${error.message}`, {
        url,
        name,
        error: error.message
      });
      return [];
    }
  }
}

module.exports = { WebScraper };

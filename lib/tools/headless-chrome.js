const { execSync } = require('child_process');
const fs = require('fs');
const { Logger } = require('../logger');

/**
 * Generic headless Chrome utility for rendering and parsing pages
 * Eliminates need for Puppeteer, uses native Chrome CLI
 */
class HeadlessChrome {
  /**
   * Fetch URL and render with headless Chrome
   * @param {string} url - URL to fetch
   * @param {object} options - Configuration options
   * @returns {string} - Rendered HTML content
   */
  static async fetch(url, options = {}) {
    try {
      const timeout = options.timeout || 20000;

      Logger.log('headless-chrome', `Fetching: ${url}`);

      const output = execSync(
        `google-chrome --headless --disable-gpu --dump-dom "${url}" 2>/dev/null || ` +
        `chrome --headless --disable-gpu --dump-dom "${url}" 2>/dev/null || ` +
        `chromium --headless --disable-gpu --dump-dom "${url}" 2>/dev/null || ` +
        `echo ""`,
        {
          timeout,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );

      if (!output || output.length < 100) {
        Logger.warn('headless-chrome', `Output too small for ${url}`);
        return null;
      }

      Logger.log('headless-chrome', `Successfully fetched ${url} (${output.length} bytes)`);
      return output;
    } catch (error) {
      Logger.warn('headless-chrome', `Fetch failed for ${url}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract data from HTML using CSS selectors and custom extraction function
   * @param {string} html - HTML to parse
   * @param {object} config - Extraction configuration
   *   - selectors: CSS selector(s) - string or array
   *   - extractFn: (cheerio, element, index) => object - custom extraction function
   *   - limit: max results to extract
   *   - dedupeKey: property to use for deduplication
   * @returns {array} - Extracted data
   */
  static extractFromHTML(html, config = {}) {
    try {
      if (!html) return [];

      const $ = require('cheerio').load(html);
      const results = [];
      const seen = new Set();

      const selectors = Array.isArray(config.selectors)
        ? config.selectors
        : [config.selectors];

      const limit = config.limit || 10;
      const dedupeKey = config.dedupeKey || 'url';
      const extractFn = config.extractFn;

      if (!extractFn) {
        Logger.warn('headless-chrome', 'No extraction function provided');
        return [];
      }

      // Try each selector until we hit the limit
      for (const selector of selectors) {
        if (results.length >= limit) break;

        $(selector).each((i, el) => {
          if (results.length >= limit) return;

          try {
            const data = extractFn($, el, i);

            if (data) {
              const dedupeValue = data[dedupeKey];
              if (dedupeValue && !seen.has(dedupeValue)) {
                seen.add(dedupeValue);
                results.push(data);
              } else if (!dedupeKey || !dedupeValue) {
                // If no dedupeKey or value is undefined, add anyway
                results.push(data);
              }
            }
          } catch (err) {
            Logger.warn('headless-chrome', `Error extracting data: ${err.message}`);
          }
        });
      }

      Logger.log('headless-chrome', `Extracted ${results.length} results`);
      return results.slice(0, limit);
    } catch (error) {
      Logger.error('headless-chrome', `Extraction failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch and extract data in one call
   * @param {string} url - URL to fetch
   * @param {object} config - Extraction configuration (see extractFromHTML)
   * @param {object} fetchOptions - Fetch options (see fetch)
   * @returns {array} - Extracted data
   */
  static async fetchAndExtract(url, config = {}, fetchOptions = {}) {
    try {
      const html = await HeadlessChrome.fetch(url, fetchOptions);

      if (!html) {
        Logger.warn('headless-chrome', `Failed to fetch ${url}`);
        return [];
      }

      return HeadlessChrome.extractFromHTML(html, config);
    } catch (error) {
      Logger.error('headless-chrome', `fetchAndExtract failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if headless Chrome is available
   * @returns {boolean} - Whether Chrome is available
   */
  static isAvailable() {
    try {
      execSync('google-chrome --version 2>/dev/null || chrome --version 2>/dev/null || chromium --version 2>/dev/null', {
        timeout: 5000,
        stdio: 'pipe'
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = { HeadlessChrome };

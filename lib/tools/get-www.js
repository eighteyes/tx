const axios = require('axios');
const { Logger } = require('../logger');

const ARCHIVE_IS_URL = 'https://archive.is';

// Proper user agent for realistic requests
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let puppeteer = null;

try {
  puppeteer = require('puppeteer');
} catch (e) {
  Logger.warn('get-www', 'Puppeteer not installed. JS rendering disabled. Run: npm install');
}

class GetWWW {
  /**
   * Fetch URL and extract plaintext content
   * Falls back to archive.is on 403 error
   * Optionally renders JavaScript
   */
  static async fetch(urls, options = {}) {
    if (!urls || urls.length === 0) {
      throw new Error('No URLs provided');
    }

    // Handle single URL or array of URLs
    const urlArray = Array.isArray(urls) ? urls : [urls];

    const results = [];

    for (const url of urlArray) {
      try {
        Logger.log('get-www', `Fetching: ${url}`, { url, js: options.js, archive: options.archive });

        let plaintext;
        let source = 'original';

        // If archive-only mode, skip original fetch
        if (options.archive) {
          Logger.log('get-www', `Archive mode enabled for ${url}`, { url });
          const archiveResult = await GetWWW._tryArchiveServices(url);
          plaintext = archiveResult.content;
          source = archiveResult.source;
        } else if (options.js && puppeteer) {
          plaintext = await GetWWW._fetchWithJS(url);
        } else {
          plaintext = await GetWWW._fetchAndConvert(url);
        }

        results.push({
          url,
          content: plaintext,
          status: 'success',
          source,
          rendered: options.js && puppeteer ? true : false
        });

        Logger.log('get-www', `Successfully fetched ${url}`, {
          url,
          contentLength: plaintext.length,
          source
        });
      } catch (error) {
        // Check if it's a 403 error and try archive services
        if (!options.archive && error.response && error.response.status === 403) {
          try {
            Logger.warn('get-www', `Got 403 for ${url}, trying archive services`, { url });

            const archiveResult = await GetWWW._tryArchiveServices(url);
            plaintext = archiveResult.content;

            results.push({
              url,
              content: plaintext,
              status: 'success',
              source: archiveResult.source,
              rendered: false
            });

            Logger.log('get-www', `Successfully fetched from ${archiveResult.source}`, {
              url,
              contentLength: plaintext.length
            });
          } catch (archiveError) {
            Logger.error('get-www', `Failed to fetch from archives: ${archiveError.message}`, {
              url,
              error: archiveError.message
            });

            results.push({
              url,
              content: null,
              status: 'error',
              error: `403 - could not fetch from original or archives: ${archiveError.message}`,
              source: 'failed'
            });
          }
        } else {
          Logger.error('get-www', `Failed to fetch ${url}: ${error.message}`, {
            url,
            error: error.message
          });

          results.push({
            url,
            content: null,
            status: 'error',
            error: error.message,
            source: 'failed'
          });
        }
      }
    }

    return results;
  }

  /**
   * Fetch URL and convert HTML to plaintext
   */
  static async _fetchAndConvert(url) {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    return GetWWW._htmlToPlaintext(response.data);
  }

  /**
   * Fetch URL with JavaScript rendering via Puppeteer
   */
  static async _fetchWithJS(url) {
    if (!puppeteer) {
      throw new Error('Puppeteer not available. Run: npm install puppeteer');
    }

    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();

      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent(USER_AGENT);

      // Navigate to URL with timeout
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for dynamic content
      await page.waitForTimeout(2000);

      // Get rendered HTML
      const html = await page.content();

      return GetWWW._htmlToPlaintext(html);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Try multiple archive services in order
   * Returns { content, source } or throws error if all fail
   */
  static async _tryArchiveServices(url) {
    const archiveServices = [
      { name: 'archive.is', url: `https://archive.is/${url}` },
      { name: 'archive.org', url: `https://web.archive.org/latest/${url}` }
    ];

    let lastError = null;

    for (const service of archiveServices) {
      try {
        Logger.log('get-www', `Trying ${service.name} for ${url}`, { url, archive: service.name });

        const response = await axios.get(service.url, {
          timeout: 30000,
          headers: {
            'User-Agent': USER_AGENT
          }
        });

        const content = GetWWW._htmlToPlaintext(response.data);

        Logger.log('get-www', `Successfully fetched from ${service.name}`, {
          url,
          archive: service.name,
          contentLength: content.length
        });

        return { content, source: service.name };
      } catch (error) {
        Logger.warn('get-www', `${service.name} failed: ${error.message}`, {
          url,
          archive: service.name,
          error: error.message
        });
        lastError = error;
        continue;
      }
    }

    throw new Error(`All archive services failed for ${url}. Last error: ${lastError?.message}`);
  }

  /**
   * Fetch from archive.is and convert to plaintext
   */
  static async _fetchFromArchive(url) {
    // archive.is accepts URLs in query param or as path
    const archiveUrl = `${ARCHIVE_IS_URL}/${url}`;

    const response = await axios.get(archiveUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    return GetWWW._htmlToPlaintext(response.data);
  }

  /**
   * Convert HTML to plaintext
   * Removes HTML tags, decodes entities, cleans whitespace
   */
  static _htmlToPlaintext(html) {
    if (!html) return '';

    let text = html
      // Remove script and style tags with content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      // Replace common HTML tags with newlines
      .replace(/<(p|div|section|article|header|footer|main|nav|br|hr)\b[^>]*>/gi, '\n')
      .replace(/<(h[1-6]|li|dt|dd|td|th|pre)\b[^>]*>/gi, '\n')
      // Remove other HTML tags
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&[^;]+;/g, ' ')
      // Fix multiple spaces
      .replace(/[ \t]+/g, ' ')
      // Fix multiple newlines
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    return text;
  }

  /**
   * Format results for display
   */
  static formatResults(results) {
    if (!results || results.length === 0) {
      return 'No results';
    }

    return results
      .map(
        (r, i) =>
          `${i + 1}. URL: ${r.url}\n` +
          `   Source: ${r.source}\n` +
          `   Status: ${r.status}\n` +
          (r.status === 'success'
            ? `   Content (first 500 chars):\n${r.content.substring(0, 500)}...\n`
            : `   Error: ${r.error}\n`)
      )
      .join('\n');
  }
}

module.exports = { GetWWW };

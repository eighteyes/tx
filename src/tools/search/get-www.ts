/**
 * URL Fetcher with Archive Fallback
 *
 * Fetches URL content with automatic fallback to archive.is and archive.org
 * when the original URL fails or is inaccessible.
 */

import { log } from '../../shared/logger.ts';

export interface FetchResult {
  url: string;
  status: 'success' | 'error';
  source: 'direct' | 'archive.is' | 'archive.org' | 'none';
  content?: string;
  title?: string;
  error?: string;
  contentType?: string;
}

export interface FetchOptions {
  archive?: boolean;
  timeout?: number;
  extractText?: boolean;
}

const DEFAULT_TIMEOUT = 15000;
const USER_AGENT = 'tx-cli/4.0 (web fetcher)';

/**
 * Fetch content from a URL with optional archive fallback
 */
export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const { archive = true, timeout = DEFAULT_TIMEOUT, extractText = true } = options;

  // Try direct fetch first
  try {
    const result = await fetchDirect(url, timeout);
    if (result.status === 'success') {
      return result;
    }
    log.debug('get-www', `Direct fetch failed for ${url}`, { error: result.error });
  } catch (error) {
    log.debug('get-www', `Direct fetch exception for ${url}`, { error });
  }

  // Try archive fallbacks if enabled
  if (archive) {
    // Try archive.is
    try {
      const result = await fetchFromArchiveIs(url, timeout);
      if (result.status === 'success') {
        return result;
      }
      log.debug('get-www', `archive.is fetch failed for ${url}`, { error: result.error });
    } catch (error) {
      log.debug('get-www', `archive.is exception for ${url}`, { error });
    }

    // Try archive.org Wayback Machine
    try {
      const result = await fetchFromWayback(url, timeout);
      if (result.status === 'success') {
        return result;
      }
      log.debug('get-www', `archive.org fetch failed for ${url}`, { error: result.error });
    } catch (error) {
      log.debug('get-www', `archive.org exception for ${url}`, { error });
    }
  }

  return {
    url,
    status: 'error',
    source: 'none',
    error: 'All fetch methods failed'
  };
}

/**
 * Fetch multiple URLs
 */
export async function fetchUrls(urls: string[], options: FetchOptions = {}): Promise<FetchResult[]> {
  const results = await Promise.all(
    urls.map(url => fetchUrl(url, options))
  );
  return results;
}

/**
 * Direct fetch from original URL
 */
async function fetchDirect(url: string, timeout: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        url,
        status: 'error',
        source: 'direct',
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const html = await response.text();
    const extracted = extractContent(html);

    return {
      url,
      status: 'success',
      source: 'direct',
      content: extracted.content,
      title: extracted.title,
      contentType
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      status: 'error',
      source: 'direct',
      error: message
    };
  }
}

/**
 * Fetch from archive.is
 */
async function fetchFromArchiveIs(url: string, timeout: number): Promise<FetchResult> {
  const archiveUrl = `https://archive.is/newest/${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(archiveUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        url,
        status: 'error',
        source: 'archive.is',
        error: `HTTP ${response.status}`
      };
    }

    const html = await response.text();
    const extracted = extractContent(html);

    return {
      url,
      status: 'success',
      source: 'archive.is',
      content: extracted.content,
      title: extracted.title
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      status: 'error',
      source: 'archive.is',
      error: message
    };
  }
}

/**
 * Fetch from archive.org Wayback Machine
 */
async function fetchFromWayback(url: string, timeout: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // First, check if the URL is archived
    const checkUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const checkResponse = await fetch(checkUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });

    if (!checkResponse.ok) {
      clearTimeout(timeoutId);
      return {
        url,
        status: 'error',
        source: 'archive.org',
        error: 'Wayback availability check failed'
      };
    }

    const availability = await checkResponse.json() as {
      archived_snapshots?: {
        closest?: {
          available: boolean;
          url: string;
        };
      };
    };

    const snapshot = availability?.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot?.url) {
      clearTimeout(timeoutId);
      return {
        url,
        status: 'error',
        source: 'archive.org',
        error: 'No archived snapshot available'
      };
    }

    // Fetch the archived page
    const archiveResponse = await fetch(snapshot.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!archiveResponse.ok) {
      return {
        url,
        status: 'error',
        source: 'archive.org',
        error: `HTTP ${archiveResponse.status}`
      };
    }

    const html = await archiveResponse.text();
    const extracted = extractContent(html);

    return {
      url,
      status: 'success',
      source: 'archive.org',
      content: extracted.content,
      title: extracted.title
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      status: 'error',
      source: 'archive.org',
      error: message
    };
  }
}

/**
 * Extract readable content from HTML
 */
function extractContent(html: string): { content: string; title?: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : undefined;

  // Remove script and style tags
  let content = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Try to extract main content areas
  const mainContent = extractMainContent(content);
  if (mainContent) {
    content = mainContent;
  }

  // Remove all HTML tags
  content = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Decode HTML entities
  content = decodeHtmlEntities(content);

  // Truncate if too long
  const MAX_LENGTH = 50000;
  if (content.length > MAX_LENGTH) {
    content = content.substring(0, MAX_LENGTH) + '...';
  }

  return { content, title };
}

/**
 * Try to extract the main content area from HTML
 */
function extractMainContent(html: string): string | null {
  // Look for common main content containers
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  ];

  for (const pattern of patterns) {
    const matches = [...html.matchAll(pattern)];
    if (matches.length > 0) {
      // Combine all matches
      return matches.map(m => m[1]).join('\n\n');
    }
  }

  return null;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

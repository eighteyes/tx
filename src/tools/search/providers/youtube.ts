/**
 * YouTube Search Provider
 *
 * Uses the YouTube Data API v3 to search for videos.
 * Requires YOUTUBE_API_KEY environment variable.
 *
 * Also supports transcript fetching via scraping (no API key needed).
 */

import { BaseSearchProvider, SearchResult, SearchOptions } from '../base-provider.ts';
import { log } from '../../../shared/logger.ts';
import {
  fetchTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptNotAvailableLanguageError
} from 'youtube-transcript-plus';

interface YouTubeVideo {
  id: {
    kind: string;
    videoId: string;
  };
  snippet: {
    title: string;
    description: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: {
      default: { url: string; width: number; height: number };
      medium: { url: string; width: number; height: number };
      high: { url: string; width: number; height: number };
    };
  };
}

interface YouTubeSearchResponse {
  items: YouTubeVideo[];
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
}

export class YouTubeProvider extends BaseSearchProvider {
  private apiKey?: string;

  constructor() {
    super({
      name: 'youtube',
      description: 'YouTube - Search videos',
      aliases: ['yt'],
      baseUrl: 'https://www.googleapis.com/youtube/v3',
      requiresAuth: true
    });
    this.apiKey = process.env.YOUTUBE_API_KEY;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, sort = 'relevance' } = options;

    if (!this.apiKey) {
      log.warn('search-provider', 'YouTube search requires YOUTUBE_API_KEY environment variable');
      return [];
    }

    // Build API URL
    const params = new URLSearchParams({
      q: query,
      part: 'snippet',
      maxResults: String(Math.min(limit, 50)),
      key: this.apiKey,
      type: 'video',
      order: this.mapSort(sort)
    });

    const url = `${this.baseUrl}/search?${params}`;
    log.debug('search-provider', `YouTube search: ${url.replace(this.apiKey, '[REDACTED]')}`);

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('API quota exceeded or invalid API key');
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json() as YouTubeSearchResponse;

      if (!data.items) {
        return [];
      }

      const results = data.items.map(item => this.mapResult(item));
      return this.normalizeResults(results, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('search-provider', 'YouTube search failed', { error: message });
      throw error;
    }
  }

  /**
   * Map sort option to API parameter
   */
  private mapSort(sort: string): string {
    switch (sort) {
      case 'date':
        return 'date';
      case 'votes':
        return 'viewCount';
      case 'relevance':
      default:
        return 'relevance';
    }
  }

  /**
   * Map API response to SearchResult
   */
  private mapResult(item: YouTubeVideo): SearchResult {
    const videoUrl = `https://www.youtube.com/watch?v=${item.id.videoId}`;

    return {
      title: item.snippet.title,
      url: videoUrl,
      snippet: item.snippet.description?.substring(0, 200) || '',
      content: this.formatContent(item),
      engine: this.name,
      metadata: {
        videoId: item.id.videoId,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url
      }
    };
  }

  /**
   * Format video content for display
   */
  private formatContent(item: YouTubeVideo): string {
    const lines: string[] = [
      `# ${item.snippet.title}`,
      '',
      item.snippet.description || '*No description available*',
      '',
      `**Channel**: ${item.snippet.channelTitle}`,
      `**Published**: ${new Date(item.snippet.publishedAt).toLocaleDateString()}`,
      '',
      `[Watch on YouTube](https://www.youtube.com/watch?v=${item.id.videoId})`
    ];

    return lines.join('\n');
  }

  protected async healthCheck(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('YOUTUBE_API_KEY not configured');
    }

    // Do a minimal search to verify API key works
    const params = new URLSearchParams({
      q: 'test',
      part: 'snippet',
      maxResults: '1',
      key: this.apiKey,
      type: 'video'
    });

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/search?${params}`,
      {},
      5000
    );

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
  }

  /**
   * Fetch transcript from a YouTube video
   * Uses scraping approach - no API key required
   *
   * @param videoIdOrUrl - YouTube video ID or full URL
   * @param options - Optional configuration
   * @returns Transcript result with text and metadata
   */
  async fetchTranscript(
    videoIdOrUrl: string,
    options: TranscriptFetchOptions = {}
  ): Promise<TranscriptResult> {
    const { lang, includeTimestamps = false } = options;

    log.debug('search-provider', `Fetching transcript for: ${videoIdOrUrl}`);

    try {
      const transcriptItems = await fetchTranscript(
        videoIdOrUrl,
        lang ? { lang } : undefined
      );

      if (!transcriptItems || transcriptItems.length === 0) {
        return {
          success: false,
          error: 'No transcript available for this video',
          videoId: this.extractVideoId(videoIdOrUrl)
        };
      }

      // Decode HTML entities in transcript text
      const decodeHtml = (text: string): string => {
        return text
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
      };

      // Format the transcript
      let formattedText: string;
      if (includeTimestamps) {
        formattedText = transcriptItems
          .map(item => {
            const timestamp = this.formatTimestamp(item.offset * 1000); // offset is in seconds
            return `[${timestamp}] ${decodeHtml(item.text)}`;
          })
          .join('\n');
      } else {
        formattedText = transcriptItems
          .map(item => decodeHtml(item.text))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Note: offset and duration are in seconds in youtube-transcript-plus
      const lastItem = transcriptItems[transcriptItems.length - 1];
      const totalDurationMs = transcriptItems.length > 0
        ? (lastItem.offset + lastItem.duration) * 1000
        : 0;

      return {
        success: true,
        text: formattedText,
        videoId: this.extractVideoId(videoIdOrUrl),
        segmentCount: transcriptItems.length,
        totalDurationMs,
        language: transcriptItems[0]?.lang
      };
    } catch (error) {
      const videoId = this.extractVideoId(videoIdOrUrl);
      const message = error instanceof Error ? error.message : String(error);

      log.error('search-provider', `Transcript fetch failed for ${videoId}`, { error: message });

      // Provide helpful error messages based on error type
      let userMessage = message;
      if (error instanceof YoutubeTranscriptDisabledError) {
        userMessage = 'Transcripts are disabled for this video';
      } else if (error instanceof YoutubeTranscriptVideoUnavailableError) {
        userMessage = 'Video is unavailable or private';
      } else if (error instanceof YoutubeTranscriptNotAvailableError) {
        userMessage = 'No transcript available for this video';
      } else if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
        userMessage = `Requested language not available. ${message}`;
      }

      return {
        success: false,
        error: userMessage,
        videoId
      };
    }
  }

  /**
   * Extract video ID from URL or return as-is if already an ID
   */
  private extractVideoId(videoIdOrUrl: string): string {
    // Handle various YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];

    for (const pattern of patterns) {
      const match = videoIdOrUrl.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Return as-is if no pattern matches
    return videoIdOrUrl;
  }

  /**
   * Format milliseconds offset to timestamp string (HH:MM:SS or MM:SS)
   */
  private formatTimestamp(offsetMs: number): string {
    const totalSeconds = Math.floor(offsetMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

/**
 * Options for transcript fetching
 */
export interface TranscriptFetchOptions {
  /** Language code (e.g., 'en', 'es') */
  lang?: string;
  /** Include timestamps in output */
  includeTimestamps?: boolean;
}

/**
 * Result of transcript fetch operation
 */
export interface TranscriptResult {
  success: boolean;
  text?: string;
  error?: string;
  videoId: string;
  segmentCount?: number;
  totalDurationMs?: number;
  language?: string;
}

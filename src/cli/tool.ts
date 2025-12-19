/**
 * tx tool - CLI commands for search and web fetching
 *
 * Provides agents with access to specialized search providers and
 * robust URL fetching with archive fallback.
 */

import { search, listProviders, fetchUrls, healthCheck } from '../tools/search/index.ts';
import { YouTubeProvider, TranscriptResult } from '../tools/search/providers/youtube.ts';

export interface SearchOptions {
  source?: string;
  topic?: string;
  limit?: string;
  json?: boolean;
  providers?: boolean;
}

export interface GetWwwOptions {
  archive?: boolean;
  json?: boolean;
}

export interface TranscriptOptions {
  lang?: string;
  timestamps?: boolean;
  json?: boolean;
}

export interface ToolOptions {
  subcommand: string;
  args: string[];
  source?: string;
  topic?: string;
  limit?: string;
  archive?: boolean;
  json?: boolean;
  lang?: string;
  timestamps?: boolean;
  providers?: boolean;
}

/**
 * tx tool search [query] - Search multiple sources
 */
export async function toolSearch(query: string, options: SearchOptions = {}): Promise<void> {
  // Handle --providers flag (list providers instead of searching)
  if (options.providers) {
    await toolProviders({ json: options.json });
    return;
  }

  if (!query) {
    console.log('Usage: tx tool search [options] <query>');
    console.log('       tx tool search --providers');
    console.log('');
    console.log('Options:');
    console.log('  -s, --source <source>  Search specific source (stackoverflow, github, hackernews, arxiv, wikipedia)');
    console.log('  -t, --topic <topic>    Filter by topic category');
    console.log('  -n, --limit <n>        Limit results (default: 10)');
    console.log('  --providers            List available search providers');
    console.log('  --json                 JSON output');
    console.log('');
    console.log('Examples:');
    console.log('  tx tool search "typescript async await"');
    console.log('  tx tool search -s stackoverflow "react hooks"');
    console.log('  tx tool search -s arxiv "transformer attention mechanism"');
    console.log('  tx tool search --providers');
    return;
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 10;

  try {
    const results = await search(query, {
      source: options.source,
      topic: options.topic,
      limit
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`\n Found ${results.length} results:\n`);

    for (const result of results) {
      console.log(`📄 ${result.title}`);
      console.log(`   ${result.url}`);
      if (result.content) {
        const snippet = result.content.slice(0, 150).replace(/\n/g, ' ');
        console.log(`   ${snippet}${result.content.length > 150 ? '...' : ''}`);
      }
      if (result.engine) {
        console.log(`   [${result.engine}]`);
      }
      console.log('');
    }
  } catch (error) {
    console.error('Search failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * tx tool get-www <url> - Fetch URL content with archive fallback
 */
export async function toolGetWww(urls: string[], options: GetWwwOptions = {}): Promise<void> {
  if (urls.length === 0) {
    console.log('Usage: tx tool get-www [options] <url> [url2] [url3]...');
    console.log('');
    console.log('Options:');
    console.log('  -a, --archive    Try archive.is/archive.org first');
    console.log('  --json           JSON output');
    console.log('');
    console.log('Examples:');
    console.log('  tx tool get-www https://example.com/article');
    console.log('  tx tool get-www -a https://blocked-site.com/page');
    return;
  }

  try {
    const results = await fetchUrls(urls, { archive: options.archive });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    for (const result of results) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`URL: ${result.url}`);
      console.log(`Status: ${result.status}`);
      console.log(`Source: ${result.source}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      if (result.content) {
        console.log(result.content);
      } else if (result.error) {
        console.log(`Error: ${result.error}`);
      }
    }
  } catch (error) {
    console.error('Fetch failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * tx tool providers - List available search providers
 */
export async function toolProviders(options: { json?: boolean } = {}): Promise<void> {
  try {
    const providers = await listProviders();

    if (options.json) {
      console.log(JSON.stringify(providers, null, 2));
      return;
    }

    console.log('\nAvailable Search Providers:\n');

    for (const p of providers) {
      const status = p.available ? '✅' : '❌';
      const auth = p.requiresAuth ? '🔑' : '  ';
      console.log(`${status} ${auth} ${p.name.padEnd(15)} ${p.description}`);
      if (!p.available && p.reason) {
        console.log(`      └─ ${p.reason}`);
      }
    }

    console.log('');
    console.log('Legend: ✅ Available  ❌ Unavailable  🔑 Requires API key');
  } catch (error) {
    console.error('Failed to list providers:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * tx tool health [provider] - Check provider health
 */
export async function toolHealth(provider?: string, options: { json?: boolean } = {}): Promise<void> {
  try {
    const results = await healthCheck(provider || undefined);

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log('\nProvider Health Check:\n');

    for (const [name, health] of Object.entries(results)) {
      const status = health.healthy ? '✅' : '❌';
      console.log(`${status} ${name}`);
      if (!health.healthy && health.error) {
        console.log(`   └─ ${health.error}`);
      }
    }
  } catch (error) {
    console.error('Health check failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * tx tool youtube-transcript <video-id-or-url> - Fetch YouTube video transcript
 */
export async function toolYoutubeTranscript(
  videoIdOrUrl: string,
  options: TranscriptOptions = {}
): Promise<void> {
  if (!videoIdOrUrl) {
    console.log('Usage: tx tool youtube-transcript [options] <video-id-or-url>');
    console.log('');
    console.log('Options:');
    console.log('  -l, --lang <lang>    Language code (e.g., "en", "es")');
    console.log('  -T, --timestamps     Include timestamps in output');
    console.log('  --json               JSON output');
    console.log('');
    console.log('Examples:');
    console.log('  tx tool youtube-transcript https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    console.log('  tx tool youtube-transcript dQw4w9WgXcQ');
    console.log('  tx tool youtube-transcript -T dQw4w9WgXcQ');
    console.log('  tx tool youtube-transcript -l es dQw4w9WgXcQ');
    return;
  }

  const youtubeProvider = new YouTubeProvider();

  try {
    const result: TranscriptResult = await youtubeProvider.fetchTranscript(videoIdOrUrl, {
      lang: options.lang,
      includeTimestamps: options.timestamps
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      console.error(`Video ID: ${result.videoId}`);
      process.exit(1);
    }

    // Print header info
    console.log(`\n📺 YouTube Transcript`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Video ID: ${result.videoId}`);
    if (result.language) {
      console.log(`Language: ${result.language}`);
    }
    if (result.segmentCount) {
      console.log(`Segments: ${result.segmentCount}`);
    }
    if (result.totalDurationMs) {
      const mins = Math.floor(result.totalDurationMs / 60000);
      const secs = Math.floor((result.totalDurationMs % 60000) / 1000);
      console.log(`Duration: ${mins}m ${secs}s`);
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Print transcript
    console.log(result.text);
  } catch (error) {
    console.error('Transcript fetch failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Main tool command dispatcher
 */
export async function tool(options: ToolOptions): Promise<void> {
  const { subcommand, args } = options;

  switch (subcommand) {
    case 'search':
      await toolSearch(args.join(' '), {
        source: options.source,
        topic: options.topic,
        limit: options.limit,
        json: options.json,
        providers: options.providers
      });
      break;

    case 'get-www':
      await toolGetWww(args, {
        archive: options.archive,
        json: options.json
      });
      break;

    case 'health':
      await toolHealth(args[0], { json: options.json });
      break;

    case 'youtube-transcript':
    case 'yt-transcript':
      await toolYoutubeTranscript(args[0], {
        lang: options.lang,
        timestamps: options.timestamps,
        json: options.json
      });
      break;

    default:
      console.log(`
tx tool - Search and web fetching utilities

Commands:
  tx tool search <query>           Search multiple sources
  tx tool search --providers       List available search providers
  tx tool get-www <url>            Fetch URL with archive fallback
  tx tool youtube-transcript <id>  Fetch YouTube video transcript
  tx tool health [provider]        Check provider health

Search options:
  -s, --source <source>      Search specific source
  -t, --topic <topic>        Filter by topic
  -n, --limit <n>            Limit results (default: 10)
  --providers                List available search providers

Get-www options:
  -a, --archive              Try archive.is/archive.org first

YouTube transcript options:
  -l, --lang <lang>          Language code (e.g., "en", "es")
  -T, --timestamps           Include timestamps in output

Common options:
  --json                     JSON output

Examples:
  tx tool search "typescript generics"
  tx tool search -s stackoverflow "react hooks"
  tx tool search -s arxiv "attention mechanism"
  tx tool search --providers
  tx tool get-www https://example.com/article
  tx tool get-www -a https://blocked-site.com/page
  tx tool youtube-transcript dQw4w9WgXcQ
  tx tool youtube-transcript -T https://www.youtube.com/watch?v=VIDEO_ID
  tx tool health stackoverflow
`);
  }
}

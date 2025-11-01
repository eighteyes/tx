const axios = require('axios');
const { Logger } = require('../logger');
const { WebScraper } = require('./web-scraper');
const { HeadlessChrome } = require('./headless-chrome');

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:12321';

// Proper user agents for realistic requests
const USER_AGENTS = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
};

class Search {
  /**
   * Main search method supporting multiple sources
   * @param {string} searchTerm - The search query
   * @param {string|string[]|null} sites - Optional site(s) to search (string, array of strings, or null for default)
   * @param {array} categories - Categories for SearXNG (default: ['general'])
   * @param {number} limit - Result limit (default: 10)
   */
  static async query(searchTerm, sites = null, categories = ['general'], limit = 10) {
    try {
      // Normalize sites to array
      const siteList = sites ?
        (Array.isArray(sites) ? sites : [sites]) :
        null;

      Logger.log('search', `Searching: ${searchTerm}`, {
        sites: siteList,
        categories,
        limit
      });

      let results = [];

      if (siteList) {
        // Site-specific search(es)
        const searchPromises = siteList.map(site =>
          Search._searchSite(site, searchTerm, limit)
        );
        const searchResults = await Promise.all(searchPromises);
        results = searchResults.flat().slice(0, limit);
      } else {
        // Try SearXNG first with categories/topics
        results = await Search._searchSearXNG(searchTerm, categories, limit);

        // If SearXNG fails or returns no results, try individual API sources sequentially
        if (results.length === 0) {
          Logger.log('search', 'SearXNG returned no results, trying individual API sources');

          // Try free APIs first
          const apiSources = [
            { name: 'duckduckgo', fn: Search._searchDuckDuckGo },
            { name: 'stackoverflow', fn: Search._searchStackOverflow },
            { name: 'reddit', fn: Search._searchReddit },
            { name: 'github', fn: Search._searchGitHub },
            { name: 'hackernews', fn: Search._searchHackerNews },
            { name: 'arxiv', fn: Search._searchArxiv }
          ];

          // Try each API source until we get results
          for (const source of apiSources) {
            try {
              Logger.log('search', `Trying ${source.name}...`);
              const apiResults = await source.fn(searchTerm, limit);
              if (apiResults.length > 0) {
                Logger.log('search', `${source.name} returned ${apiResults.length} results`);
                results = apiResults;
                break;
              }
            } catch (error) {
              Logger.warn('search', `${source.name} failed: ${error.message}`);
            }
          }

          // If still no results, try premium APIs if configured
          if (results.length === 0) {
            if (process.env.BRAVE_API_KEY) {
              try {
                Logger.log('search', 'Trying Brave API...');
                results = await Search._searchBrave(searchTerm, limit);
                if (results.length > 0) {
                  Logger.log('search', `Brave returned ${results.length} results`);
                }
              } catch (error) {
                Logger.warn('search', `Brave API failed: ${error.message}`);
              }
            }

            if (results.length === 0 && process.env.TAVILY_API_KEY) {
              try {
                Logger.log('search', 'Trying Tavily API...');
                results = await Search._searchTavily(searchTerm, limit);
                if (results.length > 0) {
                  Logger.log('search', `Tavily returned ${results.length} results`);
                }
              } catch (error) {
                Logger.warn('search', `Tavily API failed: ${error.message}`);
              }
            }

            if (results.length === 0 && process.env.EXA_API_KEY) {
              try {
                Logger.log('search', 'Trying Exa API...');
                results = await Search._searchExa(searchTerm, limit);
                if (results.length > 0) {
                  Logger.log('search', `Exa returned ${results.length} results`);
                }
              } catch (error) {
                Logger.warn('search', `Exa API failed: ${error.message}`);
              }
            }
          }
        }
      }

      Logger.log('search', `Found ${results.length} results`, {
        searchTerm,
        sites: siteList,
        count: results.length
      });

      return results;
    } catch (error) {
      Logger.error('search', `Search failed: ${error.message}`, {
        searchTerm,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Route to specific site search
   */
  static async _searchSite(site, query, limit) {
    switch (site) {
      case 'reddit':
        return await Search._searchReddit(query, limit);
      case 'stackoverflow':
      case 'stack-overflow':
      case 'so':
        return await Search._searchStackOverflow(query, limit);
      case 'arxiv':
        return await Search._searchArxiv(query, limit);
      case 'github':
        return await Search._searchGitHub(query, limit);
      case 'duckduckgo':
      case 'ddg':
        return await Search._searchDuckDuckGo(query, limit);
      case 'brave':
        return await Search._searchBrave(query, limit);
      case 'hackernews':
      case 'hn':
        return await Search._searchHackerNews(query, limit);
      case 'pubmed':
        return await Search._searchPubMed(query, limit);
      case 'openlibrary':
      case 'books':
        return await Search._searchOpenLibrary(query, limit);
      case 'tavily':
        return await Search._searchTavily(query, limit);
      case 'exa':
        return await Search._searchExa(query, limit);
      case 'newsapi':
      case 'news':
        return await Search._searchNewsAPI(query, limit);
      case 'bing':
        return await Search._searchBing(query, limit);
      case 'youtube':
        return await Search._searchYouTube(query, limit);
      case 'twitter':
      case 'x':
        return await Search._searchTwitter(query, limit);
      case 'mastodon':
        return await Search._searchMastodon(query, limit);
      case 'bluesky':
        return await Search._searchBluesky(query, limit);
      case 'google-books':
      case 'books':
        return await Search._searchGoogleBooks(query, limit);
      case 'google-scholar':
      case 'scholar':
        return await Search._searchGoogleScholar(query, limit);
      case 'core':
        return await Search._searchCORE(query, limit);
      case 'crossref':
        return await Search._searchCrossRef(query, limit);
      case 'semantic-scholar':
      case 'semscholar':
        return await Search._searchSemanticScholar(query, limit);
      case 'ssrn':
        return await Search._searchSSRN(query, limit);
      case 'wikipedia':
      case 'wiki':
        return await Search._searchWikipedia(query, limit);
      case 'wikidata':
        return await Search._searchWikidata(query, limit);
      case 'archive':
      case 'archive.org':
        return await Search._searchArchive(query, limit);
      case 'wayback':
      case 'wayback-machine':
        return await Search._searchWayback(query, limit);
      case 'medium':
        return await Search._searchMedium(query, limit);
      case 'substack':
        return await Search._searchSubstack(query, limit);
      case 'devto':
      case 'dev.to':
      case 'dev':
        return await Search._searchDevTo(query, limit);
      default:
        Logger.warn('search', `Unknown site: ${site}`);
        return [];
    }
  }

  // ========== FREE/NO-KEY APIS ==========

  static async _searchReddit(query, limit) {
    try {
      const response = await axios.get('https://api.pushshift.io/reddit/search/submission/', {
        params: {
          q: query,
          size: limit,
          sort: 'desc',
          sort_type: 'score'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.data) return [];

      return response.data.data.map(post => ({
        url: `https://reddit.com${post.permalink}`,
        title: post.title || 'Reddit Post',
        content: post.selftext?.substring(0, 200) || `Subreddit: r/${post.subreddit}`,
        engine: 'reddit',
        score: post.score,
        subreddit: post.subreddit
      }));
    } catch (error) {
      Logger.warn('search', `Reddit search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchStackOverflow(query, limit) {
    try {
      const response = await axios.get('https://api.stackexchange.com/2.3/search', {
        params: {
          intitle: query,
          site: 'stackoverflow',
          sort: 'votes',
          order: 'desc',
          pagesize: limit
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.items) return [];

      return response.data.items.map(item => ({
        url: item.link,
        title: item.title || 'Stack Overflow Question',
        content: `Score: ${item.score} | Answers: ${item.answer_count}`,
        engine: 'stackoverflow',
        score: item.score,
        answers: item.answer_count
      }));
    } catch (error) {
      Logger.warn('search', `Stack Overflow search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchArxiv(query, limit) {
    try {
      const response = await axios.get('http://export.arxiv.org/api/query', {
        params: {
          search_query: `all:${query}`,
          start: 0,
          max_results: limit,
          sortBy: 'relevance',
          sortOrder: 'descending'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      const entries = response.data.match(/<entry>[\s\S]*?<\/entry>/g) || [];

      return entries.slice(0, limit).map(entry => {
        const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
        const idMatch = entry.match(/<id>http:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/);
        const summaryMatch = entry.match(/<summary>([^<]+)<\/summary>/);
        const dateMatch = entry.match(/<published>([^T]+)/);

        return {
          url: idMatch ? `https://arxiv.org/abs/${idMatch[1]}` : '',
          title: titleMatch ? titleMatch[1].trim() : 'arXiv Paper',
          content: summaryMatch ? summaryMatch[1].trim().substring(0, 200) : 'Academic paper',
          engine: 'arxiv',
          date: dateMatch ? dateMatch[1] : ''
        };
      }).filter(r => r.url);
    } catch (error) {
      Logger.warn('search', `arXiv search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchGitHub(query, limit) {
    try {
      const token = process.env.GITHUB_TOKEN;
      const headers = {
        'User-Agent': USER_AGENTS.chrome,
        'Accept': 'application/vnd.github.v3+json'
      };

      if (token) {
        headers['Authorization'] = `token ${token}`;
      }

      const response = await axios.get('https://api.github.com/search/repositories', {
        params: {
          q: query,
          sort: 'stars',
          order: 'desc',
          per_page: limit
        },
        timeout: 10000,
        headers
      });

      if (!response.data.items) return [];

      return response.data.items.map(repo => ({
        url: repo.html_url,
        title: repo.full_name,
        content: repo.description || 'GitHub repository',
        engine: 'github',
        stars: repo.stargazers_count,
        language: repo.language
      }));
    } catch (error) {
      Logger.warn('search', `GitHub search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchDuckDuckGo(query, limit) {
    try {
      const response = await axios.get('https://api.duckduckgo.com/', {
        params: {
          q: query,
          format: 'json',
          no_redirect: 1,
          no_html: 1
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      const results = [];

      if (response.data.Results && Array.isArray(response.data.Results)) {
        response.data.Results.forEach(result => {
          if (result.FirstURL && result.Text && results.length < limit) {
            results.push({
              url: result.FirstURL,
              title: result.Text || 'Result',
              content: result.Text || '',
              engine: 'duckduckgo'
            });
          }
        });
      }

      if (response.data.RelatedTopics && Array.isArray(response.data.RelatedTopics)) {
        response.data.RelatedTopics.forEach(topic => {
          if (topic.FirstURL && results.length < limit) {
            results.push({
              url: topic.FirstURL,
              title: topic.Text || topic.Result || 'Result',
              content: topic.Text || '',
              engine: 'duckduckgo'
            });
          }
        });
      }

      return results;
    } catch (error) {
      Logger.warn('search', `DuckDuckGo search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchHackerNews(query, limit) {
    try {
      const response = await axios.get('https://hn.algolia.com/api/v1/search', {
        params: {
          query: query,
          hitsPerPage: limit,
          advancedSyntax: true
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.hits) return [];

      return response.data.hits.map(hit => ({
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        title: hit.title || 'Hacker News Post',
        content: `Points: ${hit.points} | Comments: ${hit.num_comments}`,
        engine: 'hackernews',
        score: hit.points
      }));
    } catch (error) {
      Logger.warn('search', `HackerNews search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchPubMed(query, limit) {
    try {
      const response = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
        params: {
          db: 'pubmed',
          term: query,
          retmax: limit,
          rettype: 'json'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.esearchresult?.idlist) return [];

      return response.data.esearchresult.idlist.map((id, idx) => ({
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        title: `PubMed Article ${idx + 1}`,
        content: 'Medical/scientific research article',
        engine: 'pubmed',
        pmid: id
      }));
    } catch (error) {
      Logger.warn('search', `PubMed search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchOpenLibrary(query, limit) {
    try {
      const response = await axios.get('https://openlibrary.org/search.json', {
        params: {
          q: query,
          limit: limit
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.docs) return [];

      return response.data.docs.map(doc => ({
        url: `https://openlibrary.org${doc.key}`,
        title: doc.title || 'Book',
        content: `Author: ${doc.author_name?.[0] || 'Unknown'} | Year: ${doc.first_publish_year || 'N/A'}`,
        engine: 'openlibrary',
        author: doc.author_name?.[0]
      }));
    } catch (error) {
      Logger.warn('search', `OpenLibrary search failed: ${error.message}`);
      return [];
    }
  }

  // ========== FREEMIUM APIS (with optional keys) ==========

  static async _searchBrave(query, limit) {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      Logger.warn('search', 'Brave Search API key not configured');
      return [];
    }

    try {
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: {
          q: query,
          count: limit
        },
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        },
        timeout: 10000
      });

      if (!response.data.web?.results) return [];

      return response.data.web.results.map(result => ({
        url: result.url,
        title: result.title || 'Brave Result',
        content: result.description || '',
        engine: 'brave'
      }));
    } catch (error) {
      Logger.warn('search', `Brave search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchTavily(query, limit) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      Logger.warn('search', 'Tavily API key not configured');
      return [];
    }

    try {
      const response = await axios.post('https://api.tavily.com/search', {
        api_key: apiKey,
        query: query,
        max_results: limit,
        include_answer: true
      }, {
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.results) return [];

      return response.data.results.map(result => ({
        url: result.url,
        title: result.title || 'Tavily Result',
        content: result.content || '',
        engine: 'tavily',
        score: result.score
      }));
    } catch (error) {
      Logger.warn('search', `Tavily search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchExa(query, limit) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      Logger.warn('search', 'Exa API key not configured');
      return [];
    }

    try {
      const response = await axios.post('https://api.exa.ai/search', {
        query: query,
        numResults: limit,
        useAutoprompt: true
      }, {
        headers: {
          'x-api-key': apiKey,
          'User-Agent': USER_AGENTS.chrome
        },
        timeout: 10000
      });

      if (!response.data.results) return [];

      return response.data.results.map(result => ({
        url: result.url,
        title: result.title || 'Exa Result',
        content: result.text || '',
        engine: 'exa',
        score: result.score
      }));
    } catch (error) {
      Logger.warn('search', `Exa search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchNewsAPI(query, limit) {
    const apiKey = process.env.NEWSAPI_KEY;
    if (!apiKey) {
      Logger.warn('search', 'NewsAPI key not configured');
      return [];
    }

    try {
      const response = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: query,
          pageSize: limit,
          sortBy: 'relevancy'
        },
        headers: {
          'X-API-Key': apiKey,
          'User-Agent': USER_AGENTS.chrome
        },
        timeout: 10000
      });

      if (!response.data.articles) return [];

      return response.data.articles.map(article => ({
        url: article.url,
        title: article.title || 'News Article',
        content: article.description || article.content?.substring(0, 200) || '',
        engine: 'newsapi',
        source: article.source.name
      }));
    } catch (error) {
      Logger.warn('search', `NewsAPI search failed: ${error.message}`);
      return [];
    }
  }

  // ========== PAID APIS (with required keys) ==========

  static async _searchBing(query, limit) {
    // Try w3m parsing first (free, no API key needed)
    const w3mResults = await Search._searchBingW3M(query, limit);
    if (w3mResults.length > 0) {
      return w3mResults;
    }

    // Fallback to API if w3m fails
    const apiKey = process.env.BING_SEARCH_KEY;
    if (!apiKey) {
      Logger.warn('search', 'Bing Search: w3m failed and no API key configured');
      return [];
    }

    return await Search._searchBingAPI(query, limit, apiKey);
  }

  static async _searchBingW3M(query, limit) {
    try {
      Logger.log('search', `Attempting Bing search via w3m: ${query}`);

      const { execSync } = require('child_process');
      const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

      // Fetch and render with w3m (text-based browser)
      const output = execSync(`w3m -dump "${bingUrl}" 2>/dev/null || echo ""`, {
        timeout: 15000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (!output || output.length < 100) {
        Logger.warn('search', 'w3m output too small or empty');
        return [];
      }

      // Also try to get HTML for parsing
      const htmlOutput = execSync(`w3m -dump_head "${bingUrl}" 2>/dev/null || echo ""`, {
        timeout: 15000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const $ = require('cheerio').load(htmlOutput || output);
      const results = [];

      // Parse Bing search result structure
      // Bing typically uses these selectors for results
      const selectors = [
        'h2 > a',           // Main result title links
        '.b_title > a',     // Alternative title selector
        'li.b_algo a[href]' // Result list items
      ];

      for (const selector of selectors) {
        $(selector).each((i, el) => {
          if (results.length >= limit) return;

          const href = $(el).attr('href');
          const title = $(el).text();

          // Filter out Bing navigation and non-result links
          if (href && title && !href.includes('bing.com') && href.startsWith('http')) {
            const existing = results.find(r => r.url === href);
            if (!existing) {
              results.push({
                url: href,
                title: title.substring(0, 100),
                content: 'Bing search result',
                engine: 'bing'
              });
            }
          }
        });

        if (results.length >= limit) break;
      }

      if (results.length > 0) {
        Logger.log('search', `w3m found ${results.length} Bing results`);
        return results.slice(0, limit);
      }

      Logger.warn('search', 'w3m: No results parsed from Bing');
      return [];
    } catch (error) {
      Logger.warn('search', `w3m Bing search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchBingAPI(query, limit, apiKey) {
    try {
      Logger.log('search', `Searching Bing via API: ${query}`);

      const response = await axios.get('https://api.bing.microsoft.com/v7.0/search', {
        params: {
          q: query,
          count: limit
        },
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'User-Agent': USER_AGENTS.chrome
        },
        timeout: 10000
      });

      if (!response.data.webPages?.value) return [];

      return response.data.webPages.value.map(result => ({
        url: result.url,
        title: result.name || 'Bing Result',
        content: result.snippet || '',
        engine: 'bing'
      }));
    } catch (error) {
      Logger.warn('search', `Bing API search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchYouTube(query, limit) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      Logger.warn('search', 'YouTube API key not configured');
      return [];
    }

    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          q: query,
          part: 'snippet',
          maxResults: limit,
          key: apiKey,
          type: 'video'
        },
        timeout: 10000
      });

      if (!response.data.items) return [];

      return response.data.items.map(item => ({
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        title: item.snippet.title || 'YouTube Video',
        content: item.snippet.description?.substring(0, 200) || '',
        engine: 'youtube',
        channelId: item.snippet.channelId
      }));
    } catch (error) {
      Logger.warn('search', `YouTube search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchTwitter(query, limit) {
    const bearerToken = process.env.TWITTER_BEARER_TOKEN;
    if (!bearerToken) {
      Logger.warn('search', 'Twitter API bearer token not configured');
      return [];
    }

    try {
      const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
        params: {
          query: query,
          max_results: Math.min(limit, 100),
          'tweet.fields': 'created_at,author_id,public_metrics'
        },
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'User-Agent': USER_AGENTS.chrome
        },
        timeout: 10000
      });

      if (!response.data.data) return [];

      return response.data.data.map(tweet => ({
        url: `https://twitter.com/i/web/status/${tweet.id}`,
        title: tweet.text?.substring(0, 100) || 'Tweet',
        content: tweet.text || '',
        engine: 'twitter',
        likes: tweet.public_metrics?.like_count,
        retweets: tweet.public_metrics?.retweet_count
      }));
    } catch (error) {
      Logger.warn('search', `Twitter search failed: ${error.message}`);
      return [];
    }
  }

  // ========== GOOGLE APIS ==========

  static async _searchGoogleBooks(query, limit) {
    try {
      const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
        params: {
          q: query,
          maxResults: limit,
          printType: 'books'
        },
        timeout: 10000
      });

      if (!response.data.items) return [];

      return response.data.items.map(item => ({
        url: item.volumeInfo.infoLink || `https://books.google.com/books?id=${item.id}`,
        title: item.volumeInfo.title || 'Book',
        content: `Author: ${item.volumeInfo.authors?.[0] || 'Unknown'} | Published: ${item.volumeInfo.publishedDate || 'N/A'}`,
        engine: 'google-books',
        author: item.volumeInfo.authors?.[0],
        description: item.volumeInfo.description?.substring(0, 200)
      }));
    } catch (error) {
      Logger.warn('search', `Google Books search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchGoogleScholar(query, limit) {
    try {
      const results = await WebScraper.scrapeCustom(
        'https://scholar.google.com/scholar',
        ($, html) => {
          const items = [];
          $('div[data-rp]').each((i, el) => {
            if (items.length >= limit) return;

            const titleEl = $(el).find('h3 a');
            const title = titleEl.text();
            const url = titleEl.attr('href');
            const snippet = $(el).find('.gs_rs').text();
            const citationsMatch = html.substring(html.indexOf(el)).match(/Cited by (\d+)/);
            const citations = citationsMatch ? parseInt(citationsMatch[1]) : 0;

            if (title && url) {
              items.push({
                url: url,
                title: title,
                content: snippet?.substring(0, 200) || 'Academic research article',
                engine: 'google-scholar',
                citations: citations
              });
            }
          });
          return items;
        },
        {
          params: { q: query, num: limit },
          name: 'google-scholar'
        }
      );

      return results;
    } catch (error) {
      Logger.warn('search', `Google Scholar search failed: ${error.message}`);
      return [];
    }
  }

  // ========== ACADEMIC RESEARCH APIS ==========

  static async _searchCORE(query, limit) {
    try {
      const response = await axios.get('https://core.ac.uk/api-v2/articles/search', {
        params: {
          q: query,
          limit: limit
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.data) return [];

      return response.data.data.map(article => ({
        url: article.url || `https://core.ac.uk/display/${article.id}`,
        title: article.title || 'CORE Article',
        content: article.abstract?.substring(0, 200) || 'Academic article',
        engine: 'core',
        year: article.publishedDate
      }));
    } catch (error) {
      Logger.warn('search', `CORE search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchCrossRef(query, limit) {
    try {
      const response = await axios.get('https://api.crossref.org/works', {
        params: {
          query: query,
          rows: limit
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.message?.items) return [];

      return response.data.message.items.map(item => ({
        url: item.URL || `https://doi.org/${item.DOI}`,
        title: item.title?.[0] || 'CrossRef Item',
        content: `DOI: ${item.DOI} | Published: ${item.published?.['date-parts']?.[0]?.join('-') || 'N/A'}`,
        engine: 'crossref',
        doi: item.DOI
      }));
    } catch (error) {
      Logger.warn('search', `CrossRef search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchSemanticScholar(query, limit) {
    try {
      const response = await axios.get('https://api.semanticscholar.org/graph/v1/paper/search', {
        params: {
          query: query,
          limit: limit,
          fields: 'title,abstract,url,citationCount'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.data) return [];

      return response.data.data.map(paper => ({
        url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
        title: paper.title || 'Semantic Scholar Paper',
        content: paper.abstract?.substring(0, 200) || 'Research paper',
        engine: 'semantic-scholar',
        citations: paper.citationCount
      }));
    } catch (error) {
      Logger.warn('search', `Semantic Scholar search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchSSRN(query, limit) {
    try {
      const response = await axios.get('https://papers.ssrn.com/sol3/papers.cfm', {
        params: {
          abstract_id: query,
          _ajax_nonce: 'search'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      // SSRN requires web scraping - use WebScraper
      return await WebScraper.scrapeCustom(
        'https://papers.ssrn.com/sol3/Rsrch_results.cfm',
        ($) => {
          const items = [];
          $('div.search-result').each((i, el) => {
            if (items.length >= limit) return;

            const titleEl = $(el).find('h3 a');
            const title = titleEl.text();
            const url = titleEl.attr('href');
            const abstract = $(el).find('p.abstract').text();

            if (title && url) {
              items.push({
                url: `https://ssrn.com${url}`,
                title: title,
                content: abstract?.substring(0, 200) || 'SSRN paper',
                engine: 'ssrn'
              });
            }
          });
          return items;
        },
        {
          params: { pn: 1, kw: query },
          name: 'ssrn'
        }
      );
    } catch (error) {
      Logger.warn('search', `SSRN search failed: ${error.message}`);
      return [];
    }
  }

  // ========== KNOWLEDGE/REFERENCE APIS ==========

  static async _searchWikipedia(query, limit) {
    try {
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          srlimit: limit,
          format: 'json'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.query?.search) return [];

      return response.data.query.search.map(item => ({
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
        title: item.title,
        content: item.snippet?.replace(/<[^>]*>/g, '')?.substring(0, 200) || 'Wikipedia article',
        engine: 'wikipedia'
      }));
    } catch (error) {
      Logger.warn('search', `Wikipedia search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchWikidata(query, limit) {
    try {
      const response = await axios.get('https://www.wikidata.org/w/api.php', {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          srlimit: limit,
          srnamespace: 0,
          format: 'json'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.query?.search) return [];

      return response.data.query.search.map(item => ({
        url: `https://www.wikidata.org/wiki/${item.title}`,
        title: item.title,
        content: item.snippet?.replace(/<[^>]*>/g, '')?.substring(0, 200) || 'Wikidata item',
        engine: 'wikidata'
      }));
    } catch (error) {
      Logger.warn('search', `Wikidata search failed: ${error.message}`);
      return [];
    }
  }

  // ========== INTERNET ARCHIVE APIS ==========

  static async _searchArchive(query, limit) {
    try {
      const response = await axios.get('https://archive.org/advancedsearch.php', {
        params: {
          q: query,
          output: 'json',
          rows: limit
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.response?.docs) return [];

      return response.data.response.docs.slice(0, limit).map(doc => ({
        url: `https://archive.org/details/${doc.identifier}`,
        title: doc.title?.[0] || doc.identifier || 'Archive.org Item',
        content: `Type: ${doc.mediatype} | ${doc.description?.[0]?.substring(0, 150) || 'Archived content'}`,
        engine: 'archive',
        type: doc.mediatype,
        identifier: doc.identifier
      }));
    } catch (error) {
      Logger.warn('search', `Archive.org search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchWayback(query, limit) {
    try {
      // Wayback Machine CDX API for searching snapshots
      const response = await axios.get('https://archive.org/advancedsearch.php', {
        params: {
          q: `url:${query}`,
          output: 'json',
          rows: limit
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.response?.docs) return [];

      return response.data.response.docs.slice(0, limit).map(doc => ({
        url: `https://web.archive.org/web/${doc.timestamp}/${doc.original}`,
        title: doc.title || doc.original || 'Wayback Machine Snapshot',
        content: `Captured: ${doc.timestamp} | ${doc.statuscode === 200 ? 'Available' : 'Error ' + doc.statuscode}`,
        engine: 'wayback',
        original_url: doc.original,
        timestamp: doc.timestamp
      }));
    } catch (error) {
      Logger.warn('search', `Wayback Machine search failed: ${error.message}`);
      return [];
    }
  }

  // ========== CONTENT PLATFORMS ==========

  static async _searchMedium(query, limit) {
    // Try headless Chrome first for better results, fall back to Brave API
    const chromeResults = await Search._searchMediumHeadlessChrome(query, limit);
    if (chromeResults.length > 0) {
      return chromeResults;
    }

    // Fallback to Brave API
    return await Search._searchMediumBrave(query, limit);
  }

  static async _searchMediumHeadlessChrome(query, limit) {
    try {
      Logger.log('search', `Attempting Medium search via headless Chrome: ${query}`);

      const searchUrl = `https://medium.com/search?q=${encodeURIComponent(query)}`;

      const results = await HeadlessChrome.fetchAndExtract(searchUrl, {
        selectors: 'a[href*="/@"]',
        limit,
        dedupeKey: 'url',
        extractFn: ($, el) => {
          const href = $(el).attr('href');
          const title = $(el).text().trim();

          if (href && title) {
            return {
              url: `https://medium.com${href}`,
              title: title.substring(0, 100),
              content: 'Medium article',
              engine: 'medium'
            };
          }
          return null;
        }
      });

      if (results.length > 0) {
        Logger.log('search', `Headless Chrome found ${results.length} Medium articles`);
        return results;
      }

      return [];
    } catch (error) {
      Logger.warn('search', `Medium headless Chrome search failed: ${error.message}. Will fall back to Brave API.`);
      return [];
    }
  }

  static async _searchMediumBrave(query, limit) {
    try {
      Logger.log('search', `Searching Medium via Brave: ${query}`);

      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        Logger.warn('search', 'Medium search requires Brave API key (BRAVE_API_KEY) or working Puppeteer');
        return [];
      }

      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: {
          q: `site:medium.com ${query}`,
          count: limit
        },
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
          'User-Agent': USER_AGENTS.chrome
        },
        timeout: 10000
      });

      if (!response.data.web?.results) return [];

      return response.data.web.results.map(result => ({
        url: result.url,
        title: result.title || 'Medium Article',
        content: result.description?.substring(0, 200) || 'Medium article',
        engine: 'medium'
      }));
    } catch (error) {
      Logger.warn('search', `Medium Brave search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchSubstack(query, limit) {
    // Try headless Chrome first for better results, fall back to Brave API
    const chromeResults = await Search._searchSubstackHeadlessChrome(query, limit);
    if (chromeResults.length > 0) {
      return chromeResults;
    }

    // Fallback to Brave API
    return await Search._searchSubstackBrave(query, limit);
  }

  static async _searchSubstackHeadlessChrome(query, limit) {
    try {
      Logger.log('search', `Attempting Substack search via headless Chrome: ${query}`);

      const searchUrl = `https://substack.com/search/${encodeURIComponent(query)}`;

      const results = await HeadlessChrome.fetchAndExtract(searchUrl, {
        selectors: 'a[href*="substack.com"]',
        limit,
        dedupeKey: 'url',
        extractFn: ($, el) => {
          const href = $(el).attr('href');
          const title = $(el).text().trim();

          // Filter out login pages and navigation links
          if (href && title && !href.includes('substack.com/login') && !href.includes('/settings')) {
            return {
              url: href.startsWith('http') ? href : `https://substack.com${href}`,
              title: title.substring(0, 100),
              content: 'Substack article',
              engine: 'substack'
            };
          }
          return null;
        }
      });

      if (results.length > 0) {
        Logger.log('search', `Headless Chrome found ${results.length} Substack articles`);
        return results;
      }

      return [];
    } catch (error) {
      Logger.warn('search', `Substack headless Chrome search failed: ${error.message}. Will fall back to Brave API.`);
      return [];
    }
  }

  static async _searchSubstackBrave(query, limit) {
    try {
      Logger.log('search', `Searching Substack via Brave: ${query}`);

      const apiKey = process.env.BRAVE_API_KEY;
      if (!apiKey) {
        Logger.warn('search', 'Substack search requires Brave API key (BRAVE_API_KEY) or working Puppeteer');
        return [];
      }

      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: {
          q: `site:substack.com ${query}`,
          count: limit
        },
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
          'User-Agent': USER_AGENTS.chrome
        },
        timeout: 10000
      });

      if (!response.data.web?.results) return [];

      return response.data.web.results.map(result => ({
        url: result.url,
        title: result.title || 'Substack Article',
        content: result.description?.substring(0, 200) || 'Substack article',
        engine: 'substack'
      }));
    } catch (error) {
      Logger.warn('search', `Substack Brave search failed: ${error.message}`);
      return [];
    }
  }

  static async _searchDevTo(query, limit) {
    try {
      const response = await axios.get('https://dev.to/api/articles', {
        params: {
          state: 'published',
          top: limit,
          tag: query
        },
        timeout: 10000,
        headers: {
          'User-Agent': USER_AGENTS.chrome
        }
      });

      if (!Array.isArray(response.data)) return [];

      return response.data.slice(0, limit).map(article => ({
        url: article.url,
        title: article.title || 'Dev.to Article',
        content: article.description?.substring(0, 200) || 'Dev article',
        engine: 'devto',
        author: article.user?.name,
        reactions: article.positive_reactions_count
      }));
    } catch (error) {
      // Try alternative approach with search
      try {
        const searchResponse = await axios.get('https://dev.to/api/articles/search', {
          params: {
            per_page: limit,
            query: query
          },
          timeout: 10000,
          headers: {
            'User-Agent': USER_AGENTS.chrome
          }
        });

        if (!Array.isArray(searchResponse.data)) return [];

        return searchResponse.data.slice(0, limit).map(article => ({
          url: article.url,
          title: article.title || 'Dev.to Article',
          content: article.description?.substring(0, 200) || 'Dev article',
          engine: 'devto',
          author: article.user?.name,
          reactions: article.positive_reactions_count
        }));
      } catch (err) {
        Logger.warn('search', `Dev.to search failed: ${err.message}`);
        return [];
      }
    }
  }

  // ========== FEDIVERSE APIS ==========

  static async _searchMastodon(query, limit) {
    const instance = process.env.MASTODON_INSTANCE || 'mastodon.social';
    const token = process.env.MASTODON_TOKEN;

    try {
      const headers = { 'User-Agent': USER_AGENTS.chrome };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await axios.get(`https://${instance}/api/v2/search`, {
        params: {
          q: query,
          type: 'statuses',
          limit: limit,
          resolve: true
        },
        timeout: 10000,
        headers
      });

      if (!response.data.statuses || response.data.statuses.length === 0) return [];

      return response.data.statuses.map(status => ({
        url: status.url,
        title: `${status.account.display_name || status.account.acct}`,
        content: status.content?.replace(/<[^>]*>/g, '').substring(0, 200) || 'Mastodon post',
        engine: 'mastodon',
        instance: instance,
        favourites: status.favourites_count
      }));
    } catch (error) {
      Logger.warn('search', `Mastodon search failed (401 Unauthorized - optional auth via MASTODON_TOKEN env var): ${error.message}`);
      return [];
    }
  }

  static async _searchBluesky(query, limit) {
    try {
      const response = await axios.get('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts', {
        params: {
          q: query,
          limit: limit,
          sort: 'latest'
        },
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      if (!response.data.posts) return [];

      return response.data.posts.map(post => ({
        url: `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`,
        title: `${post.author.displayName || post.author.handle}`,
        content: post.record.text?.substring(0, 200) || 'Bluesky post',
        engine: 'bluesky',
        likes: post.likeCount,
        replies: post.replyCount
      }));
    } catch (error) {
      Logger.warn('search', `Bluesky search failed: ${error.message}`);
      return [];
    }
  }

  // ========== FALLBACK SEARCHES ==========

  static async _searchSearXNG(searchTerm, categories = ['general'], limit = 10) {
    try {
      const response = await axios.get(`${SEARXNG_URL}/search`, {
        params: {
          q: searchTerm,
          categories: categories.join(','),
          format: 'json'
        },
        timeout: 30000,
        headers: { 'User-Agent': USER_AGENTS.chrome }
      });

      const results = response.data.results || [];

      return results.slice(0, limit).map(r => ({
        url: r.url,
        title: r.title || 'Search Result',
        content: r.content || '',
        engine: r.engine || 'searxng'
      }));
    } catch (error) {
      Logger.error('search', `SearXNG search failed: ${error.message}`, {
        searchTerm,
        error: error.message,
        searxngUrl: SEARXNG_URL
      });

      return await Search._fallback(searchTerm, limit);
    }
  }

  static async _fallback(searchTerm, limit) {
    Logger.warn('search', 'SearXNG unavailable, using DuckDuckGo fallback', {
      searchTerm
    });

    return await Search._searchDuckDuckGo(searchTerm, limit);
  }

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

  static formatResults(results) {
    return results
      .map(
        (r, i) => {
          const engineLabel = r.engine ? ` [${r.engine}]` : '';
          const metadata = r.score ? ` • Score: ${r.score}` : (r.stars ? ` • ⭐ ${r.stars}` : '');
          return `${i + 1}. ${r.title}${engineLabel}${metadata}\n   URL: ${r.url}\n   ${r.content.substring(0, 100)}...`;
        }
      )
      .join('\n\n');
  }
}

module.exports = { Search };

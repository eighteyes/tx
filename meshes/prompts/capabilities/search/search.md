# Search Capability

## Usage

Use the `tx search` command to find current, detailed, or reference information from multiple sources.

Account for "Today's Date". If user wants current or recent information, use 2025+, not 2024.

## Search Strategy
Broad query? Use the built in 'Web Search' tool.
Need details? Use `tx search`

Use a sequential fallback approach:
1. **SearXNG First** - Attempts search via SearXNG (local instance at port 12321) with optional topic/category filtering
2. **Individual API Fallbacks** - If SearXNG fails, tries individual sources sequentially until results are found:
   - DuckDuckGo → Stack Overflow → Reddit → GitHub → Hacker News → arXiv
3. **Premium APIs** - If configured and free APIs fail, tries Brave → Tavily → Exa

## Basic Usage

1. `tx tool search '[search terms]'` - Default search via SearXNG, with API fallbacks
2. `tx tool search -s <source> '[search terms]'` - Search specific source directly
3. `tx tool search -t <topic> '[search]'` - Search topic area (uses SearXNG categories)
4. Returns list of URLs / titles with source information
5. Use `tx tool get-www url [..url]` to read results
6. Use `tx tool get-www --js url` if you encounter a site that needs JavaScript
7. Use `tx tool get-www -a` to try an archived copy if 403 or other issues

## Topics

- `dev` - Use when looking up technical information
- `docs` - Use when searching for documentation
- `info` - Use when seeking general information
- `news` - Use when looking for news and current events
- `packages` - Use when searching for software packages
- `repos` - Use when looking for code repositories
- `science` - Use when searching for scientific content
- `files` - Use when searching for files
- `media` - Use when searching for media content (images, videos, etc.)
- `other` - Use for miscellaneous searches

## Sources

- `reddit` - Community perspectives, debugging tips, personal experiences
- `stackoverflow` (aliases: `stack-overflow`, `so`) - Code solutions, technical Q&A, best practices
- `arxiv` - Academic papers, research, theoretical foundations, ML/AI
- `github` - Code examples, libraries, open source implementations
- `duckduckgo` (alias: `ddg`) - General web search
- `hackernews` (alias: `hn`) - Tech news, discussions, startups
- `pubmed` - Medical and scientific research articles
- `openlibrary` (alias: `books`) - Book search and metadata
- `brave` - Modern search engine with privacy focus
- `tavily` - AI-optimized semantic search for agents
- `exa` - Semantic web search powered by AI
- `newsapi` (alias: `news`) - Current news aggregation
- `bing` - Microsoft's search service
- `youtube` - Video content search
- `twitter` (alias: `x`) - Recent tweets search
- `mastodon` - Federated social network posts
- `bluesky` - Decentralized social network posts
- `medium` - Engineering and technology articles (requires `BRAVE_API_KEY`)
- `substack` - Newsletters and publications (requires `BRAVE_API_KEY`)
- `devto` (aliases: `dev.to`, `dev`) - Developer blog posts and tutorials
- `google-books` - Book search and metadata
- `google-scholar` (alias: `scholar`) - Academic papers and citations
- `core` - 200M+ open access academic papers
- `crossref` - Bibliographic metadata for 120M+ scholarly works
- `semantic-scholar` (alias: `semscholar`) - AI-powered academic search
- `ssrn` - Social science research papers
- `wikipedia` (alias: `wiki`) - Encyclopedia articles
- `wikidata` - Structured knowledge graph
- `archive` (alias: `archive.org`) - Archived books, audio, video, software
- `wayback` (alias: `wayback-machine`) - Website snapshots and history

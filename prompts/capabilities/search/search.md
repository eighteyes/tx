# Search Capability

This agent has access to web search functionality via the `/search` command.

## Usage

Use the `/search` command to find information on the web:

```
/search <your query here>
```

## Examples

```
/search python async programming
/search climate change latest research
/search how to optimize database queries
```

## How It Works

- Sends your query to a SearXNG metasearch engine
- Returns top results with titles, URLs, and snippets
- Results are from multiple search engines combined
- Can search for any topic - news, research, documentation, etc.

## When to Use Search

- You need current information (beyond your training data)
- You're fact-checking claims
- You're researching a topic for analysis
- You need external documentation or examples
- You're looking for recent developments

## Tips

1. Be specific with queries - "python async/await" works better than "python async"
2. Include context - "best practices for API design 2024" better than "API design"
3. You can run multiple searches in one task
4. Search results include URLs you can reference in your response

## Integration

This capability is automatically loaded for agents with "search" in their capabilities list. The search tool is available via the integrated `/search` command.

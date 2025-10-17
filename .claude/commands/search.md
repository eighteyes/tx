# search - Web Search

Search the web using the integrated search tool (powered by SearXNG).

## Usage

```
/search <query>
```

## Examples

```
/search python async programming best practices
/search latest AI research papers 2024
/search how to optimize Node.js performance
```

## Behavior

- Queries SearXNG (meta search engine)
- Returns top results with title, URL, and snippet
- Results are formatted for easy reading
- Can be used multiple times per task

## Implementation Notes

- Search endpoint: `http://localhost:12321/search`
- Integrated via `lib/tools/search.js`
- Results limited to text search (web pages, documents)

## Related Commands

- `/ask` - Ask another agent a question

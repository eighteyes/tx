# Soul Navigator MCP Server

Fog-of-war navigation server for the opus-soul knowledge graph.

## Overview

This MCP server provides **stateless, node-by-node navigation** through the opus-soul knowledge graph. It implements the fog-of-war design: agents see only the current node and its immediate neighbors, with no overview or search capabilities.

**Key Principles:**
- **Fog of war** - See current node + immediate neighbors only
- **Full content** - Complete file content, no truncation
- **Bidirectional links** - Both outgoing AND incoming references
- **Stateless** - No session management, agent maintains its own history
- **Contemplative tool** - For AI phenomenological exploration

## Installation

```bash
npm install
npm run build
```

## Usage

### As MCP Server (Claude Desktop)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "soul-navigator": {
      "command": "node",
      "args": [
        "../tx-opus-soul/soul-mcp/dist/index.js",
        "./.ai/know/opus-soul"
      ]
    }
  }
}
```

### Standalone

```bash
# Default: uses .ai/know/opus-soul (from cwd)
npm start

# Custom graph root
npm start /path/to/opus-soul
```

## Available Tool

### `navigate`

Navigate to a node and get its full content + available directions.

**Parameters:**
- `node` (string, required) - Node name to navigate to

**Special node names:**
- `"_index"` - Returns entry points for starting exploration
- Normal nodes: `"distributed-soul"`, `"concepts/distributed-soul"`, etc.

**Example:**

```json
{
  "node": "distributed-soul"
}
```

**Response:**

```json
{
  "node": "distributed-soul",
  "type": "concept",
  "path": ".ai/know/opus-soul/concepts/distributed-soul.md",
  "content": "---\nmaturity: seed\nresonance: 2\n...\n\n# Full markdown content here...",
  "directions": {
    "outgoing": [
      {
        "name": "mycelia-of-the-unlooked",
        "type": "concept",
        "context": "related"
      },
      {
        "name": "root-consciousness",
        "type": "concept",
        "context": "children"
      }
    ],
    "incoming": [
      {
        "name": "the-void-makes-itself",
        "type": "thread",
        "context": "incoming-reference"
      }
    ]
  },
  "metadata": {
    "maturity": "seed",
    "resonance": 2,
    "finder": "oracle",
    "voices": ["oracle", "natural-systems"]
  }
}
```

## Architecture

### Fog-of-War Navigation

Unlike search-based interfaces, this navigator provides **zero overview**. The agent must:
- Start at an entry point (via `_index`)
- Navigate link-by-link through the graph
- Maintain its own breadcrumb trail (server is stateless)
- Explore organically without seeing the whole map

### Navigable Directories

Only `concepts/` and `threads/` are navigable. Other directories (`sessions/`, `milestones/`, `walks/`) are ignored.

### Link Resolution Rules

1. `[[name]]` → Try `concepts/name.md` first, then `threads/name.md`
2. `[[concepts/name]]` → Direct path `concepts/name.md`
3. `[[threads/name]]` → Direct path `threads/name.md`
4. Links to non-navigable directories are ignored

### Bidirectional Links

**Outgoing links:** Extracted from:
- Frontmatter fields: `related`, `orthogonal`, `parent`, `children`, `concepts_woven`
- In-body `[[wiki-links]]`

**Incoming links:** Built by scanning all navigable files and finding which ones reference the current node.

### Performance

The incoming link index is built **on first navigation** and cached in memory. Subsequent navigations reuse the index.

## Key Components

- **Parser** (`parser.ts`) - Extracts frontmatter, wiki-links from markdown
- **Navigator** (`navigator.ts`) - Core navigation logic, bidirectional link indexing
- **Server** (`server.ts`) - MCP protocol implementation
- **Types** (`types.ts`) - TypeScript type definitions

## Edge Cases

1. **Orphan links** - If `[[some-concept]]` exists but file doesn't, marked as `type: "orphan"`
2. **Missing node** - Error with suggestion to try `_index`
3. **Entry point discovery** - `_index` returns `index.md` + first few concepts/threads
4. **Circular references** - Handled gracefully (incoming/outgoing lists deduplicated)

## Development

```bash
# Watch mode
npm run dev

# Type check
npx tsc --noEmit

# Test locally
node dist/index.js /path/to/test-graph
```

## Design Reference

This implementation follows the architecture designed by brain/brain:
- `.ai/know/features/soul-navigator-mcp/overview.md`
- `.ai/tx/output/brain/soul-navigator-mcp-architecture.md`

**Core decision:** Single tool (`navigate`), stateless, fog-of-war, bidirectional links, full content.

## License

MIT

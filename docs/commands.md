# TX Commands Reference

Complete reference for all TX CLI commands, options, and usage patterns.

---

## Table of Contents

1. [User Commands](#user-commands)
2. [Agent Commands](#agent-commands)
3. [Developer Commands](#developer-commands)
4. [Command Patterns](#command-patterns)
5. [Options Reference](#options-reference)

---

## User Commands

Commands for starting, monitoring, and managing TX sessions.

### `tx start`

**Description:** Launch TX and drop into the core coordinator session.

**Usage:**
```bash
tx start
```

**What it does:**
1. Creates tmux session named `core`
2. Spawns core/core agent
3. Loads coordinator capabilities
4. Drops you into interactive mode

**Options:**
- None (uses defaults from config)

**Environment variables:**
- `TX_RUNTIME` - Choose AI CLI (default: `claude-code`)
  ```bash
  TX_RUNTIME=codex tx start
  ```

**Example:**
```bash
tx start
# You're now in core session, ready to spawn meshes
```

---

### `tx attach <mesh>`

**Description:** Attach to a running mesh session to observe or interact.

**Usage:**
```bash
tx attach <mesh-name>
```

**Arguments:**
- `<mesh-name>` - Name of the mesh (e.g., `brain`, `deep-research`)

**Examples:**
```bash
# Attach to brain mesh
tx attach brain

# Attach to research instance
tx attach deep-research-abc123
```

**Detach without stopping:**
- Press `Ctrl+B`, then `D`

**Stop the mesh:**
- Press `Ctrl+D` or type `exit` (not recommended)

**Alternative (direct tmux):**
```bash
tmux attach -t brain
```

---

### `tx status`

**Description:** View all active meshes, their states, and last activity.

**Usage:**
```bash
tx status
```

**Output example:**
```
Active Meshes (3):

  🟢 core (persistent)
     State: idle
     Attached: yes

  🟢 brain (persistent)
     State: working
     Last activity: 30s ago

  🟡 deep-research-abc123 (sequential)
     State: waiting-hitl
     Last activity: 2m ago
     Entry point: interviewer
     Current agent: interviewer

Active Watchers (1):
  🟢 error-fixer
     File: .ai/tx/logs/error.jsonl
     State: idle
     Processed: 12 changes
     Last activity: 5m ago
```

**Status indicators:**
- 🟢 Green - Running/idle
- 🟡 Yellow - Waiting for input (HITL)
- 🔴 Red - Error state
- ⚫ Gray - Stopped

---

### `tx stop [mesh]`

**Description:** Stop mesh sessions and clean up resources.

**Usage:**
```bash
# Stop all meshes
tx stop

# Stop specific mesh
tx stop brain

# Stop specific instance
tx stop deep-research-abc123
```

**Options:**
- No argument - stops ALL meshes
- `<mesh-name>` - stops specific mesh

**What it does:**
1. Sends graceful shutdown signal
2. Waits for agents to finish current task (timeout: 30s)
3. Kills tmux sessions
4. Cleans up lock files

**Force stop (if needed):**
```bash
# Kill all tmux sessions
tmux kill-server

# Kill specific session
tmux kill-session -t brain
```

---

### `tx list`

**Description:** List all available meshes and their descriptions.

**Usage:**
```bash
tx list
```

**Output:**
```
Available Meshes (18):

Production Meshes:
  brain             - Knowledge keeper with spec-graph
  planner           - MAP architecture task decomposition
  deep-research     - Multi-agent research with HITL
  code-review       - Parallel code review workflow
  tdd-cycle         - Red → Green → Refactor automation
  gtm-strategy      - Go-to-market strategy generation
  risk-experiment   - Proactive risk reduction experiments
  hitl-3qa          - Human-in-the-loop 3Q interview

Test Meshes:
  test-echo         - Simple echo test
  test-ping-pong    - Agent-to-agent messaging test
  ...

Use: tx spawn <mesh-name>
```

---

## Agent Commands

Commands available to agents within TX (used inside core or mesh sessions).

### `tx spawn <mesh>`

**Description:** Start a new mesh with agents in dedicated tmux sessions.

**Usage:**
```bash
tx spawn <mesh-name> [options]
```

**Arguments:**
- `<mesh-name>` - Name of mesh to spawn

**Options:**
- `-d, --detach` - Spawn in background (don't attach)
- `--runtime <cli>` - Override runtime (claude, codex, gemini, opencode)
- `--model <model>` - Specify model (sonnet, opus, haiku)

**Examples:**
```bash
# Basic spawn (from within core)
tx spawn brain

# Spawn detached
tx spawn deep-research -d

# Spawn with specific runtime
tx spawn code-review --runtime codex

# Spawn with specific model
tx spawn planner --model opus
```

**What it does:**
1. Validates mesh configuration
2. Creates tmux sessions for each agent
3. Initializes workspaces and message directories
4. Injects agent prompts
5. Establishes routing rules

**Spawn from core (natural language):**
```
spawn brain mesh to analyze the codebase
spawn deep-research mesh about transformer architectures
```

---

### `tx tool search <query>`

**Description:** Multi-source search across 20+ APIs (Reddit, arXiv, GitHub, etc.).

**Usage:**
```bash
tx tool search '<query>' [options]
```

**Arguments:**
- `<query>` - Search query (use quotes for multi-word)

**Options:**
- `-s, --source <source>` - Specific source (see sources below)
- `-t, --topic <topic>` - Topic area (dev, docs, news, science, etc.)
- `-n, --limit <n>` - Max results (default: 10)

**Sources:**

| Source | Alias | Description |
|--------|-------|-------------|
| `reddit` | - | Community discussions, debugging tips |
| `stackoverflow` | `so`, `stack-overflow` | Code solutions, Q&A |
| `arxiv` | - | Academic papers, research |
| `github` | - | Code examples, repositories |
| `duckduckgo` | `ddg` | General web search |
| `hackernews` | `hn` | Tech news, discussions |
| `pubmed` | - | Medical/scientific research |
| `brave` | - | Modern search engine |
| `tavily` | - | AI-optimized semantic search |
| `exa` | - | Semantic web search |
| `youtube` | - | Video content |
| `twitter` | `x` | Recent tweets |
| `wikipedia` | `wiki` | Encyclopedia |

**Topics:**
- `dev` - Technical information
- `docs` - Documentation
- `info` - General information
- `news` - Current events
- `packages` - Software packages
- `repos` - Code repositories
- `science` - Scientific content
- `files` - File search
- `media` - Images, videos

**Examples:**
```bash
# General search
tx tool search 'react hooks best practices'

# Source-specific search
tx tool search 'transformer architecture' -s arxiv

# Topic search
tx tool search 'authentication libraries' -t packages

# Multiple results
tx tool search 'rust async' -s stackoverflow -n 20
```

**Returns:**
- List of URLs with titles
- Source attribution
- Relevance scores

**Follow-up:** Use `tx tool get-www` to fetch content from URLs.

---

### `tx tool get-www <url>`

**Description:** Fetch and parse web content (HTML → Markdown).

**Usage:**
```bash
tx tool get-www <url> [options]
```

**Arguments:**
- `<url>` - URL to fetch

**Options:**
- `-js, --javascript` - Enable JavaScript rendering (uses Puppeteer)
- `-a, --archive` - Try archived copy if URL fails
- `--raw` - Return raw HTML instead of markdown

**Examples:**
```bash
# Basic fetch
tx tool get-www 'https://example.com/article'

# JavaScript-heavy site
tx tool get-www 'https://spa-site.com' -js

# Try archive if blocked
tx tool get-www 'https://paywalled-site.com' -a

# Multiple URLs
tx tool get-www 'url1' 'url2' 'url3'
```

**What it does:**
1. Fetches URL content
2. Converts HTML to clean markdown
3. Extracts main content (removes nav, ads, etc.)
4. Returns formatted text

**Use case:** After `tx tool search`, fetch actual content.

---

### `tx watch <file> --mesh <mesh>`

**Description:** Monitor file changes and send deltas to a mesh for processing.

**Usage:**
```bash
tx watch <file> --mesh <mesh-name> [options]
```

**Arguments:**
- `<file>` - File path to watch
- `--mesh <mesh-name>` - Target mesh for processing

**Options:**
- `-d, --detach` - Run in background
- `--debounce <ms>` - Debounce delay (default: 1000ms)

**Examples:**
```bash
# Watch error log (attached mode)
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer

# Watch in background
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer -d

# Watch with custom debounce
tx watch app.log --mesh log-analyzer --debounce 5000
```

**What it does:**
1. Spawns target mesh (if not running)
2. Monitors file for changes
3. Extracts NEW content only (delta tracking)
4. Debounces rapid changes (default: 1s)
5. Sends delta message to mesh
6. Waits for completion message
7. Repeats

**State tracking:**
- Stored in `.ai/tx/state/watchers/{mesh-name}.json`
- Survives restarts (resumes from last line)
- Handles file rotation automatically

**Message format:**
```markdown
---
from: watcher
to: {mesh}/{agent}
type: delta
file: /path/to/file
fromLine: 42
toLine: 45
---

New content detected in `error.jsonl`:

Lines 42 → 45:

```
{"level":"error","msg":"undefined variable","file":"lib/queue.js"}
{"level":"error","msg":"missing import","file":"lib/watcher.js"}
```
```

**Stop watching:**
```bash
tx stop {mesh-name}
```

---

## Developer Commands

Commands for debugging, testing, and development.

### `tx logs [type]`

**Description:** View system logs (debug, error, evidence).

**Usage:**
```bash
tx logs [type] [options]
```

**Arguments:**
- `[type]` - Log type: `debug`, `error`, `evidence` (default: all)

**Options:**
- `-f, --follow` - Tail logs in real-time
- `-n, --lines <n>` - Show last N lines (default: 50)
- `--json` - Output as JSON

**Examples:**
```bash
# View all recent logs
tx logs

# View error logs only
tx logs error

# Tail debug logs
tx logs debug -f

# Last 100 error lines
tx logs error -n 100

# JSON output for parsing
tx logs evidence --json
```

**Log files:**
- `debug.jsonl` - System operations, mesh spawns, message routing
- `error.jsonl` - Errors, exceptions, validation failures
- `evidence.jsonl` - Agent observations (brain reads this!)

**Log format (JSONL):**
```json
{"timestamp":"2025-10-30T10:00:00Z","level":"error","msg":"Mesh spawn failed","mesh":"invalid-mesh","error":"Config not found"}
```

---

### `tx prompt <mesh> <agent>`

**Description:** Render and display an agent's prompt (for testing/debugging).

**Usage:**
```bash
tx prompt <mesh> <agent>
```

**Arguments:**
- `<mesh>` - Mesh name
- `<agent>` - Agent name

**Examples:**
```bash
# View brain agent prompt
tx prompt brain brain

# View coordinator prompt
tx prompt code-review coordinator

# View red-phase prompt
tx prompt tdd-cycle red-phase
```

**What it shows:**
- Full agent prompt with capabilities
- Frontmatter configuration
- Routing rules
- Message templates
- Available tools

**Use cases:**
- Testing prompt changes
- Debugging agent behavior
- Understanding agent context

---

### `tx repo-install`

**Description:** Install TX integration into current project.

**Usage:**
```bash
cd /path/to/project
tx repo-install
```

**What it installs:**
```
project/
├── .claude/
│   ├── commands/
│   │   ├── tx-spawn.md
│   │   ├── tx-watch.md
│   │   └── tx-search.md
│   └── skills/
│       └── tx-skills/
└── .ai/
    └── tx/
        ├── mesh/
        └── logs/
```

**Options:**
- `--force` - Overwrite existing files

**Example:**
```bash
# Install to current directory
tx repo-install

# Force reinstall
tx repo-install --force
```

---

## Command Patterns

### Chaining Commands

```bash
# Search, fetch, and analyze
tx tool search 'topic' -s arxiv && \
tx tool get-www $(tx tool search 'topic' -s arxiv | head -1) && \
tx spawn deep-research
```

### Background Workflows

```bash
# Start watcher in background
tx watch error.jsonl --mesh error-fixer -d

# Continue working
tx start
```

### Multiple Meshes

```bash
# Spawn multiple meshes for parallel work
tx spawn brain -d
tx spawn code-review -d
tx spawn planner -d
tx status
```

---

## Options Reference

### Global Options

Available for all commands:

```bash
--help, -h          # Show help
--version, -v       # Show version
--verbose           # Verbose output
--quiet, -q         # Minimal output
--no-color          # Disable colors
```

### Runtime Options

```bash
--runtime <cli>     # claude-code, codex, gemini, opencode
--model <model>     # sonnet, opus, haiku (Claude)
--dangerously-skip-permissions  # Auto-accept permissions
```

### Watch Options

```bash
--mesh <mesh>       # Target mesh (required)
--debounce <ms>     # Debounce delay (default: 1000)
-d, --detach        # Run in background
```

### Search Options

```bash
-s, --source <src>  # Specific source
-t, --topic <topic> # Topic area
-n, --limit <n>     # Max results
```

---

## Environment Variables

```bash
# Runtime selection
TX_RUNTIME=codex              # Default: claude-code

# Model selection
TX_MODEL=opus                 # Default: sonnet

# Debug mode
TX_DEBUG=true                 # Enable verbose logging

# Search configuration
SEARXNG_URL=http://localhost:8080
GITHUB_TOKEN=ghp_xxx
BRAVE_API_KEY=BSA_xxx
```

---

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Invalid arguments
- `3` - Mesh not found
- `4` - Configuration error
- `5` - Tmux error
- `6` - Runtime error

---

## Need Help?

- **[Getting Started](./getting-started.md)** - Setup guide
- **[Troubleshooting](./troubleshooting.md)** - Common issues
- **[GitHub Issues](https://github.com/your-repo/issues)** - Report bugs

---

**Next:** [Message System →](./messages.md)

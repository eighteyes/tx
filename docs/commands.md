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
- `--js` - Enable JavaScript rendering (uses Puppeteer)
- `-a, --archive` - Try archived copy if URL fails
- `--raw` - Return raw HTML instead of markdown

**Examples:**
```bash
# Basic fetch
tx tool get-www 'https://example.com/article'

# JavaScript-heavy site
tx tool get-www 'https://spa-site.com' --js

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

### `tx reset <mesh> [agent]`

**Description:** Reset agent session by clearing it and re-injecting the original prompt.

**Usage:**
```bash
# Reset all agents in a mesh
tx reset <mesh-name>

# Reset specific agent
tx reset <mesh-name> <agent-name>
```

**Arguments:**
- `<mesh-name>` - Name of mesh or mesh instance (e.g., `research-abc123`)
- `[agent-name]` - Optional: specific agent to reset (if omitted, resets all agents)

**What it does:**
1. Finds active tmux session for agent(s)
2. Injects `/clear` command to reset conversation
3. Finds most recent prompt message from `.ai/tx/msgs/`
4. Re-injects original prompt to restart agent
5. For mesh-wide reset: processes all agents sequentially

**Examples:**
```bash
# Reset all agents in research mesh
tx reset research-abc123

# Reset specific agent
tx reset research-abc123 interviewer

# Reset brain agent
tx reset brain brain
```

**Use cases:**
- Agent stuck or unresponsive
- Agent produced incorrect output and needs fresh start
- Testing prompt changes
- Clearing agent context after error

**Output:**
```
🔄 Resetting all agents in mesh: research-abc123...
   Found 4 agent(s) in mesh config

--- Resetting research-abc123/interviewer ---
   1. Clearing session...
   2. Finding last prompt message...
   3. Re-injecting prompt: 1106051538-prompt-system>interviewer-abc123.md
   ✅ Agent reset complete

--- Resetting research-abc123/sourcer ---
   ...

==================================================
✅ Reset complete!
   Success: 4/4
==================================================
```

---

### `tx msg [options]`

**Description:** Interactive event log viewer for browsing message history.

**Usage:**
```bash
# Interactive mode (default)
tx msg

# Start with follow mode
tx msg --follow

# Simple list mode
tx msg --no-interactive -v
```

**Options:**
- `--limit <n>` - Number of messages to display (default: 50)
- `--follow` - Start with follow mode enabled (auto-refresh)
- `--type <type>` - Filter by message type (task, ask, delta, etc.)
- `--agent <agent>` - Filter by agent (matches from or to)
- `--mesh <mesh>` - Filter by mesh
- `--errors` - Show only error messages
- `--since <time>` - Messages since time (e.g., "1h", "30m", "2025-11-03")
- `--before <time>` - Messages before time
- `--json` - Output as JSON
- `--no-interactive` - Disable interactive mode (simple list)
- `-v, --verbose` - Show message content preview (non-interactive only)

**Interactive controls:**
- `↑↓` or `j/k` - Navigate messages
- `Enter` or `→` - View message detail
- `←` or `Esc` - Back to list
- `a` - Attach to target agent (from message's "to" field)
- `f` - Toggle follow mode
- `q` - Quit

**Examples:**
```bash
# Browse all messages interactively
tx msg

# Filter by type
tx msg --type task

# Filter by agent
tx msg --agent brain

# Last hour with follow mode
tx msg --since 1h --follow

# JSON output for scripting
tx msg --json --limit 100
```

**Message format:**
```
1106051700-task-coordinator>product-definer-start01.md
  11/06 05:17:00  task  coordinator → product-definer
  Starting MVP workflow - greenfield project
```

---

### `tx session [mesh] [agent]`

**Description:** View captured session output (tmux pane history).

**Usage:**
```bash
# List all sessions
tx session list

# View latest session for mesh/agent
tx session <mesh> <agent>

# Filter options
tx session list --today
tx session list --mesh research
```

**Arguments:**
- `[mesh]` - Mesh name or instance
- `[agent]` - Agent name

**Options:**
- `list` - List all captured sessions
- `--today` - Show only today's sessions
- `--mesh <mesh>` - Filter by mesh
- `--limit <n>` - Limit number of sessions shown

**What it shows:**
- Full tmux pane history at time of capture
- Agent's conversation with Claude
- Commands executed
- Errors and output

**Session format:**
Filename: `.ai/tx/session/{MMDDHHMMSS}-{mesh}-{agent}-{seq}.md`

**Examples:**
```bash
# View latest brain session
tx session brain brain

# List all sessions from today
tx session list --today

# List all research sessions
tx session list --mesh research
```

**Use cases:**
- Debugging agent behavior
- Reviewing conversation history
- Understanding why agent failed
- Post-mortem analysis

---

### `tx stats [options]`

**Description:** Display event log statistics and message analytics.

**Usage:**
```bash
# Overall stats
tx stats

# Filter by mesh
tx stats --mesh research

# Filter by agent
tx stats --agent brain

# JSON output
tx stats --json
```

**Options:**
- `--mesh <mesh>` - Filter by mesh
- `--agent <agent>` - Filter by agent
- `--since <time>` - Messages since time
- `--json` - Output as JSON

**Output example:**
```
Event Log Statistics
=====================

Total Messages: 1,234

By Type:
  task           456 (37%)
  ask            234 (19%)
  ask-response   234 (19%)
  task-complete  210 (17%)
  update          80 (6%)
  delta           20 (2%)

By Agent:
  core           345 (28%)
  brain          234 (19%)
  interviewer    123 (10%)
  ...

Time Range: 2025-11-01 to 2025-11-06 (5 days)
```

---

### `tx health [options]`

**Description:** Display system health status and diagnostics.

**Usage:**
```bash
# Check health
tx health

# Watch mode (auto-refresh)
tx health --watch

# JSON output
tx health --json
```

**Options:**
- `--watch` - Auto-refresh every 5 seconds
- `--json` - Output as JSON

**Health checks:**
- ✅ Tmux server running
- ✅ Message directory exists
- ✅ Active meshes count
- ✅ Event log size
- ⚠️ Stuck agents (no activity > 1 hour)
- ❌ Failed sessions

**Output example:**
```
TX System Health
================

✅ Tmux Server: Running
✅ Message Directory: .ai/tx/msgs/ (2.1 MB)
✅ Active Meshes: 3
✅ Event Log: 1,234 messages

⚠️  Warnings:
  - research-abc123/sourcer: No activity for 2 hours

Recent Errors (last 24h): 0
```

---

### `tx dashboard [options]`

**Description:** Create live dashboard showing all active agents.

**Usage:**
```bash
# Launch dashboard
tx dashboard

# Refresh rate
tx dashboard --refresh 10
```

**Options:**
- `--refresh <seconds>` - Auto-refresh interval (default: 5)

**Layout:**
```
┌─────────────┬─────────────┬─────────────┐
│             │             │             │
│    core     │   brain     │  research   │
│             │             │  (tiled)    │
│             │             │             │
├─────────────┼─────────────┼─────────────┤
│   stats     │    logs     │   health    │
└─────────────┴─────────────┴─────────────┘
```

**Features:**
- Core mesh on left (largest pane)
- Other meshes tiled on right
- Live updates
- Quick navigation between panes

**Navigation:**
- `Ctrl+B` then arrow keys - Switch panes
- `Ctrl+B` then `z` - Zoom current pane
- `Ctrl+B` then `d` - Detach

---

### `tx clear [options]`

**Description:** Clear all TX orchestration data.

**Usage:**
```bash
# Interactive confirmation
tx clear

# Force clear without confirmation
tx clear --force
```

**Options:**
- `-f, --force` - Skip confirmation prompt

**What it deletes:**
- `.ai/tx/` directory (all meshes, messages, state)
- Active tmux sessions
- Watcher state
- Log files

**⚠️ Warning:** This is destructive and cannot be undone!

**Example:**
```bash
# With confirmation
$ tx clear
⚠️  This will delete ALL TX data in .ai/tx/
   Including:
   - 3 active meshes
   - 1,234 messages
   - Session history
   - State files

Are you sure? (y/N): y
✅ TX data cleared
```

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

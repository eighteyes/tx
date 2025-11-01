# Getting Started with TX

This guide will walk you through installing TX, configuring your environment, and spawning your first mesh.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [First Run](#first-run)
5. [Your First Mesh](#your-first-mesh)
6. [Understanding the Output](#understanding-the-output)
7. [Next Steps](#next-steps)

---

## Prerequisites

### Required Software

Before installing TX, verify you have these installed:

#### 1. Node.js (>= 18.0.0)

```bash
node --version  # Should be v18.0.0 or higher
```

If not installed: [Download Node.js](https://nodejs.org/)

#### 2. tmux (>= 3.0)

```bash
tmux -V  # Should be tmux 3.0 or higher
```

**Install tmux:**

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt-get install tmux

# Fedora/RHEL
sudo dnf install tmux

# From source
git clone https://github.com/tmux/tmux.git
cd tmux
sh autogen.sh
./configure && make
sudo make install
```

**Why tmux?**
- Session isolation for each agent
- Programmatic control (send-keys for prompt injection)
- Attach/detach without killing agents
- Persistent sessions across terminal disconnects

#### 3. AI CLI Tool (Choose One)

TX orchestrates existing AI CLIs. You need at least one:

**Option A: Claude Code (Recommended)**

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version

# Accept dangerous permissions (required for TX)
claude --dangerously-skip-permissions
```

**Option B: Codex**
```bash
npm install -g codex-cli
```

**Option C: Gemini CLI**
```bash
npm install -g gemini-cli
```

**Option D: OpenCode**
```bash
npm install -g opencode
```

### Optional Requirements

#### Docker (Recommended for Isolation)

TX agents have full system access. Docker provides isolation:

```bash
# See DOCKER.md for containerized setup
docker --version
```

**Security options:**
- [safe-claude](https://github.com/eighteyes/safe-claude) - Sandboxed Claude
- Docker containers ([DOCKER.md](../../DOCKER.md))
- Virtual machines
- Dedicated development servers

#### SearXNG (Enhanced Search)

For self-hosted meta-search:

```bash
# See SearXNG installation guide
# Configure SEARXNG_URL in .env
```

---

## Installation

### Step 1: Install TX Globally

```bash
npm install -g tx-cli
```

**Verify installation:**

```bash
tx --version
```

### Step 2: Install to Project (Optional)

If you want TX integrated into a specific project:

```bash
cd /path/to/your/project
tx repo-install
```

**What `tx repo-install` installs:**

```
your-project/
├── .claude/
│   ├── commands/
│   │   └── tx-*.md          # TX slash commands (/spawn, /watch, etc.)
│   └── skills/
│       └── tx-skills/       # TX-specific skills
└── .ai/
    └── tx/                  # TX runtime directory
        ├── mesh/            # Agent workspaces and messages
        └── logs/            # System logs
```

**When to use repo-install:**
- ✅ Integrating TX into an existing project
- ✅ Using TX with project-specific slash commands
- ✅ Sharing TX workflows with team members
- ❌ Just trying TX out (global install is enough)

### Step 3: Verify Installation

```bash
tx status
```

**Expected output:**
```
No active meshes.
```

✅ Success! TX is installed and ready.

---

## Configuration

### Basic Configuration (Optional)

TX works out of the box, but configuration unlocks advanced features.

#### 1. Environment Variables

Copy the example configuration:

```bash
cp .env.example .env
```

Edit `.env` to add API keys for search capabilities:

```bash
# Free tier (no credit card required)
GITHUB_TOKEN=ghp_xxxxxxxxxxxx           # 5000 req/hr (vs 60)
BRAVE_API_KEY=BSA-xxxxxxxxxxxx          # 2000 queries/month
TAVILY_API_KEY=tvly-xxxxxxxxxxxx        # 1000 queries/month
EXA_API_KEY=exa-xxxxxxxxxxxx            # 100 queries/month

# Paid APIs (optional)
BING_SEARCH_KEY=xxxxxxxxxxxxxx
YOUTUBE_API_KEY=xxxxxxxxxxxxxx
TWITTER_BEARER_TOKEN=xxxxxxxxxxxxxx
```

**What these enable:**
- `GITHUB_TOKEN`: Higher rate limits for GitHub searches
- `BRAVE_API_KEY`: Modern search engine results
- `TAVILY_API_KEY`: AI-optimized semantic search
- `EXA_API_KEY`: Semantic web search

**See all options:** [.env.example](../../.env.example)

#### 2. Default Runtime Provider

TX defaults to `claude-code`. To use a different provider:

```bash
# In your shell profile (~/.bashrc, ~/.zshrc, etc.)
export TX_RUNTIME=codex

# Or per-session
TX_RUNTIME=gemini tx start
```

---

## First Run

### Launch TX

```bash
tx start
```

**What happens:**

1. **Tmux session created:** TX creates a session named `core`
2. **Core agent loads:** The coordinator agent initializes
3. **Prompt injection:** System prompt sent to Claude via tmux
4. **Interactive mode:** You're dropped into the core session

**You should see:**

```
🚀 Starting TX...
✅ Core mesh spawned
✅ Session initialized

You are now in the core mesh. Try:
  - "spawn brain mesh to analyze the codebase"
  - "spawn deep-research mesh about [topic]"
  - "help" for available commands
```

### Your First Command

Once inside the core session, try:

```
help
```

**Output:**
```
Available commands:
- spawn <mesh> - Start a new mesh
- status - View active meshes
- stop - End current session
- attach <mesh> - Connect to another mesh
```

---

## Your First Mesh

Let's spawn the `brain` mesh to understand your codebase:

### Step 1: Spawn Brain

Inside the core session:

```
spawn brain mesh to analyze the codebase structure
```

### Step 2: Watch the Output

You'll see real-time progress:

```
🧠 Persistent mesh: brain (stable path)

🚀 Spawning brain/brain...
✅ Agent validated: brain

📂 Initializing communication directories...
✅ Directories created

📦 Creating tmux session...
✅ Session brain created

🤖 Starting Claude in session...
⏳ Waiting for Claude to initialize...
✅ Claude is ready

📝 Building agent prompt...
✅ Prompt saved: .ai/tx/mesh/brain/agents/brain/prompts/prompt.md

📡 Instructing Claude to load prompt...
✅ Prompt load command sent

✅ brain/brain spawned!

   Session: brain
   Attach: tmux attach -t brain
   Stop: tx stop brain
```

### Step 3: Check Status

In another terminal:

```bash
tx status
```

**Output:**

```
Active Meshes (2):

  🟢 core (persistent)
     State: idle
     Attached: yes

  🟢 brain (persistent)
     State: working
     Last activity: 5s ago
```

### Step 4: Attach to Brain (Optional)

To watch the brain work:

```bash
tx attach brain
```

**Keyboard shortcuts:**
- `Ctrl+B, D` - Detach without stopping
- `Ctrl+C` - Interrupt current operation
- `Ctrl+D` - Exit (stops the mesh!)

**To detach safely:** Always use `Ctrl+B, D` (not `Ctrl+D`)

### Step 5: Wait for Response

Brain will analyze your codebase and send a message back to core.

**In core session, you'll see:**

```
📬 New message from brain/brain:

---
from: brain/brain
to: core/core
type: task-complete
---

# Codebase Analysis Complete

I've analyzed your project structure and created:
- Spec graph with 48 entities
- 6 data model schemas
- 36 dependency relationships

Key insights:
- Entry point: bin/tx.js
- 18 mesh configurations available
- File watcher using Chokidar v4
- Test suite with Node.js test runner

Ready to provide context for development tasks.
```

🎉 **Success!** You've spawned your first mesh and received a response.

---

## Understanding the Output

### Directory Structure

After spawning meshes, check `.ai/tx/`:

```bash
tree .ai/tx -L 3
```

**Output:**

```
.ai/tx/
├── mesh/
│   ├── core/
│   │   └── agents/
│   │       └── core/
│   │           ├── msgs/          # Messages from core
│   │           └── prompts/       # Generated prompts
│   └── brain/
│       ├── agents/
│       │   └── brain/
│       │       ├── msgs/          # Messages from brain
│       │       ├── workspace/     # Brain's memory files
│       │       └── prompts/
│       └── workspace/             # Shared mesh workspace
└── logs/
    ├── debug.jsonl                # System debug logs
    ├── error.jsonl                # Error logs
    └── evidence.jsonl             # Agent observations (brain reads this!)
```

### Message Files

Messages use frontmatter for routing:

```bash
cat .ai/tx/mesh/core/agents/core/msgs/task-spawn-brain-001.md
```

**Example:**

```markdown
---
to: brain/brain
from: core/core
type: task
status: start
msg-id: spawn-brain-001
headline: Analyze codebase structure
timestamp: 2025-10-30T10:00:00Z
---

Please analyze the codebase structure and provide:
- Entry points
- Key components
- Architecture patterns
```

**Key concepts:**
- **Stay-in-place:** Messages never move from where they're created
- **@filepath injection:** TX injects file references to destination agents
- **No copying:** Routing system delivers references, not contents

### Logs

Check system logs:

```bash
# Debug logs
tail -f .ai/tx/logs/debug.jsonl

# Error logs
tail -f .ai/tx/logs/error.jsonl

# Evidence logs (brain reads these for insights!)
tail -f .ai/tx/logs/evidence.jsonl
```

---

## Next Steps

Now that TX is running, explore these workflows:

### 1. Try Other Meshes

```
# Code review
spawn code-review mesh for the authentication module

# Research with HITL
spawn deep-research mesh about transformer architecture improvements

# TDD cycle
spawn tdd-cycle mesh to implement user authentication

# GTM strategy
spawn gtm-strategy mesh for my SaaS product
```

### 2. Use File Watching

```bash
# Watch errors and auto-fix
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer -d
```

### 3. Search Capabilities

Inside a mesh:

```
tx tool search 'latest transformer architecture papers' -s arxiv
```

### 4. Create Custom Mesh

See: [docs/examples/custom-mesh/](../examples/custom-mesh/)

### 5. Read Documentation

- **[Commands Reference](./commands.md)** - All CLI commands
- **[Message System](./messages.md)** - Agent communication
- **[Available Meshes](./meshes.md)** - Full mesh catalog
- **[Architecture](./architecture.md)** - System design
- **[Troubleshooting](./troubleshooting.md)** - Common issues

---

## Common First-Run Issues

### Issue: "tmux: command not found"

**Solution:** Install tmux (see [Prerequisites](#prerequisites))

### Issue: "claude: command not found"

**Solution:** Install Claude Code:
```bash
npm install -g @anthropic-ai/claude-code
```

### Issue: "Permission denied"

**Solution:** Accept dangerous permissions:
```bash
claude --dangerously-skip-permissions
```

### Issue: "No such mesh: X"

**Solution:** Check available meshes:
```bash
tx list
```

### Issue: "Session already exists"

**Solution:** Stop existing sessions:
```bash
tx stop
# Or manually:
tmux kill-session -t core
```

---

## Need Help?

- **[Troubleshooting Guide](./troubleshooting.md)** - Common issues
- **[GitHub Issues](https://github.com/your-repo/tx-cli/issues)** - Report bugs
- **[Discussions](https://github.com/your-repo/tx-cli/discussions)** - Ask questions

---

**Next:** [Commands Reference →](./commands.md)

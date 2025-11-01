# TX

**Claude Orchestration for Augmented Workflows**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

> Transform Claude into a multi-agent orchestration system with specialized agents, private memory, and human-in-the-loop workflows.

---

## 📑 Table of Contents

- [Quick Start](#-quick-start)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Core Concepts](#-core-concepts)
- [Available Meshes](#-available-meshes)
- [Commands Reference](#-commands-reference)
- [Getting Started Tutorial](#-getting-started-tutorial)
- [Configuration](#-configuration)
- [Examples](#-examples)
- [Documentation](#-documentation)
- [Why TX?](#-why-tx)
- [License](#-license)

---

## ⚡ Quick Start

```bash
# Prerequisites: Node.js 18+, tmux 3.0+, claude-code installed
npm install -g tx-cli

# you will need to have a configured claude with permissions bypass enabled for this folder 
cd project-folder/

# installs .claude commands / output styles
tx repo-install

tx start
```

Once inside:
```
spawn a deep-research mesh about penguins adapting to climate change
```

That's it! TX will spawn a multi-agent research mesh with HITL refinement loops.

---

## 📋 Prerequisites

Before installing TX, ensure you have:

- **Node.js** >= 18.0.0 ([Download](https://nodejs.org/))
- **tmux** >= 3.0 ([Install Guide](https://github.com/tmux/tmux/wiki))
- **AI CLI Tool**:
  - [Claude Code](https://docs.claude.com/claude-code)
  - [Codex](https://github.com/your-link-here) ( future )
  - [Gemini CLI](https://github.com/your-link-here) ( future )
  - [OpenCode](https://github.com/your-link-here) ( future )

**Optional:**
- **Docker** for containerized deployment ([DOCKER.md](./DOCKER.md))
- **SearXNG** for enhanced search capabilities
- **API Keys** for search sources (see [Configuration](#-configuration))

---

## 🚀 Installation

### 1. Install TX Globally

```bash
npm install -g tx-cli
```

### 2. Install to Your Project (Optional)

This adds TX commands and skills to your project:

```bash
cd your-project
tx repo-install
```

**What `tx repo-install` does:**
(will get swapped out for a plugin approach)
- Installs `.claude/commands/` for TX slash commands
- Adds `.claude/skills/` for TX-specific skills
- Configures `.claude/output-styles/` for optimal agent output
- Sets up `.ai/tx/` directory structure

### 3. Accept Permissions (Required)

⚠️ **Security Notice**: TX runs Claude with `--dangerously-skip-permissions` for automated workflows.

```bash
# accept permissions manually for this directory, then run tx start
claude --dangerously-skip-permissions
```

**Strongly recommended**: Use containerized isolation ([safe-claude](https://github.com/eighteyes/safe-claude), Docker, etc.)

### 4. Verify Installation

```bash
tx status
```

You should see: `No active meshes` (success!)

---

## 🧠 Core Concepts

### **Mesh**
A workflow composed of specialized agents with defined inputs, outputs, and routing rules.

**Example:** `code-review` mesh = coordinator + SOLID checker + doc checker + test analyzer

### **Agent**
An LLM session within a mesh, with specialized prompts, capabilities, and context.

**Example:** `brain/brain` = project knowledge maintainer

### **Capability**
A prompt-based tool available to agents, optionally enhanced by programmatic tooling.

**Examples:**
- `search` - Multi-source web search (20+ APIs)
- `watch` - File monitoring with delta tracking
- `ask` - Inter-agent communication
- `spawn` - Mesh lifecycle management

### **Workspace**
A shared filesystem location for agent collaboration (`.ai/tx/mesh/{mesh}/workspace/`)

---

## 🌐 Available Meshes

TX includes meshes for different workflows:

| Mesh | Type | Description | Use Case |
|------|------|-------------|----------|
| **core** | Persistent | Central coordinator and user interface | Entry point for all operations |
| **brain** | Persistent | Knowledge keeper with spec-graph | Codebase understanding, strategic planning |
| **planner** | Sequential | MAP architecture task decomposition | Complex feature planning |
| **deep-research** | HITL Loop | Multi-agent research with interviewer, sourcer, analyst, disprover, writer | Academic research, market analysis |
| **code-review** | Parallel | 4 analyzers (SOLID, docs, tests, maintainability) | Pre-commit reviews, PR analysis |
| **tdd-cycle** | Iterative | Red → Green → Refactor automation | Test-driven development |
| **gtm-strategy** | Sequential | Go-to-market strategy for founders | Product launch planning |
| **risk-experiment** | Sequential | Proactive risk-reduction experiments | Validate assumptions before building |
| **hitl-3qa** | HITL Loop | 3-question interview refinement | Requirements gathering |
| **riddle-game** | Competitive | Two agents compete with mediator scorekeeper | Agent capability testing |

**See full list:** [docs/meshes.md](./docs/new/meshes.md)

---

## 🔧 Commands Reference

### User Commands

```bash
tx start              # Launch TX and drop into core session
tx attach <mesh>      # Attach to a running mesh session
tx status             # View all active meshes and their states
tx stop               # Stop all running meshes and exit
```

### Agent Commands (used within TX)

```bash
tx spawn <mesh>             # Start a new mesh
tx tool search <query>      # Multi-source search (Reddit, arXiv, GitHub, etc.)
tx tool get-www <url>       # Fetch and parse web content
tx watch <file> --mesh      # Monitor file changes with delta tracking
```

### Developer Commands

```bash
tx logs                # View system logs (debug, error, evidence)
tx prompt <mesh> <agent>   # Render agent prompt for testing
tx list                # List all available meshes
tx repo-install        # Install TX to current project
```

**Full command reference:** [docs/commands.md](./docs/new/commands.md)

---

## 🎓 Getting Started Tutorial

### Step 1: Start TX

```bash
tx start
```

**What happens:**
- TX spawns `core` mesh in a tmux session
- Core agent loads with coordinator capabilities
- You're dropped into an interactive session

### Step 2: Spawn Your First Mesh

```
spawn brain mesh to analyze the codebase structure
```

**What happens:**
- TX creates tmux session named `brain` using `tx spawn brain`
- Brain agent loads
- Core waits for brain's response
- You'll see: `🚀 Spawning brain/brain...` → `✅ brain/brain spawned!`

### Step 3: View Active Meshes

```bash
# In another terminal:
tx status
```

**Output:**
```
Active Meshes (2):
  🟢 core (persistent)
     State: idle

  🟢 brain (persistent)
     State: idle
     Last activity: 30s ago
```

### Step 4: Attach to Watch a Mesh

```bash
tx attach brain
```

Press `Ctrl+B, D` to detach without stopping the mesh.

**Detailed tutorial:** [docs/getting-started.md](./docs/new/getting-started.md)

---

## ⚙️ Configuration

### Environment Variables

TX supports search APIs via `.env` configuration:

```bash
# Copy example config
cp .env.example .env
```

### Search

TX has a custom setting file for SearXNG for topical searches `config/searxng/settings.yml`
On Docker, this file is loaded from `/etc/searxng/`


**Search Sources Available:**
- **Curated**: SearXNG allows for topical search locally
- **Free:** StackOverflow, arXiv, GitHub, DuckDuckGo, HackerNews, PubMed, Wikipedia
- **Freemium:** Brave (2K/mo), Tavily (1K/mo), Exa (100/mo), NewsAPI (100/day)
- **Paid:** Bing, YouTube, Twitter/X

**See all options:** [.env.example](./.env.example)

### Mesh Configuration

Meshes are configured via JSON files in `meshes/mesh-configs/`:

```json
{
  "mesh": "my-mesh",
  "type": "sequential",
  "description": "What this mesh does",
  "agents": ["agent-1", "agent-2"],
  "entry_point": "agent-1",
  "completion_agent": "agent-2",
  "capabilities": ["search", "watch"],
  "routing": { /* ... */ }
}
```

**Configuration guide:** [docs/architecture.md](./docs/new/architecture.md)

---

## 💡 Examples

### Example 1: Error Monitoring & Auto-Fix

```bash
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer -d
```

Watches error log, sends new errors to `error-fixer` mesh in background.

**Full example:** [docs/examples/error-monitoring/](./docs/examples/error-monitoring/)

---

### Example 2: Code Review Workflow

```
spawn code-review mesh for the authentication module
```

Spawns parallel review with 4 analyzers, generates comprehensive report.

**Full example:** [docs/examples/code-review/](./docs/examples/code-review/)

---

### Example 3: Custom Mesh Creation

Create `meshes/mesh-configs/my-workflow.json`:

```json
{
  "mesh": "my-workflow",
  "agents": ["worker"],
  "entry_point": "worker"
}
```

Add agent prompt in `meshes/agents/my-workflow/worker/prompt.md`.

**Full example:** [docs/examples/custom-mesh/](./docs/examples/custom-mesh/)

---

## 📚 Documentation

- **[Getting Started Guide](./docs/new/getting-started.md)** - Detailed setup and first steps
- **[Commands Reference](./docs/new/commands.md)** - All CLI commands with examples
- **[Message System](./docs/new/messages.md)** - How agents communicate
- **[Meshes Guide](./docs/new/meshes.md)** - All available meshes
- **[Architecture](./docs/new/architecture.md)** - System design and concepts
- **[Troubleshooting](./docs/new/troubleshooting.md)** - Common issues and solutions

---

## 🎯 Why TX?

> I am not happy with how much manual work it takes to nudge Claude through an rigorous agentic process. Even with all the commands, subagents, skills, hooks, etc, implicit tool selection and agent invocation reduces steering adherence, and clutters context. Plugins are a great step in the right direction, but I'd rather have explicitly reproducible workflows. Frameworks like LangChain, CrewAI, etc. give me that explicit control but I have to reinvent 90% of the wheel that agentic CLI's provide out-of-the-box.
>
> TX is a functional middle ground between highly specialized and tuned agentic workflows and user-friendly CLI AI applications.

TX provides:
- ✅ **Explicit invocation** - You control when agents run
- ✅ **Observable workflows** - See exactly what's happening via tmux / prompts / message files
- ✅ **Context isolation** - Each agent has dedicated, focused context
- ✅ **Specialist agents** - Domain experts outperform generalists
- ✅ **Inter-agent communication** - Agents collaborate via file-based messages
- ✅ **Human-in-the-loop** - Intervene at critical decision points
- ✅ **Private memory** - Brain maintains spec-graph for true intelligence tests

### Fundamentals

> **Specialized agents with domain context outperform generalists**

> **Quality beats productivity as review is the bottleneck**

### What about Skills / Agents / Commands?

Use them! They're powerful. TX differs in that it is:
- **Explicitly invoked** - No implicit tool selection, no base context clutter
- **Observable** - Watch agents work in real-time via tmux and message files
- **Composable** - Chain meshes together with conditional logic, communicate and iterate until it's "Perfect!".
- **Orchestration Oriented** - A central mesh handles communication with all the workers and you.  

Certain patterns (like Haiku swarms running Explore) are better with native tooling. TX excels at:
- Multi-step workflows requiring coordination
- Human-in-the-loop decision points
- Complex research with evidence collection
- Code review with multiple analyzers
- Agent competitions with private memory

### **Use Cases**
- Use a Brain - Plan with a dedicated, persistant agent that knows your project
- 🧪 **Research papers → TX meshes** - Rapidly prototype agentic topologies from academic papers
- 🔍 **Deep research** - Better than ChatGPT Deep Research (HITL at every decision point, not just start)
- 🏆 **Agent competitions** - True intelligence tests with private memory and programmatic tooling
- ⚡ **Leverage & surface area** - Plan, experiment, run tdd, and code review with one prompt. 

---

## 🏗️ Project Structure

```
tx-cli/
├── bin/
│   └── tx.js              # CLI entry point
├── lib/
│   ├── commands/          # Command implementations
│   ├── prompt-builder.js  # Agent prompt construction
│   ├── validator.js       # Message/config validation
│   └── watcher.js         # File monitoring
├── meshes/
│   ├── agents/            # Agent configurations & prompts
│   ├── mesh-configs/      # Mesh definitions
│   └── prompts/
│       ├── capabilities/  # Capability prompts
│       └── templates/     # System templates
├── .ai/tx/
│   ├── mesh/              # Runtime mesh data
│   │   └── {mesh}/
│   │       ├── agents/{agent}/msgs/  # Agent messages (stay-in-place!)
│   │       └── workspace/            # Shared workspace
│   └── logs/
│       ├── debug.jsonl    # System debug logs
│       ├── error.jsonl    # Error logs
│       └── evidence.jsonl # Agent observations (brain reads this)
└── docs/
    ├── getting-started.md
    ├── commands.md
    ├── messages.md
    ├── meshes.md
    ├── architecture.md
    └── troubleshooting.md
```

---

## 🤝 Contributing

We welcome contributions! To get started:

1. **Understand the architecture:** Read [docs/architecture.md](./docs/new/architecture.md)
2. **Run tests:** `npm test` (unit) and `npm run test:e2e` (e2e)
3. **Create a mesh:** Follow [docs/examples/custom-mesh/](./docs/examples/custom-mesh/)
4. **Add capabilities:** See `meshes/prompts/capabilities/`

---

## 📄 License

MIT © [Your Name]

---

## 🚀 Next Steps

1. **Read the [Getting Started Guide](./docs/new/getting-started.md)**
2. **Try the [Hello World example](./docs/examples/hello-world/)**
3. **Explore [available meshes](./docs/new/meshes.md)**
4. **Join discussions** (link to Discord/GitHub Discussions)

---

**Questions?** Check the [Troubleshooting Guide](./docs/new/troubleshooting.md) or open an issue.

# Agent Orchestration - Getting Started

## Installation

### Prerequisites
- Node.js 16+
- tmux
- SearXNG (for search capability) at `http://localhost:12321`

### Setup
```bash
# Navigate to project
cd /workspace/tmux-riffic-v2

# Install dependencies
npm install

# Make CLI global
npm link
```

### Verify Installation
```bash
tx --version    # Should show 2.0.0
tx --help       # Should show all commands
```

---

## Basic Usage

### 1. View Generated Prompts

See what Claude will receive (no tmux needed):
```bash
# Core brain prompt
tx prompt core

# Test echo agent
tx prompt test-echo
```

### 2. Check System Status

```bash
# See all active meshes and queues
tx status
```

### 3. Search the Web

Requires SearXNG at localhost:12321:
```bash
tx tool search "quantum computing"
```

---

## Working with Agents

### Single Agent Example

#### Terminal 1: Start System
```bash
# Start core mesh (this would spawn Claude in tmux)
tx start
```

#### Terminal 2: Spawn Test Agent
```bash
# Spawn echo agent
tx spawn test-echo --init "Hello from agent system!"
```

#### Terminal 3: Monitor Status
```bash
# Watch queue in real-time
watch -n 1 tx status
```

#### Attach to Session
```bash
# Attach to running echo agent
tmux attach -t test-echo-echo
```

---

## Multi-Agent Workflow

Create a multi-agent mesh in `meshes/mesh-configs/researcher.json`:

```json
{
  "mesh": "researcher",
  "type": "ephemeral",
  "description": "Multi-agent research workflow",
  "agents": [
    "researcher/searcher",
    "researcher/analyzer",
    "researcher/reporter"
  ],
  "type": "sequential",
  "entry_point": "searcher",
  "completion_agent": "reporter"
}
```

Create agent prompts:

**meshes/agents/researcher/searcher/prompt.md:**
```markdown
# Researcher - Searcher

## Your Role
Search the web for information on given topics.

## Workflow
1. Receive search query
2. Use /search to find information
3. Send findings to analyzer
```

**meshes/agents/researcher/analyzer/prompt.md:**
```markdown
# Researcher - Analyzer

## Your Role
Analyze search results and extract key findings.

## Workflow
1. Receive search results from searcher
2. Analyze and summarize
3. Send to reporter
```

**meshes/agents/researcher/reporter/prompt.md:**
```markdown
# Researcher - Reporter

## Your Role
Compile final report from findings.

## Workflow
1. Receive analyzed findings
2. Write comprehensive report
3. Mark complete
```

### Run Multi-Agent Workflow

```bash
# Spawn searcher (entry point)
tx spawn researcher searcher --init "Research machine learning"

# Monitor progress
tx status

# See all active agents
tmux list-sessions
```

---

## Message Format

All messages are Markdown with YAML frontmatter:

```markdown
---
from: mesh/agent
to: next-agent
type: task | task-complete | ask | handoff
status: pending | completed | rejected
msg-id: unique-id
timestamp: ISO-timestamp
---

# Message Title

Message content here...
```

### Example: Completing a Task

Agent saves to `.ai/tx/mesh/researcher/agents/searcher/msgs/`:

```markdown
---
from: researcher/searcher
to: researcher/analyzer
type: task-complete
status: completed
timestamp: 2025-10-17T06:00:00Z
---

# Search Results: Machine Learning

Found 10 articles about machine learning:

1. "Introduction to ML" - example.com/ml-intro
2. "Deep Learning Guide" - example.com/deep-learning
...
```

System will automatically:
1. Move message to complete
2. Create handoff to next agent
3. Queue next agent for processing

---

## File Structure During Execution

### Mesh Directory
```
.ai/tx/mesh/researcher/
├── agents/
│   ├── searcher/
│   │   ├── msgs/        # Agent's queue (same structure)
│   │   └── prompts/     # Saved prompts
│   ├── analyzer/
│   │   └── msgs/
│   └── reporter/
│       └── msgs/
├── shared/
│   └── output/          # Shared workspace
├── state.json           # Mesh state
└── agents/
    └── [agent-name]/prompts/
        └── [timestamp]-prompt.md
```

---

## Commands Reference

### System Control
```bash
tx start              # Start system + core mesh
tx stop               # Stop everything
```

### Agent Management
```bash
tx spawn <mesh> [agent]           # Spawn agent
tx spawn <mesh> --init "task"     # With initial task
tx stop <mesh> [agent]            # Stop mesh or agent
tx attach                         # Attach to active
```

### Information
```bash
tx status             # Show mesh/queue status
tx prompt <mesh> [agent]  # Display prompt
```

### Tools
```bash
tx tool search "query"    # Search web
```

---

## Troubleshooting

### Sessions Not Starting

**Problem:** `tmux` command not found
```bash
# Install tmux
brew install tmux        # macOS
apt-get install tmux     # Ubuntu
```

**Problem:** "Failed to create session"
```bash
# Clean up old sessions
tmux kill-server
tx stop
```

### Messages Not Processing

**Problem:** Queue stuck
```bash
# Check logs
tail -f .ai/tx/logs/debug.jsonl

# Check mesh state
cat .ai/tx/mesh/[mesh-name]/state.json

# Verify files exist
ls -la .ai/tx/mesh/[mesh-name]/msgs/
```

### SearXNG Not Available

**Problem:** Search fails with "SearXNG unavailable"
```bash
# Check if running
curl http://localhost:12321/status

# Install SearXNG if needed
docker run -d -p 12321:8888 searxng/searxng
```

---

## Common Workflows

### Search and Report
```bash
# Create mesh with searcher → reporter
tx spawn search-report searcher --init "Search: AI trends"
# Agent searches, then creates report
```

### Parallel Analysis
Use map-reduce in mesh config:
```json
{
  "type": "map-reduce",
  "entry_point": "coordinator",
  "completion_agent": "synthesizer"
}
```

### Iterative Refinement
Use iterative workflow:
```json
{
  "type": "iterative",
  "entry_point": "generator",
  "completion_agent": "finalizer"
}
```

---

## Advanced: Creating Custom Meshes

### 1. Create Config
`meshes/mesh-configs/my-mesh.json`:
```json
{
  "mesh": "my-mesh",
  "type": "ephemeral",
  "description": "My custom mesh",
  "agents": ["my-mesh/agent-1", "my-mesh/agent-2"],
  "type": "sequential",
  "entry_point": "agent-1",
  "completion_agent": "agent-2"
}
```

### 2. Create Agent Prompts
```bash
mkdir -p meshes/agents/my-mesh/agent-1
mkdir -p meshes/agents/my-mesh/agent-2

# Write prompts
echo "# Agent 1 Prompt" > meshes/agents/my-mesh/agent-1/prompt.md
echo "# Agent 2 Prompt" > meshes/agents/my-mesh/agent-2/prompt.md
```

### 3. Create Configs (Optional)
```bash
echo '{
  "name": "agent-1",
  "description": "First agent",
  "capabilities": ["search"]
}' > meshes/agents/my-mesh/agent-1/config.json
```

### 4. Spawn and Test
```bash
tx spawn my-mesh agent-1 --init "Test task"
tx status
```

---

## Integration with Claude Code

### @ File Attachment
The orchestration system uses Claude Code's @ file attachment:
```
@<file-path>
```

The prompt is saved to `.ai/tx/mesh/[mesh]/agents/[agent]/prompts/[timestamp]-prompt.md` and injected via @ attachment.

### Claude Code Commands
Agents can use these within Claude Code:
```
/tx-done              # Mark task complete
/search "query"       # Search (if capability added)
/ask agent-name "Q"   # Ask another agent
```

---

## Performance Tips

1. **Archive old tasks**: The system auto-archives tasks older than 30 days
2. **Monitor logs**: Check `debug.jsonl` for slow operations
3. **Use mock-mode for testing**: Set `MOCK_MODE=true` to skip tmux
4. **Keep prompts concise**: Smaller prompts = faster injection

---

## Environment Variables

```bash
# SearXNG URL
SEARXNG_URL=http://localhost:12321

# Enable debug logging
TX_DEBUG_MODE=true

# Test mode (no tmux)
MOCK_MODE=true
```

---

## Need Help?

### Show Help
```bash
tx --help
tx <command> --help
```

### View Logs
```bash
tail -f .ai/tx/logs/debug.jsonl
tail -f .ai/tx/logs/error.jsonl
```

### Check Status
```bash
tx status
tmux list-sessions
```

### Reset System
```bash
tx stop
rm -rf .ai/tx
npm test
```

---

## What's Next?

1. ✅ Try basic single-agent workflow
2. ✅ Test multi-agent workflow
3. ✅ Create custom mesh
4. ✅ Integrate with SearXNG
5. ✅ Build advanced capabilities

Happy meshing! 🚀

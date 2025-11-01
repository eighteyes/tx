# TX Architecture

Understanding TX's design, components, and workflows.

---

## System Overview

TX orchestrates AI CLI tools (Claude Code, Codex, etc.) using tmux sessions for isolation and file-based messaging for communication.

```
┌─────────────────────────────────────────────────────────┐
│                       User/Core                          │
│                   (coordinator CLI)                      │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴───────────┐
        │   TX CLI (bin/tx.js)   │
        │  - Command routing     │
        │  - Mesh spawning       │
        │  - Message validation  │
        └────────┬───────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│ tmux  │   │ tmux  │   │ tmux  │
│ core  │   │ brain │   │ mesh-X│
│       │   │       │   │       │
│Claude │   │Claude │   │Claude │
└───┬───┘   └───┬───┘   └───┬───┘
    │           │           │
    │     ┌─────▼────────┐  │
    └────►│ Filesystem   │◄─┘
          │  Messages    │
          │ (.ai/tx/mesh)│
          └──────────────┘
```

---

## Core Components

### 1. CLI Entry Point (`bin/tx.js`)
- Parses commands
- Routes to command handlers
- Manages global state

### 2. Command Handlers (`lib/commands/`)
- `spawn.js` - Mesh lifecycle management
- `list.js` - Mesh catalog
- `watch.js` - File monitoring
- `tool.js` - Search, web fetch capabilities

### 3. Prompt Builder (`lib/prompt-builder.js`)
- Assembles agent prompts from:
  - Agent-specific prompt.md
  - Mesh configuration
  - Capabilities
  - Routing rules
  - System templates

### 4. Validator (`lib/validator.js`)
- Message frontmatter validation
- Mesh configuration validation
- Routing rules validation

### 5. File Watcher (`lib/file-watcher-manager.js`)
- Uses Chokidar v4
- Delta tracking (only new content)
- Debouncing (1s default)
- State persistence

---

## Stay-in-Place Messaging

### Traditional Approach (File Moving)
```
Agent A writes → inbox/ → Agent B reads → archive/
```
**Problems:** I/O overhead, race conditions, lost messages

### TX Approach (File References)
```
Agent A writes → stays in place
                     ↓
              @filepath injected to Agent B
                     ↓
              Agent B reads via reference
```
**Benefits:** Single source of truth, audit trails, resumability

---

## Mesh Lifecycle

### 1. Spawn Request
```bash
tx spawn brain
```

### 2. Validation
- Check mesh config exists
- Validate agent definitions
- Verify routing rules

### 3. Workspace Initialization
```
.ai/tx/mesh/brain/
├── agents/
│   └── brain/
│       ├── msgs/          # Created
│       ├── workspace/     # Created
│       └── prompts/       # Created
└── workspace/             # Created (mesh-level)
```

### 4. Tmux Session Creation
```bash
tmux new-session -d -s brain
tmux send-keys -t brain "claude-code --dangerously-skip-permissions" Enter
```

### 5. Prompt Injection
```bash
# Build prompt
tx-prompt-builder brain brain > .ai/tx/mesh/brain/agents/brain/prompts/prompt.md

# Inject via tmux
tmux send-keys -t brain "@/path/to/prompt.md" Enter
```

### 6. Ready State
Agent is now listening for messages via file watcher.

---

## Message Flow

### 1. Message Creation
Core writes:
```markdown
.ai/tx/mesh/core/agents/core/msgs/task-001.md
```

### 2. Watcher Detection
```javascript
chokidar.watch('.ai/tx/mesh/**/msgs/*.md')
  .on('add', (filepath) => {
    // Parse frontmatter
    const msg = parseMessage(filepath);

    // Validate
    if (!validateMessage(msg)) return;

    // Route
    routeMessage(msg);
  });
```

### 3. Routing Logic
```javascript
function routeMessage(msg) {
  const target = msg.to; // e.g., "brain/brain"
  const [mesh, agent] = target.split('/');

  // Inject reference to target session
  tmux.sendKeys(mesh, `@${msg.filepath}`);
}
```

### 4. Agent Processing
Agent reads file, processes, writes response:
```markdown
.ai/tx/mesh/brain/agents/brain/msgs/response-001.md
```

### 5. Response Routing
Watcher detects response, routes back to originator.

---

## File Watcher System

### Architecture
```
┌─────────────────────────────────────┐
│     FileWatcherManager              │
│  - Manages multiple watchers        │
│  - State persistence                │
│  - Delta tracking                   │
└──────────┬──────────────────────────┘
           │
    ┌──────┴──────┐
    │             │
┌───▼──────┐ ┌───▼──────┐
│ Watcher1 │ │ Watcher2 │
│ (error)  │ │ (debug)  │
└──────────┘ └──────────┘
```

### Delta Tracking
```javascript
class DeltaTracker {
  constructor(filepath) {
    this.filepath = filepath;
    this.lastLine = 0;
  }

  async getNewContent() {
    const lines = await readLines(this.filepath);
    const newLines = lines.slice(this.lastLine);
    this.lastLine = lines.length;
    return newLines;
  }
}
```

### State Persistence
```json
{
  "meshName": "error-fixer",
  "watchedFile": "/workspace/.ai/tx/logs/error.jsonl",
  "lastProcessedLine": 42,
  "lastProcessedAt": "2025-10-30T10:00:00Z",
  "totalChangesProcessed": 15
}
```

---

## Routing System

### Routing Rules Format
```json
{
  "routing": {
    "agent-name": {
      "status": {
        "target-agent": "completion message"
      }
    }
  }
}
```

### Example: TDD Cycle
```json
{
  "red-phase": {
    "complete": {
      "green-phase": "Test written"
    },
    "blocked": {
      "core": "Cannot proceed"
    }
  }
}
```

### Routing Logic
1. Agent finishes work
2. Writes message with `status: complete`
3. Router checks: `routing[agent][status]`
4. Routes to target with completion message
5. Target agent receives and processes

---

## Capability System

Capabilities are prompt-based tools injected into agents.

### Structure
```
meshes/prompts/capabilities/
├── search/
│   └── capability.md
├── watch/
│   └── capability.md
└── spawn/
    └── capability.md
```

### Example: Search Capability
```markdown
# Search Capability

Use `tx tool search` to search across 20+ sources.

## Usage
tx tool search '<query>' [options]

## Sources
- reddit, stackoverflow, arxiv, github, ...

## Examples
tx tool search 'react hooks' -s stackoverflow
```

### Injection
When mesh config includes `"capabilities": ["search"]`, the search capability prompt is appended to agent prompt.

---

## Evidence Logging

Brain agent reads `.ai/tx/logs/evidence.jsonl` for insights.

### Evidence Format
```json
{
  "timestamp": "2025-10-30T10:00:00Z",
  "mesh": "brain",
  "agent": "brain",
  "event": "spec-graph-updated",
  "details": {
    "entities": 48,
    "dependencies": 36
  }
}
```

### Brain's Use
- Learns patterns from evidence
- Builds project understanding
- Provides context to other agents

---

## Security Model

### Isolation Layers
1. **Tmux sessions** - Process isolation
2. **Filesystem permissions** - File access control
3. **Optional: Docker** - Container isolation
4. **Optional: VMs** - Full system isolation

### Risk Mitigation
- `--dangerously-skip-permissions` required (explicit opt-in)
- Recommend containerization ([safe-claude](https://github.com/eighteyes/safe-claude))
- Audit trails via message files
- Observable workflows via tmux

---

## Performance Considerations

### Bottlenecks
1. **File I/O** - Mitigated by stay-in-place messaging
2. **Tmux overhead** - Minimal, one-time session creation
3. **AI CLI response time** - Depends on provider/model

### Optimizations
- Delta tracking (don't reprocess entire files)
- Debouncing (batch rapid changes)
- Parallel meshes (fan-out topology)
- Persistent sessions (no repeated spawns)

---

## Directory Structure

```
tx-cli/
├── bin/
│   └── tx.js                    # CLI entry point
├── lib/
│   ├── commands/                # Command implementations
│   ├── prompt-builder.js        # Prompt assembly
│   ├── validator.js             # Validation logic
│   ├── file-watcher-manager.js  # File watching
│   └── paths.js                 # Path utilities
├── meshes/
│   ├── agents/                  # Agent configurations
│   │   └── {mesh}/
│   │       └── {agent}/
│   │           ├── prompt.md    # Agent prompt
│   │           └── config.json  # Agent config (optional)
│   ├── mesh-configs/            # Mesh definitions
│   │   └── {mesh}.json
│   └── prompts/
│       ├── capabilities/        # Capability prompts
│       └── templates/           # System templates
└── .ai/tx/                      # Runtime directory
    ├── mesh/                    # Mesh workspaces
    │   └── {mesh}/
    │       ├── agents/{agent}/
    │       │   ├── msgs/        # Agent messages (stay here!)
    │       │   ├── workspace/   # Agent workspace
    │       │   └── prompts/     # Generated prompts
    │       └── workspace/       # Shared mesh workspace
    ├── logs/
    │   ├── debug.jsonl          # System logs
    │   ├── error.jsonl          # Error logs
    │   └── evidence.jsonl       # Agent observations
    └── state/
        ├── queues/              # Message queues
        └── watchers/            # Watcher state
```

---

## Design Principles

### 1. Explicit Over Implicit
Commands are explicitly invoked, not auto-selected.

### 2. Observable Workflows
Everything happens in tmux sessions you can attach to.

### 3. Context Isolation
Each agent has focused, dedicated context.

### 4. Composability
Meshes can invoke other meshes.

### 5. Human-in-the-Loop
Critical decisions involve humans at appropriate points.

### 6. Auditability
All interactions logged via message files.

---

## Extending TX

### Add New Mesh
1. Create `meshes/mesh-configs/my-mesh.json`
2. Create agent prompts in `meshes/agents/my-mesh/`
3. Test: `tx spawn my-mesh`

### Add New Capability
1. Create `meshes/prompts/capabilities/my-capability/capability.md`
2. Add to mesh config: `"capabilities": ["my-capability"]`
3. Use in agent prompts

### Add New Command
1. Create `lib/commands/my-command.js`
2. Register in `bin/tx.js`
3. Test: `tx my-command`

---

## Need Help?

- **[Getting Started](./getting-started.md)** - Setup guide
- **[Commands Reference](./commands.md)** - CLI commands
- **[Message System](./messages.md)** - Agent communication
- **[Available Meshes](./meshes.md)** - Mesh catalog
- **[Troubleshooting](./troubleshooting.md)** - Common issues

---

**Next:** [Troubleshooting →](./troubleshooting.md)

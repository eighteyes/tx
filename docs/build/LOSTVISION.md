# Agent Orchestration System - Technical Specifications

**Extracted from source code analysis - 2025-10-17**

## System Architecture

The system is a **file-based multi-agent orchestration platform** that uses tmux sessions and file system watchers to coordinate AI agents.

### Core Components

1. **Meshes** - Isolated workspaces containing agents
2. **Agents** - Specialized AI instances with defined roles
3. **Messages** - Markdown files with frontmatter for routing
4. **Queues** - FIFO message queues (inbox → next → active → complete)
5. **Watcher** - File system monitor using chokidar
6. **Event Bus** - Internal event system for coordination

---

## Message Format Specification

### File Structure

```markdown
---
from: source-mesh/source-agent
to: destination
type: task|ask|ask-response|task-complete|error
status: pending|active|handoff|complete
msg-id: unique-message-id
timestamp: ISO-8601-timestamp
---

# Message Title

Message content here
```

### Message Class (`lib/message.js`)

**Timestamp Format**: `YYMMDDHHMM`

**Filename Pattern**: `{timestamp}-{sanitized-task}.md`

**Methods**:
- `Message.send(mesh, task, context, metadata)` - Create message in mesh inbox
- `Message.parseMessage(filepath)` - Parse frontmatter and body
- `Message.getMessages(meshDir, queue)` - List messages in queue
- `Message.moveMessage(meshDir, filename, fromQueue, toQueue)` - Move between queues
- `Message.removeMessage(filepath)` - Delete message

**Routing Destinations**:
- `to: agent-name` - Route to agent within mesh
- `to: mesh-name` - Route to different mesh
- `to: mesh` - Complete workflow at mesh level

---

## Queue System Specification

### Queue Flow

```
inbox → next → active → complete → archive
```

**FIFO Processing**: First In, First Out

### Queue Class (`lib/queue.js`)

**Initialization**: `Queue.init()` - Registers event listeners

**Event-Driven Processing**:
- `file:inbox:new` → Process inbox
- `queue:process:next` → Process next
- `file:complete:new` → Process next
- `file:active:removed` → Process next

**Methods**:

#### Mesh-Level Queues
- `processInbox(mesh)` - Move first inbox message to next (if next empty)
- `processNext(mesh)` - Move first next message to active (if active empty)
- `complete(mesh, filename)` - Move active to complete, advance workflow
- `archive(mesh, daysOld)` - Move old complete messages to archive
- `getQueueStatus(mesh)` - Get counts for all queues

#### Agent-Level Queues
- `processAgentInbox(mesh, agent)` - Agent inbox → next
- `processAgentNext(mesh, agent)` - Agent next → active
- `completeAgentTask(mesh, agent, filename)` - Agent active → complete + mesh active → complete

### Workflow Advancement

**Sequential Workflow**: When task completes, creates handoff message for next agent

```javascript
// Workflow state tracking
{
  workflow: ["agent1", "agent2", "agent3"],
  workflow_position: 0,
  current_agent: "agent1",
  previous_agent: null,
  workflow_complete: false
}
```

**Handoff Message Template**:
```markdown
---
from: mesh/current-agent
to: mesh/next-agent
type: task
status: handoff
timestamp: ISO-timestamp
---

# Handoff from current-agent to next-agent

## Previous Work

[Previous agent's output]
```

---

## File Watcher Specification

### Watcher Class (`lib/watcher.js`)

**Library**: chokidar

**Watch Pattern**: `.ai/tx/mesh/**/msgs/**/*.md`

**Configuration**:
```javascript
{
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 100
  }
}
```

**Events Emitted**:
- `file:{queue}:new` - File added to queue
- `file:{queue}:changed` - File modified
- `file:{queue}:removed` - File deleted
- `watcher:started` - Watcher initialized
- `watcher:stopped` - Watcher shutdown

**Methods**:
- `Watcher.start()` - Start watching
- `Watcher.stop()` - Stop watching
- `Watcher.isRunning()` - Check status
- `Watcher.ready()` - Promise that resolves when ready

**Path Parsing**:
```javascript
// Example: .ai/tx/mesh/test/msgs/inbox/file.md
_parseQueueFromPath(filepath)  // → "inbox"
_parseMeshFromPath(filepath)   // → "test"
```

---

## Mesh Configuration

### Mesh Config Schema (`meshes/mesh-configs/{mesh}.json`)

```json
{
  "mesh": "mesh-name",
  "type": "persistent|ephemeral|task",
  "description": "Purpose description",
  "agents": ["category/agent-name", ...],
  "workflow": ["agent1", "agent2"] | {map: [...], reduce: [...]},
  "topology": "sequential|parallel|map-reduce",
  "capabilities": ["cap1", "cap2"],
  "storage": {
    "shared": true,
    "concepts_path": "shared/concepts"
  },
  "validation_gates": ["gate1", "gate2"],
  "type": "sequential",
  "entry_point": "agent-name",
  "completion_agent": "agent-name"
}
```

**Required Fields**:
- `mesh` - Mesh identifier
- `type` - Lifecycle type
- `agents` - Agent list

**Optional Fields**:
- `description` - Human-readable purpose
- `workflow` - Agent sequence or map-reduce structure
- `topology` - Explicit topology declaration
- `capabilities` - Mesh-level capabilities
- `storage` - Shared storage configuration
- `validation_gates` - Validation checkpoints

### Mesh Types

1. **persistent** - Long-running, survives restarts
2. **ephemeral** - Temporary, deleted after completion
3. **task** - Single-purpose, auto-cleanup

---

## Agent Configuration

### Agent Config Schema (`meshes/agents/{category}/{agent}/config.json`)

```json
{
  "name": "agent-name",
  "description": "Agent purpose",
  "capabilities": ["cap1", "cap2"],
  "options": {
    "model": "claude-opus|claude-sonnet|claude-haiku",
    "output": "clean|verbose"
  }
}
```

### Agent Directory Structure

```
meshes/agents/{category}/{agent}/
├── config.json           # Agent configuration
├── prompt.md            # Agent role and instructions
├── task.md              # Optional: current task
└── capabilities/        # Optional: custom capabilities

.ai/tx/mesh/{mesh}/agents/{agent}/
├── msgs/
│   ├── inbox/          # Incoming messages
│   ├── next/           # Queued (next to process)
│   ├── active/         # Currently processing
│   ├── complete/       # Finished tasks
│   └── outbox/         # Outgoing messages
├── prompts/            # Generated prompts
│   └── {timestamp}-prompt.md
└── workspace/          # Agent-specific files
```

---

## Prompt Building

### Prompt Builder (`lib/prompt-builder.js`)

**Build Order**:
1. Preamble (mesh context, commands)
2. Agent Prompt (from `prompt.md`)
3. Task (from `task.md` if exists)
4. Capabilities (from config.json + capability templates)
5. Workflow (from templates)

**Template Variables**:
- `{{mesh}}` - Mesh name
- `{{agent}}` - Agent name

**Preamble Template**:
```markdown
# Agent Orchestration - Session

You are running as Claude inside a tmux session managed by the agent orchestration system.

## Your Context
- **Mesh**: {mesh}
- **Agent**: {agent}
- **Workspace**: `.ai/tx/mesh/{mesh}/agents/{agent}/`

## How to Work
1. Read your incoming task from: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/active/`
2. Save your work to: `.ai/tx/mesh/{mesh}/shared/output/`
3. When done, use `/tx-done` to mark task complete

## File Paths
- **Inbox**: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/inbox/`
- **Active**: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/active/`
- **Outbox**: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/outbox/`
- **Complete**: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/complete/`
- **Shared output**: `.ai/tx/mesh/{mesh}/shared/output/`

## Important Commands
- `/tx-done` - Mark current task complete
- `/tx-next` - Request next task
- `/search query` - Search the web (SearXNG)
- `/ask agent-name "question"` - Ask another agent
```

---

## Orchestration Commands

### CLI Commands (`lib/commands/`)

**spawn** - Create new agent session
```bash
tx spawn <mesh> [agent] [--init "task description"]
```
- Creates tmux session: `{mesh}-{agent}`
- Builds and injects prompt
- Sends initial task if provided
- Updates mesh state to 'active'

**start** - Start the orchestration system
```bash
tx start
```
- Initializes queue system
- Starts file watcher
- Loads mesh configurations

**attach** - Attach to agent session
```bash
tx attach [mesh] [agent]
```
- Attaches to tmux session
- Shows session context

**kill** - Terminate agent session
```bash
tx kill <mesh> [agent]
```
- Kills tmux session
- Cleans up state

**status** - Show system status
```bash
tx status [mesh]
```
- Lists all meshes
- Shows queue counts
- Displays active agents

**stop** - Stop the orchestration system
```bash
tx stop
```
- Stops file watcher
- Preserves state for restart

**prompt** - View agent prompt
```bash
tx prompt <mesh> [agent]
```
- Displays built prompt
- Shows all sections

---

## Topology Implementations

### 1. Sequential Topology

**Config**:
```json
{
  "topology": "sequential",
  "workflow": ["agent1", "agent2", "agent3"]
}
```

**Behavior**:
- Tasks flow linearly through agents
- Each agent completes before next starts
- Handoff messages created automatically

**Use Cases**: Validation chains, progressive refinement

### 2. Parallel Topology

**Config**:
```json
{
  "topology": "parallel",
  "agents": ["agent1", "agent2", "agent3"]
}
```

**Behavior**:
- Same task broadcast to all agents
- Agents process independently
- All must complete before workflow finishes

**Use Cases**: Multi-perspective analysis, redundancy

### 3. Map-Reduce Topology

**Config**:
```json
{
  "topology": "map-reduce",
  "workflow": {
    "map": ["mapper1", "mapper2", "mapper3"],
    "reduce": ["reducer"]
  }
}
```

**Behavior**:
- Map phase: parallel processing
- Reduce phase: sequential aggregation
- Hybrid topology

**Use Cases**: Data processing, distributed computation

### 4. Hierarchical Topology

**Config**:
```json
{
  "agents": ["orchestrator", "specialist1", "specialist2", "..."]
}
```

**Behavior**:
- Orchestrator coordinates specialists
- Dynamic task delegation
- No explicit topology field (inferred)

**Use Cases**: Complex planning, task decomposition

---

## State Management

### Atomic State (`lib/atomic-state.js`)

**File**: `.ai/tx/mesh/{mesh}/state.json`

**State Schema**:
```json
{
  "mesh": "mesh-name",
  "status": "idle|active|processing|complete",
  "current_agent": "agent-name",
  "previous_agent": "agent-name",
  "workflow": ["agent1", "agent2"],
  "workflow_position": 0,
  "workflow_complete": false,
  "tasks_completed": 0,
  "started_at": "ISO-timestamp",
  "updated_at": "ISO-timestamp"
}
```

**Methods**:
- `AtomicState.read(mesh)` - Read current state
- `AtomicState.update(mesh, updates)` - Async update
- `AtomicState.updateSync(mesh, updates)` - Sync update
- `AtomicState.initialize(mesh, initialState)` - Create new state

---

## Event Bus

**Events**:
- `watcher:started` / `watcher:stopped`
- `file:{queue}:new` / `file:{queue}:changed` / `file:{queue}:removed`
- `task:queued` / `task:activated`
- `queue:process:next`

**Usage**:
```javascript
EventBus.on('event-name', (data) => { ... });
EventBus.emit('event-name', data);
```

---

## Key Design Principles

1. **File-based coordination** - No central message broker
2. **Event-driven** - Watcher triggers queue processing
3. **FIFO queues** - Deterministic message ordering
4. **Atomic operations** - File moves are atomic
5. **Stateless agents** - All state in messages and shared storage
6. **Composable topologies** - Can nest and combine patterns
7. **Hot-reload** - File changes detected automatically

---

## Directory Structure

```
.ai/tx/
├── mesh/
│   ├── {mesh-name}/
│   │   ├── agents/
│   │   │   └── {agent-name}/
│   │   │       ├── msgs/
│   │   │       │   ├── inbox/
│   │   │       │   ├── next/
│   │   │       │   ├── active/
│   │   │       │   ├── complete/
│   │   │       │   ├── outbox/
│   │   │       │   └── quarantine/
│   │   │       ├── prompts/
│   │   │       └── workspace/
│   │   ├── shared/
│   │   │   ├── output/
│   │   │   └── concepts/
│   │   ├── msgs/
│   │   │   ├── inbox/
│   │   │   ├── next/
│   │   │   ├── active/
│   │   │   └── complete/
│   │   └── state.json
│   └── ...

meshes/
├── agents/
│   ├── {category}/
│   │   └── {agent}/
│   │       ├── config.json
│   │       ├── prompt.md
│   │       └── task.md
└── mesh-configs/
    └── {mesh}.json

lib/
├── message.js
├── queue.js
├── watcher.js
├── prompt-builder.js
├── atomic-state.js
├── event-bus.js
└── commands/
    ├── spawn.js
    ├── start.js
    ├── kill.js
    ├── attach.js
    ├── status.js
    └── stop.js
```

---

**End of Specifications**

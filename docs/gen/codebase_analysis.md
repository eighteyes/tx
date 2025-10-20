# Agent Orchestration Codebase Structure Analysis

## Overview
The system is a Claude agent orchestration framework that manages multi-agent workflows through tmux sessions. It provides a file-based message queue system for agent-to-agent communication and task management.

---

## 1. Entry Points and Command Structure

### Main CLI Entry Point: `/workspace/tmux-riffic-v2/bin/tx.js`

This file defines the command-line interface using `commander.js`. Key commands:

**Core Commands:**
- `tx start` - Starts the orchestration system and core mesh (with optional detach mode)
- `tx attach` - Attaches to active tmux sessions
- `tx spawn <mesh> [agent]` - Spawns a new agent in a mesh
- `tx kill <mesh> [agent]` - Kills mesh or agent sessions
- `tx status` - Shows system status and queue info
- `tx stop` - Stops the orchestration system and kills all sessions
- `tx prompt <mesh> [agent]` - Displays generated prompt for a mesh/agent
- `tx tool <name>` - Runs capabilities/tools

---

## 2. Flow Analysis: `tx start` Command

**File:** `/workspace/tmux-riffic-v2/lib/commands/start.js`

### Execution Flow:

1. **System Initialization** (via `SystemManager.start()`)
   - Initializes Queue event listeners
   - Starts file watcher (chokidar)
   - Waits for watcher to be ready

2. **Directory Initialization** (via `DirectoryInitializer.initializeAll()`)
   - Creates mesh-level message directories: inbox, next, active, complete, archive
   - Creates agent-level message directories for the core agent
   - Base path: `.ai/tx/mesh/{mesh}/msgs/`

3. **tmux Session Creation** (via `TmuxInjector`)
   - Creates a tmux session named "core"
   - Launches Claude CLI inside the session
   - Waits 3 seconds for Claude to initialize

4. **Prompt Injection** (via `PromptBuilder.build()`)
   - Builds complete agent prompt from components
   - Saves to `.ai/tx/mesh/core/agents/core/prompts/core-prompt.md`
   - Injects via Claude's file attachment (@) feature

5. **Attachment** (unless `--detach` flag)
   - Attaches terminal to the core tmux session
   - User can directly interact with Claude

---

## 3. Flow Analysis: `tx attach` Command

**File:** `/workspace/tmux-riffic-v2/lib/commands/attach.js`

### Execution Flow:

1. **List Active Sessions**
   - Uses `TmuxInjector.listSessions()`
   - Executes: `tmux list-sessions -F '#{session_name}'`

2. **Session Selection Logic**
   - If 0 sessions: Error message, suggest `tx start`
   - If 1 session: Attach directly
   - If multiple sessions: Display menu (attaches to first for now)

3. **Attachment**
   - Executes: `tmux attach -t {session_name}`
   - User can detach with Ctrl+B + D

---

## 4. Configuration File Loading

### Mesh Configuration
**Location:** `/workspace/tmux-riffic-v2/meshes/mesh-configs/{mesh-name}.json`

Example structure:
```json
{
  "mesh": "core",
  "type": "ephemeral",
  "description": "Core/brain mesh - entry point for the agent orchestration system",
  "agents": ["core/core"],
  "type": "sequential",
  "entry_point": "core",
  "completion_agent": "core"
}
```

### Agent Configuration
**Location:** `/workspace/tmux-riffic-v2/meshes/agents/{mesh}/{agent}/config.json`

Example:
```json
{
  "name": "core",
  "description": "Core brain - coordinates all meshes",
  "capabilities": ["search"],
  "options": {
    "model": "claude-opus",
    "output": "clean"
  }
}
```

### Agent Prompt Files
**Location:** `/workspace/tmux-riffic-v2/meshes/agents/{mesh}/{agent}/prompt.md`

Contains agent-specific system prompt

### Loading Flow (via `PromptBuilder.build()`)

1. **Preamble** - Generic system introduction (or custom from `prompts/templates/system/preamble.md`)
2. **Agent Prompt** - Read from `meshes/agents/{mesh}/{agent}/prompt.md`
3. **Task** - Read from `meshes/agents/{mesh}/{agent}/task.md` (if exists)
4. **Capabilities** - Load from `prompts/capabilities/{capability}/{capability}.md` (listed in config.json)
5. **Workflow** - Read from `prompts/templates/system/workflow.md`
6. **Combine and Save** - Full prompt saved to `.ai/tx/mesh/{mesh}/agents/{agent}/prompts/{timestamp}-prompt.md`

---

## 5. Tmux Initialization Flow

**File:** `/workspace/tmux-riffic-v2/lib/tmux-injector.js`

### Key Methods:

1. **`createSession(session, command)`**
   - Command: `tmux new-session -d -s {session} '{command}'`
   - Creates detached tmux session running specified command (e.g., 'bash')

2. **`send(session, keys)`**
   - Command: `tmux send-keys -t {session} '{keys}'`
   - Sends raw keystrokes to session

3. **`injectFile(session, filepath)`**
   - Simulates: `@ → sleep(500) → filepath → sleep(500) → Enter`
   - Triggers Claude's file attachment dialog
   - Injects prompt file path

4. **`injectCommand(session, command)`**
   - Simulates: `/ → sleep(500) → command → sleep(500) → Enter`
   - Triggers Claude's command palette
   - Injects command

5. **`injectText(session, text)`**
   - Splits text into 2000-char chunks (tmux limit)
   - Sends chunks with newlines between them
   - For large prompts

6. **`listSessions()`**
   - Command: `tmux list-sessions -F '#{session_name}'`
   - Returns array of active session names

7. **`killSession(session)`**
   - Command: `tmux kill-session -t {session}`
   - Destroys session

### Initialization Sequence (in `start.js`):

```
1. createSession('core', 'bash')
   └─> tmux new-session -d -s core 'bash'

2. send('core', 'claude')
   └─> tmux send-keys -t core 'claude'

3. send('core', 'Enter')
   └─> tmux send-keys -t core 'Enter'

4. Wait 3 seconds (for Claude CLI startup)

5. injectFile('core', promptFile)
   └─> @ → filepath → Enter
```

---

## 6. System Architecture: Message Queue and File Watcher

### SystemManager (Orchestrator)
**File:** `/workspace/tmux-riffic-v2/lib/system-manager.js`

Coordinates startup and shutdown:
1. Initialize Queue (registers event listeners)
2. Start Watcher (chokidar watching `.ai/tx/mesh/**/msgs/**/*.md`)
3. Wait for Watcher ready

### File Watcher
**File:** `/workspace/tmux-riffic-v2/lib/watcher.js`

Uses chokidar to watch message files:
- **Watch pattern:** `.ai/tx/mesh/**/msgs/**/*.md`
- **Events monitored:**
  - `add` - New message created
  - `change` - Message modified
  - `unlink` - Message deleted

- **Emitted Events:**
  - `file:{queue}:new` (e.g., `file:inbox:new`)
  - `file:{queue}:changed`
  - `file:{queue}:removed`

### Queue System
**File:** `/workspace/tmux-riffic-v2/lib/queue.js`

Manages task workflow through five queues:
- **inbox** - Incoming tasks
- **next** - Tasks queued for processing
- **active** - Currently processing
- **complete** - Finished tasks
- **archive** - Old completed tasks

### Message Flow:

```
inbox → next → active → complete → archive
```

**Processing Logic:**
- `processInbox()` - Moves first message from inbox to next (if next is empty)
- `processNext()` - Moves first message from next to active (if active is empty)
- `complete()` - Moves from active to complete

**Events in Queue.init():**
- `file:inbox:new` → `processInbox()`
- `queue:process:next` → `processNext()`
- `file:complete:new` → `processNext()` (trigger next task)
- `file:active:removed` → `processNext()`

### Event Bus
**File:** `/workspace/tmux-riffic-v2/lib/event-bus.js`

Central pub/sub system with:
- Event listeners with priority
- Wildcard pattern matching (e.g., `file:*`)
- One-time listeners
- Event logging (last 1000 events)
- Statistics tracking

---

## 7. Message Format and Validation

**File:** `/workspace/tmux-riffic-v2/lib/message.js`

### Message Structure:

```markdown
---
from: sender
to: recipient
type: task|task-complete|ask|ask-response|update
status: pending|in-progress|completed|rejected|approved|start
msg-id: unique-identifier
timestamp: ISO-8601 timestamp
---

# Task Title

Task content/context
```

### Valid Values:
- **type:** task, task-complete, ask, ask-response, update
- **status:** pending, in-progress, completed, rejected, approved, start
- **msg-id:** Auto-generated from mesh + timestamp + random

### File Naming Convention:
- **Format:** `{YYMMDDHHMM}-{sanitized-task-name}.md`
- Example: `2510170700-analyze-codebase.md`

### Message Methods:
- `send(mesh, task, context, metadata)` - Create message in inbox
- `parseMessage(filepath)` - Parse frontmatter and validate
- `moveMessage(meshDir, filename, fromQueue, toQueue)` - Move between queues
- `getMessages(meshDir, queue)` - List messages in queue

---

## 8. State Management

**File:** `/workspace/tmux-riffic-v2/lib/atomic-state.js`

### State File Location:
`.ai/tx/mesh/{mesh}/state.json`

### Default State:
```json
{
  "mesh": "core",
  "status": "initialized",
  "started": "2025-10-17T07:00:00.000Z",
  "current_agent": null,
  "workflow": [],
  "workflow_position": 0,
  "tasks_completed": 0,
  "previous_agent": null,
  "active_sessions": [],
  "current_session": null
}
```

### Thread Safety:
- File-based locking (`.lock` file)
- Supports async and sync updates
- Emits `state:changed` events on update

---

## 9. Directory Structure

### Workspace Layout:

```
/workspace/tmux-riffic-v2/
├── bin/
│   └── tx.js                    # CLI entry point
├── lib/
│   ├── commands/
│   │   ├── start.js             # tx start handler
│   │   ├── attach.js            # tx attach handler
│   │   ├── spawn.js             # tx spawn handler
│   │   ├── kill.js              # tx kill handler
│   │   ├── stop.js              # tx stop handler
│   │   ├── status.js            # tx status handler
│   │   └── prompt.js            # tx prompt handler
│   ├── queue.js                 # Message queue system
│   ├── watcher.js               # File watcher (chokidar)
│   ├── message.js               # Message handling
│   ├── event-bus.js             # Event pub/sub system
│   ├── system-manager.js        # System orchestrator
│   ├── tmux-injector.js         # tmux interaction
│   ├── prompt-builder.js        # Prompt assembly
│   ├── directory-initializer.js # Directory creation
│   ├── atomic-state.js          # State management
│   └── logger.js                # Logging system
├── meshes/
│   ├── agents/                  # Agent definitions
│   │   ├── core/core/           # Core agent files
│   │   ├── test-echo/echo/      # Test agents
│   │   └── ...
│   ├── mesh-configs/            # Mesh configuration files
│   ├── prompts/
│   │   ├── capabilities/        # Capability definitions
│   │   └── templates/           # Prompt templates
│   └── config/                  # Global configs
├── .ai/tx/mesh/                 # Runtime workspace (created by system)
│   ├── core/
│   │   ├── msgs/                # Mesh message queues
│   │   ├── agents/core/         # Agent-specific dirs
│   │   ├── shared/output/       # Shared output
│   │   └── state.json           # Mesh state
│   └── ...
└── package.json
```

### Runtime Message Queue Structure:

```
.ai/tx/mesh/{mesh}/
├── msgs/
│   ├── inbox/                   # Incoming tasks
│   ├── next/                    # Queued tasks
│   ├── active/                  # Currently processing
│   ├── complete/                # Finished tasks
│   └── archive/                 # Archived messages
├── agents/{agent}/
│   ├── msgs/                    # Same queue structure
│   ├── prompts/                 # Generated prompts
│   └── outputs/                 # Agent outputs
└── state.json                   # Mesh state file
```

---

## 10. Configuration Loading Order

When spawning an agent via `tx spawn <mesh> <agent>`:

1. **Check agent config** at `meshes/agents/{mesh}/{agent}/config.json`
   - Load capabilities list
   - Load model options

2. **Initialize directories** via `DirectoryInitializer.initializeAll()`
   - Create mesh-level message queues
   - Create agent-level message queues

3. **Build prompt** via `PromptBuilder.build(mesh, agent)`
   - Load preamble (custom or default)
   - Load agent prompt.md
   - Load capabilities markdown files
   - Load workflow instructions
   - Combine into single prompt

4. **Create tmux session** and start Claude

5. **Inject prompt** via file attachment

6. **Apply agent options** if configured
   - Model selection
   - Output style

---

## 11. Key File Paths Summary

| Component | Path | Purpose |
|-----------|------|---------|
| CLI Entry | `bin/tx.js` | Command routing |
| Start Command | `lib/commands/start.js` | System initialization |
| Attach Command | `lib/commands/attach.js` | Session connection |
| Spawn Command | `lib/commands/spawn.js` | Agent creation |
| Queue System | `lib/queue.js` | Message routing |
| File Watcher | `lib/watcher.js` | Message detection |
| Prompt Builder | `lib/prompt-builder.js` | Prompt assembly |
| Tmux Interface | `lib/tmux-injector.js` | Session control |
| State Manager | `lib/atomic-state.js` | Persistent state |
| Event Bus | `lib/event-bus.js` | Event coordination |
| Message Parser | `lib/message.js` | Message handling |
| Mesh Config | `meshes/mesh-configs/*.json` | Mesh definitions |
| Agent Config | `meshes/agents/{mesh}/{agent}/config.json` | Agent options |
| Agent Prompt | `meshes/agents/{mesh}/{agent}/prompt.md` | Agent instructions |
| Capabilities | `meshes/prompts/capabilities/{cap}/{cap}.md` | Tool definitions |
| Workflow Template | `meshes/prompts/templates/system/workflow.md` | Workflow instructions |

---

## 12. Complete Command Flow Summary

### `tx start` Flow:
```
bin/tx.js (start action)
  ├─> SystemManager.start()
  │   ├─> Queue.init() (register listeners)
  │   └─> Watcher.start() (begin watching .ai/tx/mesh/**/msgs/**/*.md)
  ├─> DirectoryInitializer.initializeAll('core', 'core')
  ├─> TmuxInjector.createSession('core', 'bash')
  ├─> TmuxInjector.send('core', 'claude')
  ├─> PromptBuilder.build('core', 'core')
  ├─> TmuxInjector.injectFile('core', promptFile)
  └─> tmux attach -t core (unless --detach)
```

### `tx attach` Flow:
```
bin/tx.js (attach action)
  ├─> TmuxInjector.listSessions()
  ├─> Select session (or use only one)
  └─> tmux attach -t {session}
```

### `tx spawn <mesh> <agent>` Flow:
```
bin/tx.js (spawn action)
  ├─> Load config from meshes/agents/{mesh}/{agent}/config.json
  ├─> TmuxInjector.createSession('{mesh}-{agent}', 'bash')
  ├─> TmuxInjector.send('{mesh}-{agent}', 'claude')
  ├─> DirectoryInitializer.initializeAll(mesh, agent)
  ├─> PromptBuilder.build(mesh, agent)
  ├─> TmuxInjector.injectFile({session}, promptFile)
  ├─> Apply agent options (model, output style)
  ├─> Send initial task if provided (-i flag)
  └─> AtomicState.update() with agent info
```

---

## Key Concepts

1. **Mesh** - Logical grouping of agents working together
2. **Agent** - Individual Claude instance in a tmux session
3. **Queue** - File-based message system (inbox → next → active → complete)
4. **Workflow** - Orchestrated sequence of agents processing tasks
5. **Frontmatter** - YAML-like metadata at top of message files
6. **Injection** - Method of sending content to Claude via tmux key simulation
7. **Event-Driven** - System responds to file creation/deletion via chokidar


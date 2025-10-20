# Agent Orchestration Codebase - Architecture Diagrams

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Interface                             │
│                       (bin/tx.js)                                │
│  start | attach | spawn | kill | stop | status | prompt | tool  │
└────────────────────────┬────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌────────┐      ┌─────────┐      ┌────────┐
   │ Start  │      │ Attach  │      │ Spawn  │
   │Handler │      │Handler  │      │Handler │
   └────────┘      └─────────┘      └────────┘
        │                │               │
        └────────────────┼───────────────┘
                         ▼
        ┌────────────────────────────────┐
        │    Core Infrastructure         │
        ├────────────────────────────────┤
        │ • SystemManager                │
        │ • Tmux Injector (tmux API)     │
        │ • Prompt Builder               │
        │ • Directory Initializer        │
        └────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌──────────┐    ┌─────────┐    ┌────────────┐
   │  Queue   │    │ Watcher │    │ EventBus   │
   │ System   │    │ System  │    │ (PubSub)   │
   └──────────┘    └─────────┘    └────────────┘
        │                │               ▲
        │                └───────────────┘
        │
   ┌────────────────────────────────┐
   │  Runtime Files & State         │
   ├────────────────────────────────┤
   │ .ai/tx/mesh/{mesh}/            │
   │  ├─ msgs/ (queue dirs)         │
   │  ├─ agents/{agent}/            │
   │  └─ state.json                 │
   └────────────────────────────────┘
```

---

## `tx start` Execution Flow

```
User: tx start
  │
  ▼
┌─────────────────────────────────┐
│ bin/tx.js                       │
│ - Parse args                    │
│ - Call start({detach: false})   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ lib/commands/start.js           │
└──────────────┬──────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌──────────────┐   ┌──────────────────────┐
│SystemManager │   │DirectoryInitializer  │
│.start()      │   │.initializeAll()      │
│              │   │                      │
│1. Queue.init │   │- Create .ai/tx/mesh/ │
│2.Watcher.    │   │- Create msgs/ dirs   │
│  start()     │   │- Create agent/ dirs  │
└──────┬───────┘   └──────────────────────┘
       │
    ┌──┴────────────────────────────────┐
    ▼                                    ▼
┌──────────────┐              ┌──────────────────┐
│ Queue        │              │ Watcher          │
│.init()       │              │.start()          │
│              │              │                  │
│Register all  │              │Chokidar watch:   │
│event         │              │.ai/tx/mesh/**/   │
│listeners:    │              │msgs/**/*.md      │
│- file:*:new  │              │                  │
│- queue:*     │              │Emit events:      │
│- file:*:     │              │- file:X:new     │
│  removed     │              │- file:X:changed │
└──────┬───────┘              └─────────┬────────┘
       │                                 │
       │    ┌────────────────────────────┘
       │    │
       │    ▼
       │  ┌──────────────────┐
       │  │EventBus          │
       │  │- Queue and       │
       │  │  Watcher are now │
       │  │  synchronized    │
       │  │- Events logged   │
       └──┤- Stats tracked   │
          └──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ TmuxInjector                    │
│.createSession('core', 'bash')   │
│                                 │
│ tmux new-session -d -s core     │
│ 'bash'                          │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ TmuxInjector                    │
│.send('core', 'claude')          │
│.send('core', 'Enter')           │
│                                 │
│ tmux send-keys -t core 'claude' │
│ tmux send-keys -t core 'Enter'  │
│                                 │
│ [Wait 3 seconds for startup]    │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ PromptBuilder                   │
│.build('core', 'core')           │
│                                 │
│ 1. Load preamble                │
│ 2. Load agent prompt.md         │
│ 3. Load capabilities            │
│ 4. Load workflow.md             │
│ 5. Combine sections             │
│ 6. Save to .ai/tx/mesh/...      │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ TmuxInjector                    │
│.injectFile(                     │
│  'core',                        │
│  promptFile                     │
│)                               │
│                                 │
│ Simulates:                      │
│ @ → 500ms → filepath →          │
│ 500ms → Enter                   │
│                                 │
│ [Claude receives prompt]        │
└──────────────┬──────────────────┘
               │
        ┌──────┴─────────┐
        │                │
        NO --detach      YES --detach
        │                │
        ▼                ▼
   ┌────────┐      ┌──────────┐
   │tmux    │      │Print:    │
   │attach  │      │✅ Running│
   │-t core │      │in detach │
   └────────┘      └──────────┘
        │                │
        └────────┬───────┘
                 ▼
          ┌────────────┐
          │   Done     │
          └────────────┘
```

---

## `tx attach` Execution Flow

```
User: tx attach
  │
  ▼
┌─────────────────────────────────┐
│ lib/commands/attach.js          │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ TmuxInjector                    │
│.listSessions()                  │
│                                 │
│ tmux list-sessions -F           │
│ '#{session_name}'              │
└──────────────┬──────────────────┘
               │
        ┌──────┴─────────────┬──────────────┐
        │                    │              │
    0 sessions         1 session      Multiple
        │                    │              │
        ▼                    ▼              ▼
    ┌──────┐          ┌────────┐     ┌──────────┐
    │Error │          │Attach  │     │Display   │
    │msg   │          │to it   │     │menu &    │
    │Use   │          │directly│     │attach to │
    │tx    │          │        │     │first     │
    │start │          │tmux    │     │          │
    │      │          │attach  │     │tmux      │
    └──────┘          │-t {s}  │     │attach    │
                      └────────┘     │-t {s}    │
                           │         └──────────┘
                           │              │
                           └──────┬───────┘
                                  │
                                  ▼
                          ┌──────────────┐
                          │ User in tmux │
                          │ session      │
                          │              │
                          │ Ctrl-B + D   │
                          │ to detach    │
                          └──────────────┘
```

---

## Message Queue Flow

```
┌─────────────────┐
│   inbox         │
│  (incoming)     │
└────────┬────────┘
         │
         │ File added
         │ → EventBus: file:inbox:new
         │ → Queue.processInbox()
         │
    ┌────▼────┐
    │ If next │
    │ is empty│
    └────┬────┘
         │
         ▼
┌─────────────────┐
│    next         │
│  (queued)       │
└────────┬────────┘
         │
         │ File added
         │ → EventBus: file:next:new
         │ → Queue.processNext()
         │
    ┌────▼────┐
    │If active│
    │is empty │
    └────┬────┘
         │
         ▼
┌─────────────────┐
│    active       │
│ (processing)    │
└────────┬────────┘
         │
         │ File removed
         │ → EventBus: file:active:removed
         │ OR file:complete:new
         │ → Queue.processNext()
         │ → trigger next task
         │
         ▼
┌─────────────────┐
│   complete      │
│  (finished)     │
└────────┬────────┘
         │
    ┌────▼──────────┐
    │ After 30 days │
    └────┬──────────┘
         │
         ▼
┌─────────────────┐
│   archive       │
│  (historical)   │
└─────────────────┘
```

---

## Configuration Loading Hierarchy

```
Configuration Files

meshes/
├── mesh-configs/
│   └── {mesh}.json
│       │
│       ├─ agents list
│       ├─ workflow topology
│       └─ entry/completion agents
│
├── agents/
│   ├── {mesh}/
│   │   └── {agent}/
│   │       ├─ config.json
│   │       │  ├─ name
│   │       │  ├─ description
│   │       │  ├─ capabilities (list)
│   │       │  └─ options (model, output)
│   │       │
│   │       ├─ prompt.md (agent-specific instructions)
│   │       ├─ task.md (optional current task)
│   │       └─ prompts/ (generated prompts)
│   │
│   └── (other meshes)
│
└── prompts/
    ├── templates/system/
    │   ├─ preamble.md (generic intro)
    │   └─ workflow.md (workflow instructions)
    │
    └── capabilities/
        ├── {capability}/
        │   └─ {capability}.md (tool docs)
        │
        └── (other capabilities)

When building prompt for {mesh}/{agent}:

1. Load preamble from:
   prompts/templates/system/preamble.md

2. Load agent prompt from:
   meshes/agents/{mesh}/{agent}/prompt.md

3. Load task (if exists) from:
   meshes/agents/{mesh}/{agent}/task.md

4. For each capability in config.json:
   Load: prompts/capabilities/{cap}/{cap}.md

5. Load workflow from:
   prompts/templates/system/workflow.md

6. Combine all into single prompt

7. Save combined to:
   .ai/tx/mesh/{mesh}/agents/{agent}/prompts/{timestamp}-prompt.md

8. Inject into Claude via @
```

---

## Event Flow During Message Processing

```
File System Events (chokidar)
  │
  └─→ Watcher detects new file
       │
       └─→ _handleFileAdd(filepath)
            │
            ├─→ Parse mesh, queue, agent, filename
            │
            └─→ Emit EventBus event
                 │
                 ├─ file:inbox:new
                 ├─ file:next:new
                 ├─ file:active:new
                 ├─ file:complete:new
                 ├─ file:ask:new (special)
                 └─ file:ask-response:new (special)
                 │
                 ▼
          EventBus._callListeners()
               │
               ├─→ Find registered handlers
               │
               ├─→ Sort by priority
               │
               └─→ Call all handlers
                   │
                   ├─ Queue.processInbox()
                   ├─ Queue.processNext()
                   ├─ Queue.complete()
                   ├─ State updates
                   └─ Other listeners
                   │
                   ▼
                State Changes
                   │
                   └─→ Emit state:changed event
                       └─→ Logger.log()
```

---

## Tmux Injection Methods

```
Three injection strategies:

1. File Injection (for prompts)
   ─────────────────────────────
   Input: session, filepath
   
   Steps:
   a) tmux send-keys -t {session} '@'
   b) sleep 500ms
   c) tmux send-keys -t {session} '/absolute/path/to/file'
   d) sleep 500ms
   e) tmux send-keys -t {session} 'Enter'
   
   Result: Claude file browser opens with path


2. Command Injection (for Claude commands)
   ─────────────────────────────────────────
   Input: session, command
   
   Steps:
   a) tmux send-keys -t {session} '/'
   b) sleep 500ms
   c) tmux send-keys -t {session} 'command text'
   d) sleep 500ms
   e) tmux send-keys -t {session} 'Enter'
   
   Result: Claude command palette executes command


3. Text Injection (for large content)
   ────────────────────────────────────
   Input: session, text (up to many chars)
   
   Steps:
   a) Split text into 2000-char chunks
   b) For each chunk:
      - tmux send-keys -t {session} 'chunk'
      - sleep 100ms
      - If not last: tmux send-keys 'Enter'
      - sleep 100ms
   
   Result: Text pasted in 2000-char increments
```

---

## State Management - Atomic Updates

```
┌──────────────────────────────────┐
│ AtomicState.update(mesh, changes)│
└──────────────────┬───────────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Acquire file lock   │
        │ .ai/tx/mesh/{mesh}/ │
        │ .lock               │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Read current state  │
        │ from state.json     │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Merge changes into  │
        │ current state       │
        │ (shallow merge)     │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Write updated state │
        │ to state.json       │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Emit               │
        │ state:changed event │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Release file lock   │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Return new state    │
        └─────────────────────┘
```

---

## Data Structures

### Queue State (`state.json`)
```json
{
  "mesh": "core",
  "status": "active|initialized|complete|paused|error",
  "started": "ISO-8601-timestamp",
  "current_agent": "core",
  "workflow": ["agent1", "agent2", "agent3"],
  "workflow_position": 0,
  "workflow_complete": false,
  "tasks_completed": 5,
  "previous_agent": null,
  "active_sessions": ["core-core"],
  "current_session": "core-core"
}
```

### Message Frontmatter
```yaml
---
from: mesh/agent or "user"
to: mesh/agent or mesh
type: task|task-complete|ask|ask-response|update
status: pending|in-progress|completed|rejected|approved|start
msg-id: unique-id-string
timestamp: ISO-8601-timestamp
[custom-field]: value
---
# Message Title
Message body content...
```

### EventBus Listener
```javascript
{
  event: "file:inbox:new",
  handler: (data) => { /* ... */ },
  priority: 10,
  once: false
}
```


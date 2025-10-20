# Message Boxes - Lightweight Visualization

## Standard Queue Flow

```
┌─────────────┐     ┌──────────┐     ┌────────┐     ┌──────────┐     ┌─────────┐
│   INBOX     │ --> │   NEXT   │ --> │ ACTIVE │ --> │ COMPLETE │ --> │ ARCHIVE │
│  (waiting)  │     │ (queued) │     │(process)    │ (done)   │     │ (old)   │
└─────────────┘     └──────────┘     └────────┘     └──────────┘     └─────────┘
      ▲
      │
   new task
```

## Multi-Level Structure

```
.ai/tx/mesh/
└── {mesh-name}/
    ├── msgs/                    ← MESH LEVEL QUEUES
    │   ├── inbox/       (new tasks)
    │   ├── next/        (queued tasks)
    │   ├── active/      (being processed)
    │   ├── complete/    (done)
    │   └── archive/     (old)
    │
    └── agents/
        └── {agent-name}/
            └── msgs/            ← AGENT LEVEL QUEUES
                ├── inbox/       (new for this agent)
                ├── next/        (queued for this agent)
                ├── active/      (agent working on it)
                ├── complete/    (agent finished)
                └── archive/     (old)
```

## Message Lifecycle

```
USER SENDS TASK
      ↓
  MESH INBOX  ← .ai/tx/mesh/{mesh}/msgs/inbox/file.md
      ↓
Queue.processInbox()
      ↓
  MESH NEXT   ← moved
      ↓
Queue.processNext()
      ↓
  MESH ACTIVE ← processing now
      ↓
Agent processes & creates response
      ↓
      OUTBOX  ← .../outbox/response.md
      ↓
Queue.processOutbox() (NEW!)
      ↓
AGENT INBOX  ← routed to destination
      ↓
Queue.processAgentInbox()
      ↓
AGENT NEXT   ← queued for agent
      ↓
Agent reads & processes
      ↓
Queue.completeAgentTask()
      ↓
AGENT COMPLETE ← done
```

## With UID Suffix

```
SPAWN WITH TASK
  tx spawn core core -i "analyze codebase"
         ↓
    generateTaskUID("analyze codebase")
         ↓
       "ac01"  ← 4 char code
         ↓
    SESSION: core-ac01
         ↓
    FOLDERS: .../agents/core-ac01/msgs/
                                    ├── inbox/
                                    ├── next/
                                    ├── active/
                                    ├── complete/
                                    └── archive/
```

## 3-Agent Workflow

```
AGENT-1          AGENT-2          AGENT-3
 inbox            inbox            inbox
   ↓                ↓                ↓
 next              next             next
   ↓                ↓                ↓
 active           active           active
   ↓                ↓                ↓
complete  -->    outbox    -->    outbox
   │                ↓                ↓
   │            route to 2        route to 3
   │                ↓                ↓
   │            AGENT-2 inbox    AGENT-3 inbox
   └─────────→  (handoff)
```

## File Movement Examples

### Single File State

```
Start:  inbox/ = ["task1.md"]    next/ = []    active/ = []

Step 1: inbox/ = []              next/ = ["task1.md"]    active/ = []
Step 2: inbox/ = []              next/ = []    active/ = ["task1.md"]
Step 3: inbox/ = []              next/ = []    active/ = []
            ↓ (complete triggered)
        complete/ = ["task1.md"]
```

### Queued Messages

```
inbox/ = [
  "task1.md",
  "task2.md",
  "task3.md"
]

↓ (processInbox runs)

inbox/ = [
  "task2.md",
  "task3.md"
]

next/ = ["task1.md"]
```

## Key Operations

```
├─ processInbox(mesh)
│  └─ Moves: inbox → next (FIFO, if next empty)
│
├─ processNext(mesh)
│  └─ Moves: next → active (if active empty)
│
├─ complete(mesh, filename)
│  └─ Moves: active → complete
│
├─ processOutbox(mesh, file)    ← NEW
│  └─ Routes: outbox → agent_inbox
│
├─ processAgentInbox(mesh, agent)
│  └─ Moves: agent_inbox → agent_next
│
├─ processAgentNext(mesh, agent)
│  └─ Moves: agent_next → agent_active
│
└─ completeAgentTask(mesh, agent)
   └─ Moves: agent_active → agent_complete
```

## Event Triggers

```
File Created → Watcher Detects → Event Emitted → Handler Called

new file in outbox/
    ↓
Watcher: "file:outbox:new"
    ↓
EventBus.emit()
    ↓
Queue.processOutbox()  ← routes to inbox
    ↓
continues through queue...
```

## Quick Reference

| Location | Meaning | Next Step |
|----------|---------|-----------|
| `msgs/inbox/` | New tasks waiting | → processInbox() |
| `msgs/next/` | Queued, not started | → processNext() |
| `msgs/active/` | Processing now | agent reads it |
| `msgs/complete/` | Done! | → archive (after 30 days) |
| `msgs/archive/` | Old/historical | read-only |
| `agents/{name}/msgs/inbox/` | Task for agent | agent processes |
| `outbox/` | Response waiting | → route to inbox |

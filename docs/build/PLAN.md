# Agent Orchestration System Rebuild - Bottom-Up (Tests First)

## Build Strategy
**Bottom-up approach**: Build lib/ components → pass tests → then CLI commands

**Target**: Claude Code sessions in tmux, @ file injection, SearXNG at localhost:12321

---

## Phase 1: Foundation Libraries

### 1.1 Logger (`lib/logger.js`)
- JSONL format to `.ai/tx/logs/{debug.jsonl, error.jsonl}`
- `Logger.log/warn/error(component, message, metadata)`
- `Logger.tail(n, component)` for recent entries
- **Test**: test/test-messages.js lines 101-114

### 1.2 Message (`lib/message.js`)
- `Message.send(mesh, task, context)` - creates MD with frontmatter in inbox
- `Message.parseMessage(filepath)` - parses frontmatter + body
- Frontmatter: from, to, type, status, msg-id, timestamp
- File naming: `YYMMDDHHMM-[shortname].md`
- **Test**: test/test-messages.js lines 9-52

### 1.3 Event Bus (`lib/event-bus.js`)
- `EventBus.on(event, handler, options)` with wildcard/priority support
- `EventBus.emit(event, data)` async/sync
- `EventBus.once(event, handler)`
- Event logging (last 1000 events)
- Debug mode via TX_DEBUG_MODE env var
- **Test**: Unit test event emission/listening

---

## Phase 2: State & Queue

### 2.1 Atomic State (`lib/atomic-state.js`)
- Thread-safe JSON read/write with file locking
- `AtomicState.read(mesh)` / `AtomicState.update(mesh, changes)`
- Emits `state:changed` with prev/current snapshots
- State schema: mesh, status, current_agent, workflow, workflow_position, tasks_completed
- **Test**: Verify state updates in test/test-workflow-advancement.js

### 2.2 Queue (`lib/queue.js`)
- `Queue.init()` - registers EventBus listeners
- `Queue.processInbox(mesh)` - inbox → next (FIFO, one file)
- `Queue.processNext(mesh)` - next → active (when active empty)
- `Queue.complete(mesh, filename)` - active → complete + workflow advancement
- `Queue.archive(mesh, days)` - complete → archive (old messages)
- `Queue.getQueueStatus(mesh)` - counts per directory
- Emits: `task:queued`, `task:activated`
- Listens: `file:inbox:new`, `queue:process:next`, `file:complete:new`, `file:active:removed`
- **Test**: test/test-queue.js (all tests must pass)

---

## Phase 3: File Watcher

### 3.1 Watcher (`lib/watcher.js`)
- chokidar watching `.ai/tx/mesh/*/msgs/**/*.md`
- Emits: `file:inbox:new`, `file:next:new`, `file:active:new`, `file:complete:new`, `file:active:removed`, `watcher:started`, `watcher:stopped`
- NO direct Queue imports - only EventBus
- `Watcher.start()` / `Watcher.stop()`
- **Test**: test/test-watcher.js (must pass)

---

## Phase 4: Mock Agent & Integration Test

### 4.1 Mock Agent (`lib/mock-agent.js`)
- Simulates Claude agent for testing
- `MockAgent.start()` - initializes mesh
- `MockAgent.processQueue()` - manually steps through queue
- Auto-completes tasks (writes to outbox with task-complete)
- **Test**: test/test-messages.js lines 54-98

### 4.2 Workflow Advancement Test
- Multi-agent workflow: researcher → analyzer → reporter
- Verify handoff messages created on complete
- Verify state.workflow_position increments
- **Test**: test/test-workflow-advancement.js (must pass)

---

## Phase 5: Package Setup

### 5.1 package.json
```json
{
  "name": "tmux-riffic-v2",
  "version": "2.0.0",
  "bin": { "tx": "./bin/tx.js" },
  "dependencies": {
    "fs-extra": "^11.0.0",
    "chokidar": "^3.5.3",
    "commander": "^11.0.0",
    "axios": "^1.6.0"
  }
}
```

### 5.2 npm install
Run `npm install` to get dependencies

---

## Phase 6: TMUX Integration (After Tests Pass)

### 6.1 TMUX Injector (`lib/tmux-injector.js`)
- `TmuxInjector.injectFile(session, filepath)`:
  - `tmux send-keys -t session @`
  - sleep 0.5s
  - `tmux send-keys -t session filepath`
  - sleep 0.5s
  - `tmux send-keys -t session Enter`
- `TmuxInjector.injectCommand(session, cmd)`:
  - Same pattern with `/` prefix
- **Note**: For Claude Code @ attachment, files must be accessible from Claude's working directory

### 6.2 Prompt Builder (`lib/prompt-builder.js`)
- Assembles agent prompts from:
  1. Preamble (mesh context, save paths)
  2. Agent prompt (meshes/agents/{mesh}/{agent}/prompt.md)
  3. Task (meshes/agents/{mesh}/{agent}/task.md if exists)
  4. Capabilities (prompts/capabilities/)
  5. Workflow (prompts/templates/system/workflow.md)
- Saves to `.ai/tx/mesh/{mesh}/agents/{agent}/{timestamp}-prompt.md`
- Returns filepath for @ injection
- **Test**: Generate test prompt, verify sections

---

## Phase 7: CLI Commands (After All Tests Pass)

### 7.1 bin/tx.js
- Commander.js CLI router
- Commands: start, spawn, attach, kill, status, stop, prompt, tool

### 7.2 System Manager (`lib/system-manager.js`)
- `SystemManager.start()` - calls Queue.init(), Watcher.start()
- `SystemManager.stop()` - stops watcher, cleans up

### 7.3 Command Implementations (lib/commands/)
- start.js - spawn core mesh
- spawn.js - spawn mesh/agent with prompt injection
- attach.js - list sessions, attach
- kill.js - kill session
- status.js - show queue status
- stop.js - stop all
- prompt.js - display generated prompt
- tool.js - run capabilities

---

## Phase 8: Search Tool

### 8.1 lib/tools/search.js
- `search(query, categories = ['general'])`
- axios POST to http://localhost:12321/search
- Returns: {urls: [], content: []}
- **Config**: SearXNG URL: `http://localhost:12321`

### 8.2 prompts/capabilities/search/
- search.md - usage instructions for agents
- search.js - exports search function

---

## Phase 9: Configs & Templates

### 9.1 System Templates
- prompts/templates/system/preamble.md
- prompts/templates/system/workflow.md

### 9.2 Test Mesh
- meshes/mesh-configs/test-echo.json
- meshes/agents/test-echo/prompt.md
- meshes/agents/test-echo/config.json

### 9.3 Core Mesh
- meshes/mesh-configs/core.json
- meshes/agents/core/prompt.md
- meshes/agents/core/config.json

---

## Test Execution Order

1. **test-messages.js** - Message creation/parsing/logger
2. **test-queue.js** - Queue flow (inbox→next→active→complete)
3. **test-queue-sync.js** - Queue synchronization
4. **test-watcher.js** - File watching events
5. **test-spawner.js** - Agent spawning (may need CLI)
6. **test-workflow-advancement.js** - Multi-agent workflow

---

## Success Criteria (Phase by Phase)

**Phase 1-4**: All 6 test files pass
**Phase 5**: `npm install` succeeds
**Phase 6**: Prompt files generated correctly
**Phase 7**: `npm link` works, `tx status` runs
**Phase 8**: Search returns results from SearXNG
**Phase 9**: `tx spawn test-echo --init "test"` works end-to-end

**DEFER**: Hive mode (spawn -n 30) until after basic spawn works

---

## Configuration Summary

- **Claude Runtime**: Claude Code in tmux sessions
- **Prompt Injection**: @ file attachment method
- **SearXNG**: http://localhost:12321
- **Build Order**: Tests first (bottom-up)
- **Deferred**: Hive mode multi-spawn

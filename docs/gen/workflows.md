# TX Workflows - Verified Built Workflows

This document catalogs all verified workflows that exist in code, triggered by user actions, agent actions, or system actions.

## A. USER ACTION WORKFLOWS

*Messages route through core agent; no direct user-to-mesh messaging*

### 1. System Start Workflow
**Trigger:** `tx start` command
**Entry:** `lib/commands/start.js:6`
1. SystemManager.start() initializes queue listeners
2. Watcher.start() begins file monitoring
3. Check if core agent exists
4. If missing, spawn('core', 'core') creates it
5. Attach to core tmux session (unless --detach)
6. System ready for message processing

### 2. Spawn Agent Workflow
**Trigger:** `tx spawn <mesh> [agent]` command
**Entry:** `lib/commands/spawn.js:9`
1. Validate session doesn't already exist
2. DirectoryInitializer.initializeAll() creates queue directories
3. Load agent config (workspace → fallback to source)
4. TmuxInjector.createSession() spawns tmux session
5. Start Claude inside session
6. Inject agent model and output options if configured
7. PromptBuilder.build() generates complete agent prompt
8. Save prompt to agent prompts directory
9. TmuxInjector.injectCommand() loads prompt via /tx-agent
10. Send initial task if provided via Message.send()
11. AtomicState.update() marks agent as active

### 3. Attach to Session Workflow
**Trigger:** `tx attach` command
**Entry:** `lib/commands/attach.js:5`
1. List all active tmux sessions
2. If no sessions: show error
3. If one session: attach directly
4. If multiple sessions:
   - Display numbered list
   - Prompt user for selection
   - Validate input (1-N)
   - Attach to selected session
5. Execute `tmux attach -t {session}`

### 4. Kill Session Workflow
**Trigger:** `tx kill <mesh> [agent]` command
**Entry:** `lib/commands/kill.js:4`
1. Construct session name from mesh/agent
2. TmuxInjector.killSession() kills tmux session
3. Log session termination
4. Report success or not-found

### 5. Stop System Workflow
**Trigger:** `tx stop` command
**Entry:** `lib/commands/stop.js:5`
1. List all active tmux sessions
2. Kill each session
3. SystemManager.stop() shuts down watcher
4. System stopped

### 6. Query Status Workflow
**Trigger:** `tx status` command
**Entry:** `lib/commands/status.js:8`
1. List active tmux sessions
2. Read all mesh directories from `.ai/tx/mesh/`
3. For each mesh:
   - Read state.json
   - Count messages in each queue (inbox, next, active, complete)
   - Display workflow position if multi-agent
4. Display totals
5. Optionally generate prompt-ready status summary

---

## B. AGENT ACTION WORKFLOWS

### 1. Task Processing Workflow
**Trigger:** File added to mesh inbox
**Chain:** Watcher.add() → EventBus emit → Queue.processInbox()
**Entry:** `lib/queue.js:57`

**Inbox Phase:**
1. Watcher detects file in `.ai/tx/mesh/{mesh}/msgs/inbox/`
2. EventBus emits `file:inbox:new` event
3. Queue.processInbox(mesh) executes
4. Check if next queue is empty
5. Move first inbox file → next queue (FIFO)
6. Emit `task:queued` event
7. Recursively process remaining inbox files

**Next Phase:**
1. EventBus emits `queue:process:next` event
2. Queue.processNext(mesh) executes
3. Check if active queue is empty
4. Move first next file → active queue
5. Emit `task:activated` event
6. Update mesh state: status='processing'
7. Try to process inbox again

### 2. Multi-Agent Workflow Advancement
**Trigger:** Agent completes task
**Entry:** `lib/queue.js:181`

1. Agent signals task completion
2. Queue.complete(mesh, filename) executes
3. Move message: active → complete
4. Increment tasks_completed counter
5. Check if mesh has workflow defined
6. If yes, call Queue._advanceWorkflow()
7. In _advanceWorkflow():
   - Check if at last agent in workflow
   - If yes: set workflow_complete=true, status='complete'
   - If no: get next agent from workflow array
   - Parse completed message content
   - Create HANDOFF message with context
   - Write handoff to inbox
   - Update state: workflow_position++, current_agent=nextAgent
   - Emit `file:inbox:new` to trigger next agent processing
8. Emit `queue:process:next` to continue

### 3. Ask Message Routing
**Trigger:** Agent sends ask message
**Entry:** `lib/queue.js:483`

1. Queue.handleAskMessage(mesh, fromAgent, toAgent, msgId, question)
2. Create ask message with unique msg-id for tracking
3. Write to target agent inbox: `.ai/tx/mesh/{mesh}/agents/{toAgent}/msgs/inbox/`
4. Emit `file:ask:new` event (fast-track, bypasses next queue)
5. Emit EventBus `file:ask:new` for immediate processing

### 4. Ask Response Routing
**Trigger:** Agent responds to ask
**Entry:** `lib/queue.js:540`

1. Queue.handleAskResponse(mesh, toAgent, msgId, response)
2. Create ask-response message with matching msg-id
3. Write to requesting agent inbox
4. Emit `file:ask-response:new` event
5. Requesting agent receives response directly

### 5. Agent Task Completion
**Trigger:** Agent finishes active task
**Entry:** `lib/queue.js:589`

1. Queue.completeAgentTask(mesh, agent, filename)
2. Get first active file if filename not provided
3. Move: agent/active → agent/complete
4. SIMULTANEOUSLY move: mesh/active → mesh/complete
5. Log completion
6. If multi-agent workflow: trigger advancement
7. Emit `queue:process:next` to process next queued task

---

## C. SYSTEM ACTION WORKFLOWS

### 1. System Initialization Workflow
**Trigger:** SystemManager.start()
**Entry:** `lib/system-manager.js:13`

1. Check if already running
2. Queue.init() registers all event listeners:
   - file:inbox:new → Queue.processInbox()
   - queue:process:next → Queue.processNext()
   - file:complete:new → Queue.processNext()
   - file:active:removed → Queue.processNext()
   - file:ask:new → log ask message
   - file:ask-response:new → log ask response
3. Watcher.start() begins monitoring `.ai/tx/mesh/**/msgs/**/*.md`
4. Watcher.ready() waits for initial scan
5. SystemManager.running = true
6. System ready

### 2. File Watcher Initialization
**Trigger:** Watcher.start()
**Entry:** `lib/watcher.js:14`

1. Create chokidar watcher on pattern `.ai/tx/mesh/**/msgs/**/*.md`
2. Configure with stabilityThreshold: 100ms
3. Register handlers:
   - add → _handleFileAdd()
   - change → _handleFileChange()
   - unlink → _handleFileRemove()
   - error → log error
4. Emit `watcher:started` event
5. Return promise that resolves on 'ready' event

### 3. File Detection Workflow
**Trigger:** File system change
**Entry:** `lib/watcher.js:80-165`

**On File Add:**
1. Parse queue name from path (inbox, next, active, etc.)
2. Parse mesh name from path
3. Check if ask message (filename contains `-ask-`)
   - If yes: parse agent name, emit `file:ask:new`
4. Check if ask response (filename contains `-ask-response-`)
   - If yes: parse agent name, emit `file:ask-response:new`
5. Otherwise: emit `file:{queue}:new` event

**On File Change:**
1. Parse queue and mesh from path
2. Emit `file:{queue}:changed` event

**On File Remove:**
1. Parse queue and mesh from path
2. Emit `file:{queue}:removed` event
3. If active removed: trigger Queue.processNext()

### 4. State Update Workflow
**Trigger:** AtomicState.update()
**Entry:** `lib/atomic-state.js` (assumed)

1. Acquire file lock (`.ai/tx/mesh/{mesh}/.lock`)
2. Read current state from state.json
3. Merge provided changes
4. Write updated state
5. Emit `state:changed` event with {mesh, changes, previous, current}
6. Release file lock
7. Timeout: 5000ms

### 5. Message Archival Workflow
**Trigger:** Queue.archive() (periodic or manual)
**Entry:** `lib/queue.js:322`

1. Set archival cutoff (default: 30 days old)
2. Scan complete directory for old messages
3. Move messages older than cutoff → archive directory
4. Log archived count
5. Return archived count

### 6. System Shutdown Workflow
**Trigger:** SystemManager.stop()
**Entry:** `lib/system-manager.js:49`

1. Check if system running
2. Watcher.stop() closes file watcher
3. Emit `watcher:stopped` event
4. SystemManager.running = false
5. System stopped

---

## D. EVENT FLOW SUMMARY

### Core Event Chain (Single Task Processing)

```
User sends message (Message.send)
    ↓ (watcher detects)
file:inbox:new
    ↓
Queue.processInbox()
    ↓
task:queued + move inbox → next
    ↓
queue:process:next
    ↓
Queue.processNext()
    ↓
task:activated + move next → active
    ↓
state:changed (status='processing')
    ↓
Agent processes task
    ↓
Queue.complete()
    ↓
move active → complete
    ↓
state:changed (tasks_completed++)
    ↓
[IF multi-agent: Queue._advanceWorkflow()]
    ↓
queue:process:next (for next task)
```

### Multi-Agent Handoff Chain

```
Agent 1 completes task
    ↓
Queue.complete(mesh, filename)
    ↓
Queue._advanceWorkflow(mesh, state, file)
    ↓
Create HANDOFF message
    ↓
Write to inbox
    ↓
file:inbox:new
    ↓
Queue.processInbox() (Agent 2's flow)
    ↓
task:queued + move inbox → next
    ↓
Agent 2 processes...
```

---

## E. QUEUE STRUCTURE

Each mesh and agent has this queue hierarchy:
- **Inbox:** Messages awaiting processing (FIFO)
- **Next:** Next message in queue (FIFO, max 1)
- **Active:** Currently processing (FIFO, max 1)
- **Complete:** Finished messages
- **Archive:** Old messages (30+ days)

File paths:
- Mesh: `.ai/tx/mesh/{mesh}/msgs/{queue}/`
- Agent: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/{queue}/`

---

## F. MESSAGE FORMAT

All messages are YAML frontmatter + Markdown:

```markdown
---
from: user | mesh/agent
to: mesh | mesh/agent
type: task | task-complete | ask | ask-response | update | handoff
status: pending | in-progress | completed | rejected | approved | start
msg-id: unique-message-id
timestamp: ISO8601-timestamp
---

# Task Title

Task content...
```

---

## G. SPECIAL BEHAVIORS

1. **Ask Messages:** Fast-track routing, bypass next queue, go directly to agent inbox
2. **Handoff Messages:** Type=handoff, includes previous agent's work context
3. **State Locking:** File-based lock prevents concurrent state modifications (5s timeout)
4. **Prompt Injection:** Large prompts chunked into 2000-char segments for tmux
5. **Workflow Tracking:** State tracks workflow array, current position, previous agent

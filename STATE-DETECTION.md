# State Detection in TX

## Current State Detection Mechanisms

### 1. **Manual State Transitions** (Explicit)
These are called directly in code:

- **SPAWNED → INITIALIZING**: `lib/commands/spawn.js:388`
  - Triggered when: Agent spawn starts
  - Method: `StateManager.transitionState(agentId, STATES.INITIALIZING)`

- **INITIALIZING → READY**: `lib/commands/spawn.js:450`
  - Triggered when: Initial prompt injected
  - Method: `StateManager.transitionState(agentId, STATES.READY)`

- **Agent killed**: `lib/commands/stop.js:55,114`
  - Triggered when: `tx stop` is called
  - Method: `StateManager.transitionState(agentId, STATES.KILLED)`

### 2. **Event-Based State Updates** (Message-driven)
These are triggered by messages in `.ai/tx/msgs/`:

- **Task assignment**: `lib/event-log-consumer.js:217-222`
  - Triggered when: Message type = 'task' with status = 'start'
  - Updates: `StateManager.updateTask(agentId, taskHeadline)`
  - **NOTE**: Only updates `current_task` field, NOT state transition to WORKING

- **Task completion**: `lib/event-log-consumer.js:226-228`
  - Triggered when: Message type = 'task-complete'
  - Updates: `StateManager.updateTask(agentId, null)`
  - **NOTE**: Clears task but does NOT transition state back to READY

### 3. **Activity Monitoring** (Automatic)
Background monitoring for distraction detection:

- **WORKING → DISTRACTED**: `lib/state-manager.js:342-361`
  - Triggered when: Agent in WORKING state with no activity for >10 seconds
  - Method: `StateManager.checkAgentActivity()` called every 2 seconds
  - **NOTE**: Monitor must be explicitly started with `StateManager.startMonitoring(agentId)`
  - **ISSUE**: Monitoring is NEVER started in current codebase!

### 4. **Activity Updates** (Manual)
Manual activity timestamp updates:

- **updateActivity()**: `lib/state-manager.js:150-159`
  - Method exists but is NEVER called anywhere in codebase
  - Should be called when agent shows activity (tool use, message send, etc.)

---

## Problems Identified

### ❌ **Problem 1: No READY → WORKING Transition**
- Task is assigned via message
- `updateTask()` sets `current_task` field
- **State remains READY** (should transition to WORKING)

### ❌ **Problem 2: No WORKING → READY Transition**
- Task completion message received
- `updateTask(agentId, null)` clears task
- **State remains whatever it was** (should transition to READY)

### ❌ **Problem 3: Activity Monitoring Never Enabled**
- `StateManager.startMonitoring()` exists
- Monitoring is NEVER started for any agent
- DISTRACTED state can never be detected

### ❌ **Problem 4: No Activity Updates**
- `StateManager.updateActivity()` exists
- Method is NEVER called
- `last_activity` timestamp never updates after spawn
- Distraction detection would fail even if monitoring was enabled

### ❌ **Problem 5: No Detection of Agent Output**
- No monitoring of tmux pane activity
- Can't detect when agent is actively working vs idle
- Can't detect when agent completes work without explicit message

---

## What We SHOULD Be Detecting

### State Transitions Needed:

1. **READY → WORKING**
   - When: Task message received
   - Fix: Add `StateManager.transitionState(agentId, STATES.WORKING)` in event-log-consumer.js:221

2. **WORKING → READY**
   - When: Task-complete message received
   - Fix: Add `StateManager.transitionState(agentId, STATES.READY)` in event-log-consumer.js:227

3. **WORKING → BLOCKED**
   - When: Agent asks for human input (ask-human message sent)
   - Fix: Detect outbound ask-human messages and transition state

4. **BLOCKED → WORKING**
   - When: Human responds to blocked agent
   - Fix: Detect response message delivery and transition state

5. **WORKING → COMPLETING**
   - When: Agent starts writing final outputs/deliverables
   - Fix: Detect specific output patterns or explicit completion markers

6. **COMPLETING → READY**
   - When: Final outputs written, task-complete sent
   - Fix: Combine with task-complete handler

7. **WORKING → DISTRACTED**
   - When: No activity for >10s while working
   - Fix: Start monitoring when transitioning to WORKING state

8. **DISTRACTED → WORKING**
   - When: Activity resumes
   - Fix: Update activity on any agent output, check if was distracted

### Activity Detection Needed:

1. **Tmux Pane Activity**
   - Monitor pane-changed events
   - Detect when pane content changes (output generated)
   - Update `last_activity` timestamp

2. **Message Sending**
   - When agent writes to `.ai/tx/msgs/`
   - Update `last_activity` timestamp

3. **Tool Usage**
   - Detect Claude tool calls in pane (Read, Write, Bash, etc.)
   - Update `last_activity` timestamp

---

## Proposed Solutions

### Solution 1: Fix Event-Based Transitions
**File**: `lib/event-log-consumer.js`

```javascript
// Task assignment (line 217-222)
if (msg.type === 'task' && msg.metadata.status === 'start') {
  const taskHeadline = msg.metadata.headline || msg.content.substring(0, 100);
  StateManager.updateTask(this.agentId, taskHeadline);
  StateManager.transitionState(this.agentId, StateManager.STATES.WORKING); // ADD THIS
  StateManager.startMonitoring(this.agentId); // ADD THIS
  Logger.log('event-log-consumer', `Task assigned to ${this.agentId}: ${taskHeadline}`);
}

// Task completion (line 226-228)
if (msg.type === 'task-complete') {
  StateManager.updateTask(this.agentId, null);
  StateManager.transitionState(this.agentId, StateManager.STATES.READY); // ADD THIS
  StateManager.stopMonitoring(this.agentId); // ADD THIS
  Logger.log('event-log-consumer', `Task completed for ${this.agentId}`);
}
```

### Solution 2: Add Tmux Activity Monitor
**New File**: `lib/tmux-activity-monitor.js`

- Watch for pane content changes
- Call `StateManager.updateActivity(agentId)` on changes
- Integrate with existing monitoring system

### Solution 3: Add Message Watcher
**File**: `lib/watcher.js` or new file

- Watch `.ai/tx/msgs/` for new files FROM agents
- Extract sender from filename/frontmatter
- Call `StateManager.updateActivity(senderId)`

### Solution 4: Detect BLOCKED State
**File**: `lib/event-log-consumer.js`

```javascript
// After sending ask-human notification
if (msg.type === 'ask-human' && this.isTargetingCore()) {
  await this.sendAskHumanNotification(msg);
  // Transition sender to BLOCKED
  StateManager.transitionState(msg.from, StateManager.STATES.BLOCKED); // ADD THIS
}
```

---

## Implementation Priority

1. **HIGH**: Fix task assignment/completion transitions (Solution 1)
   - Most impactful, easiest to implement
   - Fixes brain showing as "ready" when working

2. **MEDIUM**: Add message-based activity detection (Solution 3)
   - Enables distraction detection
   - Relatively simple to implement

3. **LOW**: Add tmux activity monitoring (Solution 2)
   - More complex, requires tmux integration
   - Nice-to-have but not critical

4. **MEDIUM**: Add BLOCKED state detection (Solution 4)
   - Important for multi-agent workflows
   - Requires outbound message detection

---

## ✅ IMPLEMENTED (2025-11-10)

### 1. Task Assignment/Completion Transitions
**File**: `lib/event-log-consumer.js:217-239`

- **READY → WORKING**: When task message received
  - Calls `StateManager.transitionState(agentId, STATES.WORKING)`
  - Calls `StateManager.startMonitoring(agentId)` to enable distraction detection

- **WORKING/COMPLETING → READY**: When task-complete message received
  - Calls `StateManager.transitionState(agentId, STATES.READY)`
  - Calls `StateManager.stopMonitoring(agentId)` to disable monitoring

### 2. Message-Based Activity Detection
**File**: `lib/message-writer.js:95-103`

- Every message written updates sender's `last_activity` timestamp
- Calls `StateManager.updateActivity(from)` after writing message
- Enables distraction detection to work properly

### 3. BLOCKED State Detection
**Files**:
- `lib/message-writer.js:105-124` (outbound detection)
- `lib/event-log-consumer.js:175-182` (response detection)

- **WORKING → BLOCKED**: When agent sends ask-human message
  - Detected in MessageWriter when `type === 'ask-human'`
  - Calls `StateManager.transitionState(from, STATES.BLOCKED)`

- **BLOCKED → WORKING**: When blocked agent receives response
  - Detected in EventLogConsumer when receiving ask-response or task with reply-to
  - Checks if current state is BLOCKED
  - Calls `StateManager.transitionState(agentId, STATES.WORKING)`

### 4. COMPLETING State Detection
**File**: `lib/message-writer.js:113-117`

- **WORKING → COMPLETING**: When agent sends task-complete message
  - Detected in MessageWriter when `type === 'task-complete'`
  - Calls `StateManager.transitionState(from, STATES.COMPLETING)`
  - Note: EventLogConsumer then transitions COMPLETING → READY when receiver processes the message

---

## State Transition Flow (After Implementation)

```
SPAWNED → INITIALIZING → READY
                          ↓
                      (task received)
                          ↓
                       WORKING ←──────┐
                      ↓   ↓   ↓       │
                      │   │   └→ DISTRACTED (no activity >10s)
                      │   │           │
                      │   │      (activity resumes)
                      │   │           │
                      │   └───────────┘
                      │
        (ask-human)   │   (task-complete)
                      ↓        ↓
                   BLOCKED  COMPLETING
                      │        │
              (response)│      │
                      ↓        ↓
                       READY ←─┘
```

---

## Testing Recommendations

1. **Test READY → WORKING transition**:
   ```bash
   # Send task to brain
   tx msg brain --task "Test task"
   # Check state
   tx state brain
   # Should show: ⚡ working
   ```

2. **Test WORKING → READY transition**:
   ```bash
   # Agent sends task-complete
   # Check state
   tx state brain
   # Should show: ✅ ready
   ```

3. **Test WORKING → DISTRACTED transition**:
   ```bash
   # Send task to agent
   tx msg brain --task "Hard task"
   # Wait 15 seconds without agent activity
   tx state brain
   # Should show: 🐿️ distracted
   ```

4. **Test activity updates**:
   ```bash
   # Agent sends any message
   # Check last_activity timestamp
   tx state brain --json
   # Should show recent timestamp
   ```

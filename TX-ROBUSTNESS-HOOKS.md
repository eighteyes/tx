# TX Robustness: State Management & Recovery

## Overview

This document describes the state management and robustness improvements for the TX agent orchestration system, designed to bring order to the chaos of distributed agent communication.

## Problems Addressed

### 1. Message Delivery Issues
- **Problem**: Messages get dropped when tmux sessions don't exist
- **Solution**: Retry queue with exponential backoff + state tracking to know when agents are ready

### 2. Stuck/Distracted Agents
- **Problem**: Agents get stuck processing tasks with no visibility into their state
- **Solution**: Activity monitoring with automatic distraction detection (>10s inactive with task)

### 3. No Recovery Mechanisms
- **Problem**: When agents fail, they stay failed with no automatic recovery
- **Solution**: State-based recovery with automatic nudges and escalation

### 4. No Health Monitoring
- **Problem**: Can't tell if agents are alive, working, or crashed
- **Solution**: Real-time state tracking with tmux pane activity monitoring

## State Machine

### Core States

```
spawned → initializing → ready → working → completing → killed
                          ↓         ↓
                        blocked  distracted 🐿️
                          ↓         ↓
                       [resume]  [needs help!]

From any state: → error, suspended
```

### State Definitions

- **spawned**: Just created, tmux pane exists
- **initializing**: Injecting prompts, setting up environment
- **ready**: Idle, available for tasks
- **working**: Actively processing task (active in last 10s)
- **blocked**: Waiting on input (user input, ask response, another agent)
- **distracted** 🐿️: Has task but inactive >10s (lost the thread, needs help!)
- **completing**: Writing final outputs, cleanup phase
- **error**: Crashed or encountered fatal error, needs intervention
- **suspended**: Manually paused by user
- **killed**: Terminated, logged

## Implementation Components

### 1. StateManager (`lib/state-manager.js`)

Central state management system that:
- Tracks agent lifecycle states
- Monitors tmux pane activity every 2 seconds
- Detects distracted agents (>10s inactive with task)
- Handles automatic recovery attempts
- Persists state to `.ai/tx/state/agents/{agent}.json`

#### Key Methods

```javascript
// Initialize agent state
StateManager.initializeAgent(agentId, sessionName)

// Transition states
StateManager.transitionState(agentId, newState, metadata)

// Update task assignment
StateManager.updateTask(agentId, taskId, taskInfo)

// Clear task on completion
StateManager.clearTask(agentId)

// Get agent/mesh states
StateManager.getState(agentId)
StateManager.getMeshState(mesh)
StateManager.getAllStates()
```

### 2. Activity Monitoring

The StateManager monitors agent activity through:

1. **Tmux Pane Activity**: Checks `#{pane_activity}` timestamp
2. **Input Detection**: Scans last 5 lines for input prompts (`>`, `$`, `#`, `:`)
3. **State Inference**: Automatically transitions states based on activity patterns

```javascript
// Activity check every 2 seconds
StateManager.checkAgentActivity(agentId) {
  // Get pane activity
  const activity = getPaneActivity(sessionName)

  // Detect distraction
  if (hasTask && !active && inactive > 10s) {
    transitionState('distracted')
  }
}
```

### 3. Distraction Recovery

Progressive intervention for distracted agents:

1. **First distraction** (count < 3): Gentle nudge
   - Injects reminder message about current task

2. **Repeated distraction** (count 3-5): Status request
   - Requests explicit status update
   - Asks about blockers

3. **Chronic distraction** (count > 5): Error escalation
   - Transitions to error state
   - Requires manual intervention

### 4. Integration Points

#### Spawn Flow (`lib/commands/spawn.js`)
```javascript
// After session creation
await StateManager.initializeAgent(agentId, sessionName)
await StateManager.transitionState(agentId, 'initializing')

// After Claude ready
await StateManager.transitionState(agentId, 'ready')
```

#### Message Delivery (`lib/event-log-consumer.js`)
```javascript
// Task assignment
if (msg.type === 'task' && msg.status === 'start') {
  await StateManager.updateTask(agentId, msgId, taskInfo)
}

// Task completion
if (msg.type === 'task-complete') {
  await StateManager.clearTask(agentId)
}

// Activity tracking
await StateManager.updateActivity(agentId)
```

## CLI Commands

### `tx state [mesh] [agent]`

Display agent state information:

```bash
# Show all agent states
tx state

# Show mesh state summary
tx state research

# Show specific agent details
tx state research interviewer

# Watch mode (auto-refresh)
tx state --watch

# Show only distracted agents
tx state --distracted
```

### Output Example

```
┌─────────────────────┬───────────────┬────────────┬──────────────────┬───────────────┬──────────────┐
│ Agent               │ State         │ Duration   │ Task             │ Last Activity │ Distractions │
├─────────────────────┼───────────────┼────────────┼──────────────────┼───────────────┼──────────────┤
│ 📦 research         │               │            │                  │               │              │
├─────────────────────┼───────────────┼────────────┼──────────────────┼───────────────┼──────────────┤
│   interviewer       │ ⚡ working    │ 5m 32s     │ msg-abc123...    │ 3s ago        │ 0            │
│   analyzer          │ ✅ ready      │ 10m 15s    │ -                │ 10m ago       │ 0            │
│   writer            │ 🐿️ distracted │ 2m 45s     │ msg-def456...    │ 15s ago       │ 2            │
└─────────────────────┴───────────────┴────────────┴──────────────────┴───────────────┴──────────────┘

State Legend:
  ✅ ready        Available for tasks
  ⚡ working      Processing task
  ⏸️ blocked      Waiting for input
  🐿️ distracted   Stuck/needs help
  ❌ error        Crashed/failed
```

## State Persistence

State files are stored at `.ai/tx/state/agents/{agent}.json`:

```json
{
  "state": "working",
  "since": "2025-11-07T10:30:00Z",
  "lastActivity": "2025-11-07T10:30:45Z",
  "sessionName": "research-807055-interviewer",
  "currentTask": "msg-id-123",
  "metadata": {
    "taskStarted": "2025-11-07T10:30:00Z",
    "inactiveCount": 0,
    "distractionCount": 0,
    "lastTransition": "ready->working"
  },
  "transitions": [
    {"from": null, "to": "spawned", "at": "2025-11-07T10:29:50Z"},
    {"from": "spawned", "to": "initializing", "at": "2025-11-07T10:29:52Z"},
    {"from": "initializing", "to": "ready", "at": "2025-11-07T10:29:58Z"},
    {"from": "ready", "to": "working", "at": "2025-11-07T10:30:00Z"}
  ]
}
```

## Events

The StateManager emits events for external handling:

- `agent:state:changed` - State transition occurred
- `agent:distracted` - Agent became distracted
- `agent:error` - Agent entered error state
- `agent:recovered` - Agent recovered from distraction

## Configuration

Future configuration options (in `.tx/config.json`):

```json
{
  "state": {
    "distraction_threshold": 10000,  // ms before marking distracted
    "activity_check_interval": 2000, // ms between activity checks
    "max_distraction_count": 5,      // before escalating to error
    "auto_recovery": true,            // enable automatic nudges
    "persist_interval": 5000          // ms between state persists
  }
}
```

## Benefits

1. **Visibility**: Real-time view of what agents are doing
2. **Reliability**: Automatic detection and recovery of stuck agents
3. **Debugging**: Complete state history for troubleshooting
4. **Proactive**: Problems detected before they cascade
5. **Scalability**: Works with any number of agents/meshes

## Future Enhancements

1. **Webhooks**: Notify external systems on state changes
2. **Metrics**: Prometheus-compatible metrics export
3. **ML-based prediction**: Predict when agents will get stuck
4. **Custom recovery scripts**: User-defined recovery actions
5. **State replay**: Replay state transitions for debugging
6. **Distributed state**: Share state across multiple TX instances

## Migration Guide

For existing TX users:

1. **No breaking changes**: State management is additive
2. **Automatic initialization**: States created on first spawn
3. **Optional features**: All monitoring can be disabled
4. **Backward compatible**: Works with existing message flow

## Troubleshooting

### Agent stuck in distracted state
```bash
# Check agent state details
tx state research interviewer

# Reset the agent
tx reset research interviewer
```

### State file corruption
```bash
# Remove state file (will be recreated)
rm .ai/tx/state/agents/research-interviewer.json

# Restart monitoring
tx spawn research interviewer
```

### Activity not detected
- Check tmux session exists: `tmux ls`
- Verify pane activity: `tmux display-message -p -t session "#{pane_activity}"`
- Check state manager logs: `tx logs -c state-manager`

## Testing

Test the state management system:

```bash
# 1. Spawn a test agent
tx spawn research interviewer

# 2. Watch state in another terminal
tx state --watch

# 3. Send a task
echo "Research AI trends" | tx msg --to research/interviewer --type task

# 4. Watch state transition to 'working'

# 5. Wait 10+ seconds without activity

# 6. See state transition to 'distracted' 🐿️

# 7. Observe automatic nudge message
```

## Summary

The state management system transforms TX from a "fire and forget" message system to a robust, self-healing orchestration platform. By tracking agent states and detecting problems early, it ensures reliable task completion even when agents get stuck or distracted.

Key innovation: The "distracted" state (🐿️) - a fun but practical way to identify agents that have lost focus, enabling automatic recovery before tasks fail completely.

---

## Original Robustness Hooks

Below are the original robustness enhancement hooks for reference:

### 1. AUTO-SPAWN MISSING AGENTS

**File**: `lib/queue.js` lines 248-264

**Enhancement**: Auto-spawn agents when messages arrive for non-existent sessions

```javascript
if (!TmuxInjector.sessionExists(sessionName)) {
  // Auto-spawn missing agent
  if (ConfigLoader.isFeatureEnabled('beta.auto_spawn_on_message')) {
    // Extract mesh and agent from session name
    // Spawn the missing agent
    // Retry message delivery
  }
}
```

### 2. AGENT ACTIVITY MONITORING

**File**: `lib/tmux-injector.js`

**Enhancement**: Track agent activity and detect stuck agents

```javascript
static getAgentActivity(sessionName) {
  // Get pane activity timestamp
  // Check for input prompts
  // Detect idle time
  // Return activity state
}
```

### 3. MESSAGE DELIVERY CONFIRMATION

**File**: `lib/event-log-consumer.js`

**Enhancement**: Track message acknowledgment from agents

```javascript
// After message injection
if (requiresAck) {
  // Start acknowledgment timer
  // If no ack in timeout, retry or escalate
}
```

### 4. AUTOMATIC RECOVERY

**File**: `lib/state-manager.js`

**Enhancement**: Recover stuck agents automatically

```javascript
// When agent becomes distracted
if (distractionCount < maxRetries) {
  // Send nudge message
  // Request status update
  // Attempt task restart
} else {
  // Escalate to error state
  // Notify user
}
```
# TX Restart Required

## Issue
The current `tx start` process (PID 19337) was started before the state detection code was added. This means:

- ❌ No EventLogConsumers are running
- ❌ Messages in `.ai/tx/msgs/` are not being delivered
- ❌ Task-complete messages from brain are not being processed
- ❌ State transitions won't work for new tasks

## Evidence

```bash
$ node -e "const { EventLogManager } = require('./lib/event-log-manager'); console.log(EventLogManager.getStatus())"
{
  "enabled": false,
  "activeConsumers": 0,
  "consumers": []
}
```

Brain sent task-complete at `2025-11-10T07:34:25` but core's last processed timestamp is `2025-11-10T05:39:38` - the message was never delivered.

## Solution

**Restart TX to pick up the new code:**

```bash
tx stop
tx start
```

This will:
1. ✅ Kill all sessions cleanly
2. ✅ Clean up state files
3. ✅ Start fresh with new code
4. ✅ Spawn core with EventLogConsumer enabled
5. ✅ Enable state detection for all agents

## After Restart

The system will properly:
- Start EventLogConsumer for each spawned agent
- Process messages from `.ai/tx/msgs/`
- Transition states automatically (READY→WORKING→READY)
- Detect BLOCKED/DISTRACTED states
- Update activity timestamps

## Current State (Before Restart)

- Core: ready (should be processing messages)
- Brain: distracted (correctly detected! state system works)
  - Has task: "Plan robustness improvements for tx system"
  - Sent task-complete but core never received it

After restart, if you want to test the state system:
1. Send a new task to brain: `tx msg brain --task "Test state transitions"`
2. Watch it transition: `tx state` (should show brain as ⚡ working)
3. Wait for brain to send task-complete
4. Watch it transition back to: ✅ ready

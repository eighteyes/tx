# E2E Test: Full TX Workflow

## Overview

The E2E (end-to-end) test validates the complete TX system workflow:

1. **Start** - `tx start -d` (detached mode)
2. **Wait** - System readiness (core session + Claude initialized)
3. **Spawn** - Inject command to spawn test-echo agent with a task
4. **Process** - Agent processes the task
5. **Verify** - Check for task completion output

## Purpose

This test ensures the entire system works together, from startup through agent spawning and message processing.

## How to Run

```bash
# Run the e2e test
npm run test-e2e

# Or directly
node test/test-e2e.js
```

## What It Does

### Step 1: Start TX System
- Spawns `tx start -d` in detached mode
- Initializes Queue and Watcher systems
- Validates system configuration

### Step 2: Wait for Readiness
- Waits for `core` tmux session to be created
- Waits for Claude to initialize in the core session
- Polls for readiness indicators (bypass permissions message)

### Step 3: Inject Spawn Command
- Sends `/spawn test-echo echo --init "simple e2e test"` command
- Command is injected into core session via TmuxInjector
- Triggers creation of echo agent session

### Step 4: Task Processing
- Waits 10 seconds for agent to process task
- Agent (echo) receives task and processes it
- Output is written to agent's message directories

### Step 5: Verify Completion
- Checks for completion message in `.ai/tx/mesh/test-echo/agents/echo-{uid}/msgs/complete/`
- Validates that at least one completion file exists

## Key Configuration

```javascript
MESH = 'test-echo'      // Target mesh
AGENT = 'echo'          // Target agent
TASK_STRING = 'simple e2e test'  // Task for spawn
TEST_TIMEOUT = 60000    // 60 second total timeout
```

## Expected Output

A successful test will show:

```
=== E2E Test: tx start -d → spawn test-echo → send task ===

📍 Step 1: Starting tx system in detached mode
   Running: tx start -d

📍 Step 2: Waiting for system readiness
✅ Session "core" detected
✅ Claude is ready in "core"

📍 Step 3: Injecting spawn command
   Injecting: spawn test-echo echo --init "simple e2e test"
✅ Found spawn session: test-echo-echo-set0

📍 Step 4: Waiting for task processing
   ⏳ Waiting 10 seconds for agent to process task...

📍 Step 5: Verifying task completion
🔍 Checking for task output...
   ✅ Found 1 complete message(s):
      - test-e2e-...md
      Preview: ---
from: echo
to: core
...

✅ TEST PASSED: Task was processed and completed!

🧹 Cleaning up...
   Stopping tx system...
   Killing session: core
   Killing session: test-echo-echo-set0
   Removing test mesh: .ai/tx/mesh/test-echo
✅ Cleanup complete

✅ E2E Test PASSED
```

## Debugging

If the test fails:

1. **Core session not created** - Check `tx start` command works manually
2. **Claude not ready** - May need to increase timeout (edit `test-e2e.js`)
3. **Spawn session not found** - Check that test-echo mesh config points to correct agent
4. **No completion files** - Agent may not have finished processing, check logs

### Manual Testing

You can manually run the same workflow:

```bash
# Terminal 1: Start tx
tx start -d

# Terminal 2: Attach to core
tx attach

# In Claude, run:
/spawn test-echo echo --init "test task"

# Check for output
ls -la .ai/tx/mesh/test-echo/agents/echo-*/msgs/complete/
```

## Files Created/Modified

- `test/test-e2e.js` - Main e2e test file
- `package.json` - Added `npm run test-e2e` script
- `meshes/mesh-configs/test-echo.json` - Fixed agent path to point to correct location

## Dependencies

The test requires:
- Node.js with child_process (spawn)
- tmux (for session management)
- The complete TX CLI system (`tx` command available)
- fs-extra for file operations

## Cleanup

The test automatically cleans up:
- Stops the tx system
- Kills all test sessions (core + spawn sessions)
- Removes test mesh data from `.ai/tx/mesh/test-echo/`

If cleanup fails, you can manually clean up:

```bash
# Kill sessions
tmux kill-session -t core
tmux kill-session -t test-echo-echo-*

# Stop system
tx stop

# Remove test data
rm -rf .ai/tx/mesh/test-echo/
```

## Timeout Behavior

- **Total test timeout**: 60 seconds
- **Core session wait**: 20 seconds
- **Claude ready check**: 30 seconds
- **Spawn session wait**: 20 seconds (polling with 500ms interval)
- **Task processing wait**: 10 seconds

If test hits timeout, it will:
1. Print `❌ TEST TIMEOUT` message
2. Cleanup all resources
3. Exit with code 1

## Success Criteria

The test passes when:

✅ TX system starts successfully (`tx start -d`)
✅ Core session is created and Claude initializes
✅ Spawn command is injected successfully
✅ Spawn session appears (test-echo-echo-*)
✅ Task completion files are created and found
✅ Cleanup completes without errors
✅ Exit code is 0

If any step fails, test exits with code 1.

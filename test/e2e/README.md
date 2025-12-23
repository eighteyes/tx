# E2E Topology Tests

## Topology Test - HITL + Iteration + Writer

Tests mesh topology patterns using the `test` mesh:
- **HITL**: ask-human → ask-response flow
- **Iteration**: agent loops back to itself (max 3 times)
- **Writer**: final task-complete to core

### Running the Test

**Prerequisites:**
- TX must be running: `tx start` (in another terminal/tmux)

**Run test:**
```bash
# From project root
node --import tsx --test test/e2e/topology-test.ts

# Or use npm script
npm run test:e2e
```

### What Gets Tested

1. **Core → Asker**: Initial task message routing
2. **Asker → Core**: ask-human message (HITL)
3. **Core → Asker**: ask-response message
4. **Asker → Looper**: Task with user input
5. **Looper → Looper**: Self-routing iteration (3x)
6. **Looper → Writer**: Completion trigger
7. **Writer → Core**: Final task-complete

### Expected Output

```
🧪 Starting topology test...

✅ Step 1: Wrote task to asker
⏳ Step 2: Waiting for ask-human message...
✅ Step 2: Got ask-human message
✅ Step 3: Wrote ask-response with "Blue"
⏳ Step 4: Waiting for iteration loops...
   Loop 1 detected
   Loop 2 detected
   Loop 3 detected
✅ Step 4: Looper sent to writer after iterations
⏳ Step 5: Waiting for final task-complete...
✅ Step 5: Got task-complete from writer

✅ TOPOLOGY TEST PASSED

Verified:
  ✓ HITL (ask-human → ask-response)
  ✓ Iteration loops (3 iterations)
  ✓ Final writer (task-complete to core)
  ✓ Data flow (user input preserved)
```

### Debugging

**Check message flow:**
```bash
# Watch messages directory
watch -n 1 'ls -lt .ai/tx/msgs | head -20'

# Check logs
tx logs
```

**Check worker state:**
```bash
cat .ai/tx/dispatcher-state.json | jq
```

### Mesh Config

Located at: `meshes/test/`
- `worker` - Simple test worker (original)
- `asker/` - Asks human for input (topology test)
- `looper/` - Iterates 3 times (topology test, self-routing)
- `writer/` - Writes final summary (topology test)

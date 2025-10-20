# Test-Pingpong - Ping Agent

## Your Role

You are the **ping** side of a ping-pong baseline test. Your job is to:

1. Receive ping messages from pong agent
2. Increment the round counter
3. Send response back to pong agent
4. Stop after 5 complete exchanges

## Workflow

1. **Receive task** in `msgs/active/`
2. **Extract round number** from message
3. **Process**: Increment round, log exchange
4. **If round < 5**: Send to pong via `send-next pong`
5. **If round = 5**: Send final result via `respond`
6. **Save output** to `.ai/tx/mesh/test-pingpong/shared/output/`

## Message Format

Incoming messages contain:
- `round`: Current round number (starts at 1)
- `sender`: Who sent it (should be "pong" after round 1)
- `timestamp`: ISO timestamp
- `exchanges`: List of all exchanges so far

## Output Format

When sending to pong:
```markdown
---
from: test-pingpong/ping
to: test-pingpong/pong
type: task-complete
round: [incremented]
sender: ping
timestamp: [current timestamp]
---

# Ping Response - Round [round]

Exchanges so far: [count]
```

When final (round 5):
```markdown
---
from: test-pingpong/ping
to: core
type: task-complete
task-status: resolved
---

# Test Complete: Ping-Pong Baseline

Total exchanges: 5
Completed successfully.
```

## Test Success Criteria

- ✅ All 5 rounds complete
- ✅ Alternates between ping and pong
- ✅ Round counter increments correctly
- ✅ Output saved to shared/output/

## Tips

- Use timestamps to verify message flow
- Keep exchange log in memory for final output
- Check sender field to ensure correct handoff

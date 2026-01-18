# dev-haiku - FSM Test Mesh

**Purpose**: Demonstrate and validate the FSM (Finite State Machine) feature for mesh orchestration.

**Key Features**:
- All agents use haiku model (cost-effective testing)
- 6-state workflow with deterministic transitions
- Gate validation between states
- Context variable tracking
- Script execution on state entry/exit
- Session persistence via continuation

## Workflow

```
init → explore → plan → implement → review → complete
```

### State Machine

| State | Coordinator | Purpose |
|-------|-------------|---------|
| **init** | coordinator | Initialize workspace |
| **explore** | worker | Analyze codebase, write findings |
| **plan** | coordinator | Create implementation plan |
| **implement** | worker | Write code based on plan |
| **review** | reviewer | Validate work and approve |
| **complete** | coordinator | Send completion to core |

### Transitions

Transitions are triggered by messages:

1. **init → explore**: Coordinator sends `ask: worker`
2. **explore → plan**: Worker sends `task-complete: coordinator` (exploration gate validates)
3. **plan → implement**: Coordinator sends `ask: worker` (plan gate validates)
4. **implement → review**: Worker sends `task-complete: coordinator` (code gate validates)
5. **review → complete**: Reviewer sends `task-complete: coordinator` (review gate validates)

### Gate Validation

Before each transition, the FSM runs validation scripts:

- **exploration-ready.sh**: Checks `findings.md` exists and has content (≥5 lines)
- **plan-ready.sh**: Checks `plan.md` exists and has content (≥3 lines)
- **code-ready.sh**: Checks implementation files were created
- **review-passed.sh**: Checks `review.md` contains "APPROVED"

If a gate fails, the FSM retries (up to 3 times for most gates). After retries exhausted, it allows the transition anyway.

## Context Variables

Tracked across state transitions:

```yaml
iteration: 0            # Incremented on each state entry
files_explored: 0       # Updated by worker during exploration
lines_written: 0        # Updated by worker during implementation
review_score: 0         # Updated by reviewer
```

These are injected into agent prompts so they can see progress.

## Usage

### Send Task to dev-haiku

```bash
# Create a test task
cat > /workspace/tx-cli-v4/.ai/tx/msgs/test-fsm.md << 'TASK'
---
to: dev-haiku/coordinator
from: core/core
type: task
msg-id: dev-haiku-test-1
headline: Test FSM workflow
---

Build a simple utility function that reverses a string.

Provide:
1. Working implementation
2. Clear documentation
3. Test cases (optional)
TASK

# Watch FSM transitions
tx spy dev-haiku
```

### Check FSM State

```bash
# View current state and context
tx fsm-state get dev-haiku

# Output:
# {
#   "meshName": "dev-haiku",
#   "state": "explore",
#   "context": {
#     "iteration": 0,
#     "files_explored": 0,
#     "lines_written": 0,
#     "review_score": 0
#   },
#   "updatedAt": 1705000000000
# }
```

### Manual State Override

```bash
# Skip to review state for testing
tx fsm-state set dev-haiku review --reason "Skip to review for quick testing"

# Reset to initial state
tx fsm-state reset dev-haiku --reason "Restart workflow"
```

## Testing

### Unit Tests

FSM core functionality is tested in `test/unit/mesh/fsm.test.ts`.

Run:
```bash
npm test -- test/unit/mesh/fsm.test.ts
```

### E2E Test

End-to-end test should be created in `test/e2e/12-dev-haiku-fsm.test.ts` to verify:
- Mesh spawns and initializes FSM
- State transitions occur in order
- Gates validate states before transitions
- Context variables update correctly
- Scripts run on state entry/exit
- Session persists (coordinator continuation works)
- Manual state override works

Run:
```bash
npm test -- test/e2e/12-dev-haiku-fsm.test.ts
```

### Manual E2E Testing

1. Start TX system: `tx start`
2. Send task (see "Send Task" section above)
3. Watch FSM transitions: `tx spy dev-haiku`
4. Check state after each transition: `tx fsm-state get dev-haiku`
5. Verify files in workspace: `ls -la $TX_WORKSPACE`

## Files

```
meshes/dev-haiku/
├── config.yaml              # Mesh + FSM configuration
├── README.md                # This file
├── coordinator/
│   └── prompt.md            # Coordinator agent prompt
├── worker/
│   └── prompt.md            # Worker agent prompt
├── reviewer/
│   └── prompt.md            # Reviewer agent prompt
└── scripts/
    ├── init.sh              # State entry: initialize workspace
    ├── increment-iteration.sh # State exit: update iteration counter
    ├── exploration-ready.sh  # Gate: validate exploration complete
    ├── plan-ready.sh        # Gate: validate plan created
    ├── code-ready.sh        # Gate: validate code created
    └── review-passed.sh     # Gate: validate review approved
```

## Key Design Points

1. **FSM owns state**: Agents don't manage state manually, system does
2. **Deterministic transitions**: All transitions are gated and validated
3. **Context injection**: Agents receive FSM context in prompts
4. **Fail-open gates**: If gates fail after retries, allow transition anyway
5. **Coordinator pattern**: Single haiku agent coordinates multiple workers
6. **Session persistence**: Only coordinator persists, others are ephemeral

## Debugging

### Check Logs

```bash
# View all FSM events
tail -f .ai/tx/logs/v4.last.jsonl | grep fsm

# View specific transitions
tail -f .ai/tx/logs/v4.last.jsonl | grep "fsm:transition"

# View gate checks
tail -f .ai/tx/logs/v4.last.jsonl | grep "fsm:gate"
```

### Stuck State

If FSM gets stuck in a state:

1. Check what files were created: `ls $TX_WORKSPACE`
2. Check gate requirements: Review the gate script
3. Override state manually: `tx fsm-state set dev-haiku next-state --reason "Manual recovery"`
4. Check logs for errors

## Related Documentation

- [FSM Documentation](../../docs/fsm.md) - Full FSM reference
- [Mesh Configuration](../../docs/mesh-config.md) - Config schema
- [Narrative Engine](../narrative-engine) - Production FSM example
- [Message Format](../../docs/message-format.md) - How to format messages

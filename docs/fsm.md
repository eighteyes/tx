# Finite State Machine (FSM) for Mesh Orchestration

## Overview

The FSM system provides **system-managed state tracking** for mesh workflows. Instead of letting agents infer state from files or manage state in prompts, the FSM enforces deterministic state transitions and provides context injection.

**Problem solved:**
- LLM agents don't infer state reliably from file existence
- State transitions become non-deterministic
- HITL flows lose state when workers respawn
- Session state isn't persisted across mesh invocations

**Solution:**
- System owns state via `MeshFSM` class
- Dispatcher validates transitions before dispatching messages
- Gate scripts enforce state preconditions
- SQLite persists state automatically

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      tx-cli Dispatcher                      │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ MeshFSM      │◄──│ Dispatcher   │◄──│ Consumer       │  │
│  │ (validates)  │   │ (gates)      │   │ (detects)      │  │
│  └──────────────┘   └──────────────┘   └────────────────┘  │
│         │                  │                               │
│         ▼                  ▼                               │
│  ┌──────────────┐   ┌──────────────────────────────────┐  │
│  │ SQLite       │   │ Worker: receives FSM context,    │  │
│  │ (persists)   │   │ emits work output + responses    │  │
│  └──────────────┘   └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Flow:**
1. Message arrives at dispatcher
2. Dispatcher checks FSM: `canTransition(sender, recipient, messageType)`
3. If allowed → execute transition → run gates → run scripts → inject context
4. Persist state to SQLite
5. Pass message to worker with FSM context injected

## Configuration

Add an `fsm` block to your mesh `config.yaml`:

```yaml
mesh: my-mesh
description: "My mesh"

agents:
  - name: coordinator
    model: haiku
    prompt: coordinator/prompt.md
  - name: worker
    model: sonnet
    prompt: worker/prompt.md

entry_point: coordinator
continuation: [coordinator]

# FSM Configuration
fsm:
  initialState: init

  context:
    turn: 0
    workspace: null
    iteration_count: 0

  states:
    - name: init
      coordinator: coordinator
      onEnter: scripts/setup.sh

    - name: working
      coordinator: worker
      gates:
        - type: script
          script: scripts/ready-to-work.sh
          maxRetries: 3
      onExit: scripts/cleanup.sh

    - name: complete
      coordinator: coordinator

  transitions:
    - from: init
      to: working
      trigger: ask
      triggerAgent: coordinator

    - from: working
      to: complete
      trigger: task-complete
      triggerAgent: worker
```

## Configuration Schema

### FSM Root Block

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `initialState` | string | ✅ | Starting state name (must exist in states) |
| `states` | FSMStateConfig[] | ✅ | Array of state definitions |
| `transitions` | FSMTransitionConfig[] | ✅ | Array of transition definitions |
| `context` | object | ❌ | Initial context values (default: `{}`) |

### State Definition

```yaml
states:
  state_name:
    coordinator: string              # Required: Agent that coordinates this state
    participants: string[]           # Optional: Other agents that participate
    gates: FSMGateConfig[]          # Optional: Gates to validate before transition
    onEnter: string                 # Optional: Script to run on state entry
    onExit: string                  # Optional: Script to run on state exit
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | State identifier (unique) |
| `coordinator` | string | ✅ | Agent name that coordinates this state |
| `participants` | string[] | ❌ | Other agents involved in this state |
| `gates` | FSMGateConfig[] | ❌ | Validation checks before state transition |
| `onEnter` | string | ❌ | Bash script path (relative to mesh root) |
| `onExit` | string | ❌ | Bash script path (relative to mesh root) |

### Gate Configuration

```yaml
gates:
  - type: script
    script: scripts/check-ready.sh
    maxRetries: 3
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'script'` \| `'agent-complete'` \| `'all-complete'` | ✅ | Gate type |
| `script` | string | For `type: script` | Path to gate validation script |
| `agent` | string | For `type: agent-complete` | Agent to check completion |
| `maxRetries` | number | ❌ | Max retries before allowing transition (default: 3) |

### Transition Configuration

```yaml
transitions:
  - from: init
    to: working
    trigger: ask
    triggerAgent: coordinator
    script: scripts/on-transition.sh
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | ✅ | Source state name |
| `to` | string | ✅ | Target state name |
| `trigger` | `'ask'` \| `'task-complete'` \| `'manual'` | ✅ | Message type that triggers transition |
| `triggerAgent` | string | ❌ | Restrict transition to this agent (default: any) |
| `script` | string | ❌ | Optional script to run during transition |

## Script Execution

Scripts are bash files that run at specific lifecycle points:

### onEnter Scripts

Runs when **entering** a state. Use for setup, initialization.

```bash
#!/bin/bash
# scripts/setup.sh

# Create workspace
mkdir -p "$TX_WORKSPACE"

# Initialize iteration counter
echo "ITERATION=0" >> "$TX_WORKSPACE/.fsm-context"

exit 0  # Exit 0 = success
```

**Environment Variables:**
- `TX_WORKSPACE` - Mesh workspace directory
- `TX_MESH_NAME` - Current mesh name
- `FSM_STATE` - Current state name

**Output Parsing:**
Scripts can output `KEY=value` pairs to update FSM context:
```bash
echo "GAME_ID=abc123"
echo "TURN=1"
```

### onExit Scripts

Runs when **exiting** a state. Use for cleanup, validation.

```bash
#!/bin/bash
# scripts/cleanup.sh

# Clean up temp files
rm -f "$TX_WORKSPACE/tmp-*"

exit 0
```

### Gate Scripts

Runs **before transition**. Use for precondition validation.

```bash
#!/bin/bash
# scripts/ready-to-work.sh

# Check that worker prepared files
if [[ ! -f "$TX_WORKSPACE/plan.md" ]]; then
  echo "ERROR: Worker did not create plan.md" >&2
  exit 1
fi

if [[ $(wc -l < "$TX_WORKSPACE/plan.md") -lt 5 ]]; then
  echo "ERROR: Plan too short (< 5 lines)" >&2
  exit 1
fi

# Update context
echo "PLAN_VALIDATED=true"

exit 0  # Gate passed
```

**Gate Behavior:**
- Exit code `0` = gate passes, proceed to next state
- Exit code non-zero = gate fails, retry (up to `maxRetries`)
- If all retries exhausted: log warning and allow transition anyway (fail-open)
- Script output `KEY=value` pairs update FSM context

## Context Variables

State context is persisted to SQLite and injected into agent prompts.

### Initialize Context

```yaml
fsm:
  initialState: init
  context:
    turn: 0
    game_id: null
    workspace: null
    score: 0
```

### Update Context from Scripts

Scripts output `KEY=value` lines to update context:

```bash
#!/bin/bash
# scripts/after-worker.sh

# Extract values from worker output
LINES=$(wc -l < "$TX_WORKSPACE/output.txt")
SCORE=$(grep "score:" "$TX_WORKSPACE/result.json" | jq '.score')

echo "LINES_WRITTEN=$LINES"
echo "SCORE=$SCORE"

exit 0
```

### Access Context in Prompts

FSM context is injected into agent task messages automatically:

```markdown
## FSM Context

**Current State**: working
**Turn**: 5
**Game ID**: abc123
**Score**: 87
**Workspace**: .ai/games/my-game

---

Your task: [original task]
```

Agents can reference context in reasoning but should not modify it (system owns state).

## State Transitions

### Automatic Transitions (Message-Triggered)

Transitions fire when:
1. Message type matches `trigger`
2. Sender (if `triggerAgent` specified) matches
3. All gates pass

Example:

```yaml
transitions:
  - from: planning
    to: implementation
    trigger: ask
    triggerAgent: coordinator
```

When coordinator sends `ask` message → automatic transition to `implementation` state.

### Manual State Override

For recovery from stuck states:

```bash
# View current state
tx mesh fsm-chain my-mesh

# Set state directly
tx mesh fsm-goto my-mesh complete

# Reset to initial state
tx mesh fsm-reset my-mesh
```

**Behavior:**
- Logs reason to audit trail
- Does NOT run `onEnter` scripts (clean slate)
- Emits `fsm:override` event

## Integration with Agents

### Coordinator Role

The `coordinator` agent (usually haiku) manages state and routing:

```markdown
# Coordinator Prompt

You are the state machine coordinator.

## FSM Context

**Current State**: planning
**Turn**: 1
**Status**: awaiting_analysis

---

## Your Responsibilities

1. **Route work**: Decide which agent to ask next
   - Check current state to understand what's allowed
   - Ask agents from coordinator's routing table

2. **Monitor completion**: When workers finish
   - Receive `ask-response` from worker
   - Send `task-complete` to core when workflow done

3. **Trust system state**: FSM owns state, not prompts
   - Don't infer state from file existence
   - Don't maintain session.yaml manually
   - Rely on FSM context injection

## Routing

Current state is "planning". Ask analyst to analyze:

```
ask: analyst
```

When analyst completes, ask reviewer:

```
ask: reviewer
```

Finally, send completion:

```
complete: core
```
```

### Worker Role

Workers execute tasks in assigned states:

```markdown
# Worker Prompt

You are the analysis worker.

## FSM Context

**Current State**: working
**Turn**: 5
**Workspace**: .ai/games/my-project

---

## Your Task

Analyze the codebase and create analysis.md.

When complete, send:

```
task-complete: coordinator
```

This triggers the FSM transition to the next state.
```

## CLI Commands

### View FSM State

```bash
tx mesh fsm-chain my-mesh
# Output:
# {
#   "state": "working",
#   "context": {"turn": 5, "game_id": "abc123"},
#   "updatedAt": 1705000000000
# }
```

### Set FSM State (Manual Override)

```bash
tx mesh fsm-goto my-mesh complete
```

### Reset to Initial State

```bash
tx mesh fsm-reset my-mesh
```

## Events

The dispatcher emits FSM events for monitoring:

### `fsm:transition`

Fired when state transitions successfully.

```typescript
interface FSMTransitionEvent {
  meshName: string;
  from: string;
  to: string;
  trigger: string;
  triggerAgent?: string;
  timestamp: number;
  durationMs?: number;
}
```

### `fsm:gate-check`

Fired when a gate is validated.

```typescript
interface FSMGateEvent {
  meshName: string;
  state: string;
  gate: FSMGateConfig;
  passed: boolean;
  retryCount: number;
  error?: string;
  timestamp: number;
}
```

### `fsm:script-run`

Fired when a script executes.

```typescript
interface FSMScriptEvent {
  meshName: string;
  scriptType: 'onEnter' | 'onExit' | 'transition' | 'gate';
  scriptPath: string;
  success: boolean;
  output?: string;
  error?: string;
  timestamp: number;
}
```

## Examples

### Simple 3-State Workflow

```yaml
mesh: simple-flow
description: "Basic request → process → complete"

agents:
  - name: coordinator
    model: haiku
    prompt: coordinator/prompt.md
  - name: processor
    model: sonnet
    prompt: processor/prompt.md

entry_point: coordinator
continuation: [coordinator]

fsm:
  initialState: request

  states:
    - name: request
      coordinator: coordinator

    - name: processing
      coordinator: processor
      gates:
        - type: script
          script: scripts/validate-input.sh

    - name: complete
      coordinator: coordinator

  transitions:
    - from: request
      to: processing
      trigger: ask
      triggerAgent: coordinator

    - from: processing
      to: complete
      trigger: task-complete
      triggerAgent: processor
```

### Multi-Agent with Gates

```yaml
mesh: review-flow
description: "Write → review → approve → publish"

agents:
  - name: coordinator
    model: haiku
    prompt: coordinator/prompt.md
  - name: writer
    model: sonnet
    prompt: writer/prompt.md
  - name: reviewer
    model: sonnet
    prompt: reviewer/prompt.md
  - name: publisher
    model: sonnet
    prompt: publisher/prompt.md

entry_point: coordinator
continuation: [coordinator]

fsm:
  initialState: init

  context:
    revision: 0
    approved: false

  states:
    - name: init
      coordinator: coordinator
      onEnter: scripts/setup.sh

    - name: writing
      coordinator: writer
      gates:
        - type: script
          script: scripts/check-draft.sh
          maxRetries: 2

    - name: review
      coordinator: reviewer
      gates:
        - type: script
          script: scripts/check-approval.sh

    - name: publish
      coordinator: publisher

    - name: complete
      coordinator: coordinator

  transitions:
    - from: init
      to: writing
      trigger: ask
      triggerAgent: coordinator

    - from: writing
      to: review
      trigger: task-complete
      triggerAgent: writer

    - from: review
      to: publish
      trigger: task-complete
      triggerAgent: reviewer

    - from: publish
      to: complete
      trigger: task-complete
      triggerAgent: publisher
```

## Best Practices

### 1. Keep States Simple

Each state should have **one clear responsibility**. Avoid complex multi-agent states.

❌ **Bad:**
```yaml
- name: analysis_and_planning
  coordinator: coordinator
  participants: [analyst, planner, reviewer]
```

✅ **Good:**
```yaml
- name: analysis
  coordinator: analyst

- name: planning
  coordinator: planner

- name: review
  coordinator: reviewer
```

### 2. Use Gates for Validation, Not Logic

Gates should **verify preconditions**, not implement decision logic.

❌ **Bad:**
```bash
#!/bin/bash
# Gate that decides what to do next
if [[ $CONDITION ]]; then
  echo "SHOULD_CONTINUE=true"
fi
```

✅ **Good:**
```bash
#!/bin/bash
# Gate that validates state
if [[ ! -f "required-file.md" ]]; then
  echo "ERROR: Missing required file" >&2
  exit 1
fi
exit 0
```

### 3. Coordinator Routes, FSM Validates

The coordinator agent chooses who to ask (routing). The FSM validates that the transition is allowed.

```markdown
# Coordinator Logic

If analyzing: ask analyst
If planning: ask planner
If reviewing: ask reviewer

(FSM automatically validates transitions)
```

### 4. Context for Metadata, Not Logic

Use context for tracking metadata (turn count, workspace path, game ID), not decision state.

✅ **Use context for:**
- Iteration count
- Workspace paths
- Game/session IDs
- Scores or metrics
- Resource identifiers

❌ **Don't use context for:**
- Decision flags (should be state transitions)
- Complex data structures (use files)
- Conditional routing (should be explicit transitions)

### 5. Scripts Are Fire-and-Forget

Scripts run synchronously and update context, but they **don't block transitions** if they fail (after retries).

Set realistic `maxRetries` for gates that might temporarily fail:

```yaml
gates:
  - type: script
    script: scripts/check-file.sh
    maxRetries: 5  # File might not be written yet
```

### 6. Backwards Compatibility

Meshes **without** an `fsm` block continue to work normally. FSM is opt-in.

```yaml
mesh: legacy-mesh
agents: [...]
# No fsm block = no state tracking
```

## Debugging

### Check FSM State

```bash
tx mesh fsm-chain my-mesh
```

### View Logs

FSM transitions are logged to `.ai/tx/logs/v4.jsonl`:

```bash
tail -f .ai/tx/logs/v4.last.jsonl | grep fsm
```

### Listen to Events

In your application code:

```typescript
dispatcher.on('fsm:transition', (event) => {
  console.log(`Transitioned: ${event.from} → ${event.to}`);
});

dispatcher.on('fsm:gate-check', (event) => {
  console.log(`Gate ${event.state}: ${event.passed ? 'PASS' : 'FAIL'}`);
});
```

### Stuck State Recovery

If FSM gets stuck:

```bash
# Override to next expected state
tx mesh fsm-goto my-mesh next-state

# View what happened
tx mesh fsm-chain my-mesh

# Restart from beginning
tx mesh fsm-reset my-mesh
```

## API Reference

### MeshFSM Class

```typescript
class MeshFSM extends EventEmitter {
  constructor(
    meshName: string,
    config: FSMConfig,
    db: Database,
    workDir: string
  );

  // Initialization
  async initialize(): Promise<void>;
  isInitialized(): boolean;

  // State access
  getCurrentState(): string;
  getCurrentStateConfig(): FSMStateConfig | undefined;
  getContext(): Record<string, unknown>;
  updateContext(updates: Record<string, unknown>): void;
  getStatus(): FSMStatus;

  // Transitions
  async handleMessage(
    from: string,
    to: string,
    messageType: string
  ): Promise<boolean>;

  // Manual overrides
  async setState(newState: string, reason: string): Promise<void>;
  async reset(reason: string): Promise<void>;

  // Persistence
  async serialize(): Promise<string>;
  async restore(data: string): Promise<void>;
}
```

## See Also

- [Mesh Configuration Reference](./mesh-config.md)
- [Message Flow](./message-flow.md)
- [Narrative Engine Example](../meshes/narrative-engine/README.md)

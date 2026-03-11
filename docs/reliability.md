# Reliability — Four Nines

TX reliability features organized by Karpathy's "March of Nines" — each nine requires fundamentally new approaches.

## Quick Start

```bash
# View reliability dashboard
tx mesh health

# View per-mesh reliability
tx mesh health reliability-test

# View dead letter queue
tx mesh dlq

# Recover failed work
tx mesh recover reliability-test
```

## Configuration

Set reliability thresholds in `.ai/tx/data/config.yaml`:

```yaml
reliability:
  circuitBreaker:
    failureThreshold: 3    # Failures before circuit opens
    cooldownMs: 30000      # How long circuit stays open
  heartbeat:
    warnMs: 60000          # Warn after 60s silence
    staleMs: 120000        # Stale after 120s
    deadMs: 300000         # Kill worker after 300s silence
  safeMode:
    autoEscalate: true     # Auto-restrict on SLI drop
    cautiousThreshold: 0.95
    restrictedThreshold: 0.90
    lockdownThreshold: 0.80
  dlq:
    maxRetries: 3
```

## Features

### 1. Circuit Breaker

**What it does**: Stops spawning an agent that keeps failing. Prevents cascade failures.

**States**: `closed` (normal) → `open` (blocked) → `half_open` (testing)

**How it works**:
- Each agent has an independent circuit
- After `failureThreshold` consecutive failures, circuit opens
- While open, `canSpawn()` returns false — dispatcher skips that agent
- After `cooldownMs`, circuit moves to half_open — allows one test spawn
- Success closes the circuit; failure re-opens it

**State persists to SQLite** — survives restarts.

**Observe it**:
```bash
tx mesh health           # Shows open/half_open circuits
tx spy                   # Watch for reliability:blocked activity
```

### 2. Heartbeat Monitor

**What it does**: Detects stuck workers and kills them.

**Thresholds**: `warn` → `stale` → `dead`

**How it works**:
- On spawn, agent is registered with the heartbeat monitor
- Every worker output event records a heartbeat
- A background timer checks silence intervals
- At `warnMs`: logs a warning
- At `staleMs`: logs a stale warning
- At `deadMs`: **kills the worker** via `AbortController.abort()`, records failure, routes to DLQ

**Observe it**:
```bash
tx mesh health           # Shows unhealthy agents with silence duration
tx logs --component reliability  # Heartbeat kill events
```

### 3. Dead Letter Queue (DLQ)

**What it does**: Captures failed work with enough context to recover it.

**Recovery modes**:
- `session_resume`: Agent had an active SDK session → recovery spawns a new worker with `session-id` front-matter, resuming the conversation where it left off. **Conversation history preserved.**
- `requeue`: No session existed → original message is re-injected into the queue for fresh dispatch.
- `manual`: Retries exhausted → needs human decision.

**How entries are created**:
- Worker exhausts all retries → dispatcher calls `reliability.deadLetter()` with the worker's sessionId, messages sent, and failure category
- Heartbeat kills a stuck worker → recorded as failure, may generate DLQ entry on next retry exhaustion

**How recovery works**:

**Important: Recovery requires human review.** The core agent is instructed to always diagnose, present options (resume vs rewind vs drop), and get explicit user confirmation before triggering recovery. This prevents silent re-execution of bad work.

1. **Automatic on startup**: When `tx start` runs, the dispatcher calls `recoverAll()` — recovers any pending session_resume and requeue entries from the previous run. (This is the only automatic path — it handles crash recovery between restarts.)

2. **Human-initiated via core agent** (preferred): User asks core to investigate. Core runs `tx mesh health` + `tx mesh dlq`, presents findings with available checkpoints, user picks a recovery strategy, core writes the recovery message.

3. **CLI**: `tx mesh recover <mesh>` sends a SIGUSR2 signal to the running dispatcher. Shows available checkpoints first.

4. **Front-matter message**: Core writes a message with `recover: true` (and optionally `rewind-to: <state>`) to trigger DLQ recovery.

5. **Fallback**: If the dispatcher isn't running, `tx mesh recover` writes a recovery message to the msgs dir that will be processed on next start.

**Observe it**:
```bash
tx mesh dlq              # List pending entries with recovery mode
tx mesh dlq my-mesh      # Filter by mesh
tx mesh dlq --json       # Machine-readable output
tx mesh dlq clear        # GC recovered entries
```

### Checkpoint Log & Rewind-To

**What it does**: Saves session IDs at every FSM state transition. Enables rewinding to any completed state instead of just the crash point.

**How checkpoints are saved**:
- Every time an FSM mesh transitions states, the completing agent's session ID is saved to SQLite
- Checkpoint key: `mesh_name + state_name` → `session_id`
- Multiple checkpoints per state are kept (most recent wins on lookup)

**How rewind-to works**:

When recovering from the DLQ, you can specify `rewind-to: <state>` to use a checkpoint's session ID instead of the crash-point session. This means the recovered worker resumes from after that state completed — skipping all the bad work that happened after.

```
FSM: analyze → build → verify → complete
                  ↑         ✗ (crashed here)
                  └── rewind-to: build (resumes from here)
```

**Three ways to trigger rewind-to**:

1. **CLI**:
   ```bash
   tx mesh recover my-mesh --rewind-to=build
   ```

2. **Front-matter message** (core agent):
   ```markdown
   ---
   to: my-mesh/worker
   from: core/core
   recover: true
   rewind-to: build
   ---
   The verify step went wrong. Rewind to after build completed.
   ```

3. **SIGUSR2 control signal** (programmatic):
   ```json
   {"action": "dlq-recover", "mesh": "my-mesh", "rewindTo": "build"}
   ```

**Viewing available checkpoints**:
```bash
tx mesh recover my-mesh    # Lists checkpoints before recovering
```
Output:
```
Available checkpoints (use --rewind-to=<state>):
  analyze              sid:a1b2c3d4  agent:my-mesh/analyst  2026-03-10 14:30:00
  build                sid:e5f6g7h8  agent:my-mesh/builder  2026-03-10 14:31:15
```

**When checkpoints are cleared**: On mesh completion (`clearMeshState`). Old checkpoints are garbage collected (keeps last 50 per mesh).

### 4. SLI Tracker

**What it does**: Measures success rate, failure categories, MTTR, and nines level.

**Metrics tracked**:
- Success rate (per-mesh, per-agent, overall)
- Nines level (90%, 99%, 99.9%, 99.99%)
- Mean Time To Recovery (MTTR)
- Failure taxonomy: `crash`, `timeout`, `model_error`, `policy_violation`, `circuit_open`, `stuck`

**How it works**:
- `recordSuccess()` on worker completion, `recordFailure()` on worker error
- In-memory with configurable retention window
- Feeds safe mode auto-escalation

**Observe it**:
```bash
tx mesh health              # Nines level, MTTR, failure breakdown
tx mesh health my-mesh      # Per-agent success rates
tx mesh health --json       # Full snapshot
```

### 5. Safe Mode

**What it does**: Restricts agent capabilities when reliability drops.

**Levels**:
| Level | Tool restrictions | Trigger |
|-------|------------------|---------|
| `normal` | None | Default |
| `cautious` | None (action-level blocks only) | SLI < cautiousThreshold |
| `restricted` | Write, Edit, NotebookEdit, Bash blocked | SLI < restrictedThreshold |
| `lockdown` | All tools blocked, spawns blocked | SLI < lockdownThreshold |

**How it works**:
- After every failure, SLI is evaluated against thresholds
- If `autoEscalate: true` and SLI drops below a threshold, safe mode escalates
- **Only escalates, never auto-de-escalates** — human must clear it
- At `restricted`+: a PreToolUse hook blocks Write/Edit/Bash calls
- At `lockdown`: `canSpawn()` blocks all new workers for that mesh

**Enforcement**: Safe mode hook is registered as a PreToolUse hook alongside write-gate and identity-gate. When an agent tries to use a blocked tool, it gets a rejection message explaining the restriction.

**Observe it**:
```bash
tx mesh health           # Shows current safe mode level
tx spy                   # Watch safe-mode:blocked activity events
```

## Test Mesh

The `reliability-test` mesh is configured with tight thresholds for quick testing:
- Circuit breaker opens after 2 failures (not 3)
- Heartbeat kills after 120s (not 300s)
- Safe mode auto-escalates at 80%/50%/25% (not 95%/90%/80%)

```bash
# Run the test mesh
tx msg "Write a hello world function" --to reliability-test/planner

# Monitor reliability during execution
tx mesh health reliability-test

# If failures occur, check DLQ
tx mesh dlq reliability-test

# Recover failed work
tx mesh recover reliability-test
```

## Front-Matter Options

Agents can interact with reliability features via message front-matter:

| Field | Value | Effect |
|-------|-------|--------|
| `recover` | `true` | Triggers DLQ recovery for the target mesh |
| `rewind-to` | FSM state name | Override recovery session with checkpoint from this state |
| `session-id` | SDK session ID | Spawns worker resuming that session |
| `resume-mesh` | `true` | Preserves mesh state instead of clearing on entry |

## CLI Reference

| Command | Description |
|---------|-------------|
| `tx mesh health [mesh]` | Reliability dashboard (SLI, circuits, safe mode, DLQ) |
| `tx mesh health --json` | Machine-readable health output |
| `tx mesh dlq [mesh]` | List dead letter queue entries |
| `tx mesh dlq clear` | Clear recovered DLQ entries |
| `tx mesh recover <mesh>` | Trigger DLQ recovery (shows checkpoints first) |
| `tx mesh recover <mesh> --rewind-to=<state>` | Recover rewinding to a specific FSM state |
| `tx mesh recover --all` | Recover all pending DLQ entries |

## Architecture

```
                    ┌──────────────────────┐
                    │  ReliabilityManager  │
                    │                      │
                    │  ┌─ SLI Tracker     │
                    │  ├─ Circuit Breaker  │ ← SQLite persisted
                    │  ├─ Heartbeat Monitor│ ← kills via bindings
                    │  ├─ Dead Letter Queue│ ← SQLite persisted
                    │  ├─ Checkpoint Log  │ ← SQLite, rewind-to
                    │  └─ Safe Mode       │ ← PreToolUse hook
                    │                      │
                    │  bindDispatcher({    │
                    │    killAgent,        │ ← WorkerLifecycle.killForAgent
                    │    requeueMessage,   │ ← SystemMessageWriter.write
                    │  })                  │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
        │ canSpawn() │   │recordFail │   │ heartbeat │
        │ safe mode  │   │ + DLQ     │   │ dead→kill │
        │ + circuit  │   │ + SLI     │   │ + DLQ     │
        └────────────┘   └───────────┘   └───────────┘
```

## Reliability Roadmap — Human Review Gates

Every reliability improvement includes human review steps. The system **never** silently changes behavior, retries destructively, or masks failures.

### Priority 1: Default-On Checkpoints + Replay

**Impact**: 10x — turns N-step recovery into 1-step problem
**Effort**: Medium

**What it does**: Every FSM state transition auto-saves a checkpoint. On failure, the user picks which checkpoint to rewind to and replay from.

**Human review steps**:
1. **Checkpoint notification**: When a mesh completes a state transition, core can optionally surface it: "Mesh X completed 'build' — checkpoint saved."
2. **Replay approval**: Before any rewind-to replay, core presents:
   - Which checkpoint to rewind to
   - What work will be replayed (states after the checkpoint)
   - What work will be discarded (failed states)
3. **Post-replay review**: After replay completes, core presents the result for user approval before the mesh continues to the next state.

**Never automatic**: Replay does not happen without the user choosing a checkpoint.

---

### Priority 2: Reliability Metrics Table + Tracking

**Impact**: Foundation for everything else
**Effort**: Low

**What it does**: SLI tracker records success rate, failure categories, MTTR, and nines level per mesh and per agent.

**Human review steps**:
1. **Threshold alerts**: When SLI drops below a configured threshold, core surfaces it: "Mesh X reliability dropped to 94.2% (below 95% cautious threshold). 3 failures in last 10 runs. Categories: 2x model_error, 1x timeout."
2. **Safe mode escalation approval**: Before escalating safe mode (cautious → restricted → lockdown), core presents the SLI data and asks: "Restrict write access for mesh X? Current SLI: 89%."
3. **De-escalation approval**: Safe mode never auto-de-escalates. Core presents current metrics and asks: "SLI recovered to 98%. Clear restricted mode for mesh X?"
4. **Periodic health summary**: On user request (`tx mesh health`), core presents a table of all meshes with SLI, open circuits, DLQ entries, and safe mode level.

**Never automatic**: Safe mode escalation beyond `cautious` requires user confirmation. SLI data is always visible.

---

### Priority 3: Retry-With-Variation on Routing/Protocol Failures

**Impact**: 3-5x improvement on retry success
**Effort**: Low

**What it does**: When a retry fires, it varies the approach — different prompt framing, model fallback, or simplified task scope — instead of repeating the identical failing request.

**Human review steps**:
1. **First failure notification**: On first failure, core reports: "Agent X failed (model_error). Retrying with variation: [describe variation]. Retry 1/3."
2. **Variation transparency**: Each retry logs what changed (e.g., "retry 2: simplified prompt, dropped optional context" or "retry 3: fallback model").
3. **Retry exhaustion review**: When all retries exhaust, core presents the full retry history: "3 retries failed for agent X. Variations tried: [list]. Recommend: [recovery options]." User decides next step.
4. **Variation strategy approval**: If a new variation strategy is added to config, core surfaces it for review before it takes effect.

**Never automatic**: Retries within the configured limit are automatic (they're cheap and fast), but the user sees what's happening. Exhausted retries always stop and ask.

---

### Priority 4: Output Schema Validation

**Impact**: Catches semantic failures early
**Effort**: Medium

**What it does**: Validates agent outputs against expected schemas (front-matter structure, required fields, output format) before passing results downstream.

**Human review steps**:
1. **Validation failure notification**: When output fails schema validation, core reports: "Agent X output failed validation: missing required field 'summary'. Output was [N] chars."
2. **Correction approval**: Before asking the agent to retry with validation feedback, core presents: "Ask agent X to fix output? Validation errors: [list]. Or drop this output?"
3. **Schema change review**: When a mesh config adds or modifies `output_schema`, core surfaces: "Mesh X now requires 'summary' field in output. Existing agents may need prompt updates."
4. **Partial pass handling**: When output partially validates (some fields valid, some not), core presents what passed and what failed. User decides: accept partial, retry, or drop.

**Never automatic**: Schema validation failures are always surfaced. The system does not silently discard or re-request outputs.

---

### Priority 5: Critical / Non-Critical Agent Classification

**Impact**: Prevents cascade from optional steps
**Effort**: Low

**What it does**: Agents are classified as `critical` (failure blocks mesh) or `non-critical` (failure is logged but mesh continues). Prevents optional agents from taking down the whole workflow.

**Human review steps**:
1. **Classification review**: When a mesh is loaded, core can surface agent classifications: "Mesh X: critical=[planner, builder], non-critical=[linter, formatter]."
2. **Non-critical failure notification**: When a non-critical agent fails, core reports: "Non-critical agent 'linter' failed (timeout). Mesh continues. Output from this step will be missing."
3. **Promotion decision**: If a non-critical agent fails repeatedly, core asks: "Agent 'linter' has failed 5 times. Should it be promoted to critical (failures block mesh) or disabled?"
4. **Critical failure escalation**: Critical agent failures always stop the mesh and present recovery options (Priority 1 checkpoints + Priority 3 retry history).

**Never automatic**: Non-critical failures are always reported. The user is never surprised by missing outputs from skipped agents.

---

### Priority 6: Aggregate Observability Dashboard

**Impact**: Needed to find the long-tail 0.01%
**Effort**: Medium

**What it does**: Unified view across all meshes — SLI trends, failure patterns, cost tracking, and anomaly detection.

**Human review steps**:
1. **Anomaly alerts**: When the dashboard detects anomalies (sudden SLI drop, unusual failure pattern, cost spike), core surfaces: "Anomaly detected: mesh X failure rate spiked from 2% to 15% in last hour. Failure category: model_error."
2. **Trend review**: On request, core presents trend data: "Last 24h: 47 mesh runs, 98.3% success, 1 DLQ entry (recovered). Top failure: timeout (3x in mesh Y)."
3. **Cost review gate**: Before approving expensive recovery (multiple retries, large context replay), core presents estimated cost: "Recovering mesh X with rewind-to will replay ~50k tokens. Proceed?"
4. **Weekly digest**: Core can present a weekly reliability summary: nines achieved, worst-performing meshes, recurring failure patterns, DLQ utilization.

**Never automatic**: The dashboard is passive — it collects and presents. All actions triggered by dashboard insights go through the standard human review workflow (diagnose → present → confirm → execute).

---

### Human Review Principle

Across all 6 priorities, the same principle applies:

> **The system does work. The human makes decisions.**

- Retries within limits → automatic (but visible)
- Recovery, replay, escalation → always human-approved
- Failures → always surfaced with context and options
- No silent state changes that affect mesh behavior

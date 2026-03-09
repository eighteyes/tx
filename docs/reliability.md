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

1. **Automatic on startup**: When `tx start` runs, the dispatcher calls `recoverAll()` — recovers any pending session_resume and requeue entries from the previous run.

2. **CLI**: `tx mesh recover <mesh>` sends a SIGUSR2 signal to the running dispatcher, triggering recovery for that mesh's DLQ entries.

3. **Front-matter message**: An agent (or core) can write a message with `recover: true` to trigger DLQ recovery:
   ```markdown
   ---
   to: reliability-test/planner
   from: core/core
   type: task
   recover: true
   ---
   Recover failed work.
   ```

4. **Fallback**: If the dispatcher isn't running, `tx mesh recover` writes a recovery message to the msgs dir that will be processed on next start.

**Observe it**:
```bash
tx mesh dlq              # List pending entries with recovery mode
tx mesh dlq my-mesh      # Filter by mesh
tx mesh dlq --json       # Machine-readable output
tx mesh dlq clear        # GC recovered entries
```

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
| `session-id` | SDK session ID | Spawns worker resuming that session |
| `resume-mesh` | `true` | Preserves mesh state instead of clearing on entry |

## CLI Reference

| Command | Description |
|---------|-------------|
| `tx mesh health [mesh]` | Reliability dashboard (SLI, circuits, safe mode, DLQ) |
| `tx mesh health --json` | Machine-readable health output |
| `tx mesh dlq [mesh]` | List dead letter queue entries |
| `tx mesh dlq clear` | Clear recovered DLQ entries |
| `tx mesh recover <mesh>` | Trigger DLQ recovery via running dispatcher |
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

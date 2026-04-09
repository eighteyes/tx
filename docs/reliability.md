# Reliability — Four Nines

TX reliability features organized by Karpathy's "March of Nines" — each nine requires fundamentally new approaches.

Human review gates for all features are documented in [HUMAN_REVIEW.md](./HUMAN_REVIEW.md).

## March of Nines — Current Status

| Nines | Technique | TX Status |
|-------|-----------|-----------|
| **1 (90%)** | Basic error handling, retries | SQLite WAL, worker retries (3x), injection poll loop, routing correction, graceful shutdown, usage policy recovery, recovery handler escalation |
| **2 (99%)** | Validation, protocol enforcement | Parity gate, FSM validation, mesh validator, identity gate, write gate, bash guard, manifest validator, guardrail config chain |
| **~2.5** | Self-healing / auto-recovery | Nudge detector, deadlock breaker, stale cleaner, quality iteration loops, session suspend/resume, FSM state persistence + backup, session store backfill |
| **3 (99.9%)** | Monitoring, circuit breaking, DLQ | Circuit breaker, heartbeat monitor, DLQ with session resume, SLI tracker, safe mode, checkpoint log, rate limiter, worker pool backpressure, metrics aggregator, worker lifecycle tracking |
| **4 (99.99%)** | [Roadmap] | Retry-with-variation, schema validation, agent classification, observability dashboard |

---

## Nine 1 — Basic Error Handling (90%)

Foundational durability. Nothing silently drops.

| Feature | What It Does | Where |
|---------|-------------|-------|
| **SQLite WAL mode** | Write-ahead logging prevents queue corruption on crash | `src/queue/index.ts` |
| **Worker retries (3x)** | Failed workers retry up to 3 times before DLQ | `src/worker/dispatcher.ts` |
| **Injection poll loop** | Core message injection retries on next poll if Claude is busy | `src/cli/start.ts` |
| **Routing correction injection** | Bad routing target → corrective prompt injected back to sender | `src/worker/dispatcher.ts` |
| **Graceful worker pool shutdown** | Drains active workers before terminating pool | `src/server/worker-pool.ts` |
| **Usage policy error handling** | Detects Claude API usage policy errors, writes ask-human message instead of crashing | `src/worker/usage-policy-error.ts` |
| **Recovery handler with escalation** | Tracks recovery requests per agent, escalates to human after 3 requests in 60s | `src/core/recovery.ts` |

### SQLite WAL Mode

**What it does**: Prevents queue corruption on crash via Write-Ahead Logging.

**How it works**:
- Enables WAL mode (`journal_mode=WAL`) on the SQLite message queue at init
- All writes are logged to WAL file before committing to main database
- Guarantees queue state is recoverable even if process crashes mid-write
- Allows concurrent readers while writes are in flight

### Worker Retries (3x)

**What it does**: Auto-retries failed workers before routing to DLQ.

**How it works**:
- Each worker has a state machine tracking retry attempts
- On error, checks `canTransition('retry')` before respawning
- Differentiates retriable errors (crashes, model overload) vs non-retriable (suspension, max-turns, abort)
- After max retries exhausted, routes to Dead Letter Queue for recovery

### Injection Poll Loop

**What it does**: Ensures messages reach the core Claude session even when it's busy.

**How it works**:
- Maintains an in-memory queue of messages waiting for injection into tmux
- Polls every 2s (`INJECTION_POLL_MS`) checking if Claude is idle, then injects
- Drops stale entries pending >5 minutes (they're available via `tx inbox`)
- Falls back to file-based delivery (`pending-for-core.json`) if active injection fails

### Routing Correction Injection

**What it does**: Recovers from bad routing by teaching the agent valid targets.

**How it works**:
- Detects messages targeting non-existent meshes/agents, increments retry counter per sender→target pair
- Injects corrective message back to sender listing valid available targets (up to max retries)
- After max retries exceeded, escalates to human via `ask-human` message
- Supports strict mode (block immediately) and warning mode (allow + notify) per guardrail config

### Graceful Worker Pool Shutdown

**What it does**: Prevents orphaned workers on shutdown.

**How it works**:
- Sets `running = false` to prevent new spawns, stops polling loop
- Collects all active worker promises and awaits completion via `Promise.all()`
- Logs count of in-flight workers being drained

### Usage Policy Error Handling

**What it does**: Captures false-positive usage policy errors with full diagnostic context.

**How it works**:
- Detects usage policy errors from Claude API via pattern matching
- Captures diagnostic context: triggering prompt, recent history, in-progress tool calls, agent/mesh info
- Writes `ask-human` message to core with full context for human decision (retry, skip, modify prompt, abort)
- Preserves session ID for potential resume

### Recovery Handler with Escalation

**What it does**: Detects repeatedly stuck agents and escalates to human.

**How it works**:
- Intercepts messages routed to `system/recovery`
- Tracks frequency per agent with time window; resets counter outside escalation window
- First 2 attempts: returns guidance with current FSM state, pending asks, and valid exit routes
- 3rd+ attempt: escalates to `core/core` for human intervention

---

## Nine 2 — Validation & Protocol Enforcement (99%)

Catch bad outputs and protocol violations before they propagate.

| Feature | What It Does | Where |
|---------|-------------|-------|
| **Parity gate** | Ensures completion agents answer all pending asks before completing | `src/worker/dispatcher.ts`, `src/core/consumer.ts` |
| **FSM validation** | State machine meshes enforce valid transitions, prevent skipped/repeated states | `src/state-machine/` |
| **Mesh validator** | Validates mesh config before loading (required fields, types, routing consistency) | `src/worker/mesh-validator.ts` |
| **Identity gate** | PreToolUse hook validates `from:` field matches agent identity | `src/worker/identity-gate.ts` |
| **Write gate** | Controls which paths agents can write to based on manifest | `src/worker/write-gate.ts` |
| **Bash guard** | PreToolUse hook blocks dangerous Bash patterns outside project boundary | `src/worker/bash-guard.ts` |
| **Manifest validator** | Validates agent output artifacts against declared manifest paths | `src/worker/manifest-validator.ts` |
| **Guardrail config chain** | Unified strict/warning mode with override chain: agent > mesh > global > hardcoded | `src/worker/guardrail-config.ts` |

### Parity Gate

**What it does**: Prevents agents from completing a mesh while unanswered questions remain.

**How it works**:
- Tracks pending asks (questions sent to human boundary `core/core`) in SQLite queue
- Validates responses from `core/core` have a matching pending ask by msg-id (fallback to agent-level matching)
- Blocks `task-complete` messages with unresolved asks; deletes offending file and emits `parity-reminder`
- Terminal-by-default: asks to `core/core` require parity; agent-to-agent asks don't trigger tracking

### FSM Validation

**What it does**: Enforces state machine rules before message routing.

**How it works**:
- Type-safe state transitions with guard validation and middleware hooks (pre/post)
- Consumer calls `validateMessageWithFSM()` on all incoming messages BEFORE type-specific routing
- Centralized validation ensures all routing respects mesh-defined FSM rules
- Emits transition history and immutable state snapshots for replay/debugging

### Mesh Validator

**What it does**: Catches config errors before a mesh can load.

**How it works**:
- Static `validate()` checks mesh config structure, required fields, agent definitions, routing rules, FSM definitions, and manifest entries
- Validates field types, agent presence, entry/exit points, task distribution config, guardrail overrides, and parallelism blocks
- Returns `ValidationResult` with errors and warnings — errors block load, warnings log
- Catches typos early (e.g., agent routing to nonexistent agents)

### Identity Gate

**What it does**: Prevents agents from impersonating other agents.

**How it works**:
- PreToolUse hook intercepts Write tool calls to `.ai/tx/msgs/`
- Extracts `from:` field from message YAML frontmatter, compares against expected agent identity
- Enforces fully-qualified names (rejects bare `worker` when agent is `dev/worker`) to prevent cross-mesh routing leaks
- Strike counter with configurable kill threshold; strict (block) vs warning (allow + feedback) modes

### Write Gate

**What it does**: Restricts file writes to declared manifest paths.

**How it works**:
- PreToolUse hooks intercept Write/Edit/NotebookEdit tools and Bash redirects (`>`, `>>`, `tee`)
- Validates target paths against agent's declared allowed paths from manifest
- Auto-exempts `.ai/tx/msgs/` and `.ai/tx/logs/`; allows `/dev/null`
- Tracks file-tool and bash-redirect strikes separately; kill threshold on accumulated violations

### Bash Guard

**What it does**: Docker-like isolation — full Bash inside project, can't escape.

**How it works**:
- Two security layers: workDir boundary enforcement + catastrophic damage prevention
- Blocks all filesystem operations (read/write/symlink) outside project directory
- Blocks privilege escalation, root destruction, system service manipulation, raw disk ops
- Network access explicitly allowed (Docker parity): curl, wget, ssh, npm publish are safe

### Manifest Validator

**What it does**: Validates agent artifacts against declared manifest paths.

**How it works**:
- Resolves manifest variable references (game-id, campaign-id, etc.) from `session.yaml` with caching
- Builds path context from mesh workspace config (locations, variables, source mappings)
- `validateAgentArtifacts()` checks agent reads/writes against declared manifest entries
- `findWriters()` identifies responsible agents for given file IDs (used in error messages)

### Guardrail Config Chain

**What it does**: Unified enforcement with flexible per-agent overrides.

**How it works**:
- Loads global guardrails from `.ai/tx/data/config.yaml` and mesh-local overrides from mesh config
- Resolution chain: agent-level > mesh-level > global agent > global mesh > global default > hardcoded default
- Each guardrail has `strict` and `warning` flags that resolve independently
- Supports backward-compatible bare numbers or structured `{strict, warning, limit}` objects

---

## Nine 2.5 — Self-Healing & Auto-Recovery

Detect stuck states and recover without human intervention where safe.

| Feature | What It Does | Where |
|---------|-------------|-------|
| **Nudge detector** | Detects when a completing agent fails to forward work; summarizes and writes recovery task | `src/worker/nudge-detector.ts` |
| **Deadlock breaker** | DFS cycle detection in ask graph; auto-breaks short cycles, escalates deep ones | `src/queue/deadlock-detector.ts` |
| **Stale message cleaner** | TTL-based GC for unprocessed queue entries (missing target, crashed worker) | `src/queue/stale-cleaner.ts` |
| **Quality iteration loops** | Quality hooks evaluate output → inject feedback → agent retries with feedback | `src/hooks/post/quality-evaluate.ts` |
| **Session suspend/resume** | Persists suspended session state to SQLite for crash recovery | `src/worker/session-manager.ts` |
| **FSM state persistence + backup** | Atomic backup-before-update; auto-restores from backup on corruption | `src/mesh/fsm-persistence.ts` |
| **Session store with backfill** | SQLite session persistence with FTS5 search; backfills from filesystem on startup | `src/session/session-store.ts` |

### Nudge Detector

**What it does**: Auto-recovers from missed route transitions.

**How it works**:
- Scheduled check runs after agent completion (15s delay), evaluates if routing targets received work
- Resolves expected targets using `DispatchRouter` with agent's declared routing rules (default outcome = `complete`)
- Skips terminal agents (core/core targets) and agents with already-sent messages
- Summarizes dead agent output with Haiku and writes recovery task via SystemMessageWriter
- Limits nudges per agent to prevent loops

### Deadlock Breaker

**What it does**: Detects and breaks circular wait loops between agents.

**How it works**:
- Periodic DFS-based cycle detection in pending asks graph (~every 60s) using 3-color marking
- Builds adjacency graph from queue pending asks; identifies circular chains (A→B→C→A)
- Auto-breaks cycles up to `autoBreakDepth` (default 3)
- Escalates deeper cycles (5+) to human via SystemMessageWriter with cycle visualization

### Stale Message Cleaner

**What it does**: Garbage collects unprocessed messages from crashed workers or typos.

**How it works**:
- Periodic scanner (every 5 minutes) checks queue messages against TTL (30 minutes default)
- Archives stale messages to `stale_messages` table with reason: `ttl_expired`, `no_target_mesh`, or `manual`
- Actions configurable: `warn`, `archive`, or `delete`
- Tracks known meshes to identify messages routed to non-existent targets; preserves audit trail

### Quality Iteration Loops

**What it does**: Validates output quality before routing, with iterative refinement.

**How it works**:
- Post-hook runs quality stack on worker output after message reception
- Runs gates (required + suggested) on output; returns `{passed, feedback}`
- Three failure modes: `halt` (stop), `loop` (retry if under max iterations), `skip` (allow through)
- Injects feedback messages on failure for agent self-correction

### Session Suspend/Resume

**What it does**: Non-destructive pause for external input with crash recovery.

**How it works**:
- Suspends sessions (kills worker, saves state to SQLite) when agent hits ask-human or await-response boundaries
- Buffers incoming responses while awaiting multiple targets (tracks `pendingResponseCount`)
- Persists to `suspended_sessions` table with reason, target agents, and hook context
- Dispatcher handles resume: loading state, creating new runner, wiring event handlers

### FSM State Persistence + Backup

**What it does**: Durable state across crashes with automatic corruption recovery.

**How it works**:
- SQLite tables: `mesh_state` (current) and `mesh_state_backup` (versioned backups)
- `saveState()` creates backup of previous state before updating (atomic via transaction)
- On corruption (JSON parse error), `loadState()` auto-restores from latest backup
- Indexes on `mesh_name + created_at` for efficient backup lookup

### Session Store with Backfill

**What it does**: Persistent session metadata with full-text search.

**How it works**:
- SQLite `sessions` table stores metadata: agent_id, mesh_id, timestamps, transcript path, message counts, final status
- FTS5 virtual table `sessions_fts` enables full-text search on content, headline, tags
- Prepared statements for fast CRUD; cache for summary types (e.g., `file_changes`, `decisions`)
- Backfills existing sessions from disk on startup (migration-friendly)

---

## Nine 3 — Monitoring, Circuit Breaking, DLQ (99.9%)

Active monitoring, automatic circuit-breaking, and dead letter recovery.

| Feature | What It Does | Where |
|---------|-------------|-------|
| **Circuit breaker** | Stops spawning agents that keep failing; auto-recovers after cooldown | `src/reliability/circuit-breaker.ts` |
| **Heartbeat monitor** | Detects stuck workers via silence thresholds; kills dead workers | `src/reliability/heartbeat-monitor.ts` |
| **Dead letter queue** | Captures failed work with session context for recovery | `src/reliability/dead-letter-queue.ts` |
| **SLI tracker** | Measures success rate, failure categories, MTTR, nines level | `src/reliability/sli-tracker.ts` |
| **Safe mode** | Restricts agent capabilities when reliability drops | `src/reliability/safe-mode.ts` |
| **Checkpoint log** | Saves session IDs at FSM transitions; enables rewind-to recovery | `src/reliability/checkpoint-log.ts` |
| **Rate limiter** | Token bucket rate limiting for server endpoints | `src/server/rate-limiter.ts` |
| **Worker pool backpressure** | Adaptive polling with concurrency limits | `src/server/worker-pool.ts` |
| **Metrics aggregator** | Per-query metrics with token cost tracking | `src/worker/metrics-aggregator.ts` |
| **Worker lifecycle tracking** | Unique instance IDs for deduplication and debugging | `src/worker/worker-lifecycle.ts` |

### Circuit Breaker

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

### Heartbeat Monitor

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

### Dead Letter Queue (DLQ)

**What it does**: Captures failed work with enough context to recover it.

**Recovery modes**:
- `session_resume`: Agent had an active SDK session → recovery spawns a new worker with `session-id` front-matter, resuming the conversation where it left off. **Conversation history preserved.**
- `requeue`: No session existed → original message is re-injected into the queue for fresh dispatch.
- `manual`: Retries exhausted → needs human decision.

**How entries are created**:
- Worker exhausts all retries → dispatcher calls `reliability.deadLetter()` with sessionId, messages sent, and failure category
- Heartbeat kills a stuck worker → recorded as failure, may generate DLQ entry on next retry exhaustion

**How recovery works**:

1. **Automatic on startup**: `tx start` calls `recoverAll()` — recovers pending session_resume and requeue entries from the previous run (crash recovery only).
2. **Human-initiated via core agent** (preferred): User investigates via `tx mesh health` + `tx mesh dlq`, picks recovery strategy, core writes recovery message.
3. **CLI**: `tx mesh recover <mesh>` sends SIGUSR2 to running dispatcher. Shows available checkpoints first.
4. **Front-matter message**: Core writes a message with `recover: true` (and optionally `rewind-to: <state>`) to trigger DLQ recovery.
5. **Fallback**: If dispatcher isn't running, `tx mesh recover` writes a recovery message to msgs dir for next start.

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
- Every FSM mesh state transition saves the completing agent's session ID to SQLite
- Checkpoint key: `mesh_name + state_name` → `session_id`
- Multiple checkpoints per state kept (most recent wins on lookup)

**How rewind-to works**:

When recovering from the DLQ, specify `rewind-to: <state>` to use a checkpoint's session ID instead of the crash-point session. The recovered worker resumes from after that state completed — skipping all bad work that happened after.

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

### SLI Tracker

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

### Safe Mode

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

### Rate Limiter

**What it does**: Token bucket rate limiting for server endpoints. Prevents burst overload.

**How it works**:
- Per-endpoint limits with configurable burst capacity
- Automatic bucket cleanup every 5 minutes
- Smooth rate limiting (not hard cutoff)

### Worker Pool Backpressure

**What it does**: Adaptive polling with concurrency limits prevents queue overload.

**How it works**:
- Polls for work at configurable intervals (default 100ms)
- Respects concurrency limits — won't spawn beyond capacity
- Graceful shutdown drains active workers before terminating

### Metrics Aggregator

**What it does**: Per-query metrics collection with token cost tracking.

**How it works**:
- Tracks input/output tokens, duration, cost per query
- Aggregate totals for worker lifetime
- Tool call counts per worker

### Worker Lifecycle Tracking

**What it does**: Tracks parallel worker execution with unique instance IDs.

**How it works**:
- Generates unique worker IDs (`agentId-uuid`)
- Tracks parallel execution per agent
- Persists worker state to disk
- Tracks nudge counts and completion frontier

---

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

## Test Mesh

The `reliability-test` mesh is configured with tight thresholds for quick testing:
- Circuit breaker opens after 2 failures (not 3)
- Heartbeat kills after 120s (not 300s)
- Safe mode auto-escalates at 80%/50%/25% (not 95%/90%/80%)

```bash
# Run the test mesh
tx run reliability-test planner "Write a hello world function"

# Monitor reliability during execution
tx mesh health reliability-test

# If failures occur, check DLQ
tx mesh dlq reliability-test

# Recover failed work
tx mesh recover reliability-test
```

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

## Roadmap — Nine 4 (99.99%)

| Priority | Feature | Impact | Effort |
|----------|---------|--------|--------|
| 1 | Retry-with-variation | 3-5x retry success improvement | Low |
| 2 | Output schema validation | Catches semantic failures early | Medium |
| 3 | Critical/non-critical agent classification | Prevents cascade from optional steps | Low |
| 4 | Aggregate observability dashboard | Finds the long-tail 0.01% | Medium |

### Retry-With-Variation

**What it does**: When a retry fires, it varies the approach — different prompt framing, model fallback, or simplified task scope — instead of repeating the identical failing request.

**How it will work**:
- First failure retries with variation: simplified prompt, dropped optional context, or fallback model
- Each retry logs what changed for transparency
- Exhausted retries present full retry history with variations tried

### Output Schema Validation

**What it does**: Validates agent outputs against expected schemas (front-matter structure, required fields, output format) before passing results downstream.

**How it will work**:
- Mesh config defines `output_schema` per agent
- Post-completion hook validates output against schema
- Partial pass handling: presents what passed and what failed for human decision

### Critical/Non-Critical Agent Classification

**What it does**: Agents classified as `critical` (failure blocks mesh) or `non-critical` (failure logged, mesh continues). Prevents optional agents from taking down the whole workflow.

**How it will work**:
- Agent config adds `critical: true|false` field (default: true)
- Non-critical failures logged and surfaced but don't block mesh
- Repeated non-critical failures prompt promotion decision

### Aggregate Observability Dashboard

**What it does**: Unified view across all meshes — SLI trends, failure patterns, cost tracking, and anomaly detection.

**How it will work**:
- Anomaly detection: sudden SLI drops, unusual failure patterns, cost spikes
- Trend data: success rates, DLQ utilization, MTTR over time
- Cost estimation before expensive recovery operations

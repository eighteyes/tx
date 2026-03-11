# Guardrails Configuration

Unified runtime enforcement of agent constraints via `GuardrailConfig`.

## Config Files

**Global**: `.ai/tx/data/config.yaml`
**Per-mesh**: `meshes/<mesh>/config.yaml` under `guardrails:`

```yaml
guardrails:
  write_gate:
    strict: false               # default: false (allow + warn)
    warning: true               # default: true (inject feedback)
    kill_threshold: null        # default: null (block only)
  read_gate:
    strict: false
    warning: true
    kill_threshold: null        # default: null (block only)
  identity_gate:
    strict: false               # default: false (allow + warn)
    warning: true               # default: true (inject feedback)
    kill_threshold: null        # default: null (block only)
  bash_guard:
    strict: true                # default: true (block violations)
    warning: true               # default: true (include reason)
  routing_error:
    strict: false
    warning: true
    max_retries: 3              # default: 3
    routing_retry_max: null     # default: null (no edge limit)
    routing_fallback: null      # default: null (no fallback agent)
  max_messages:
    strict: false
    warning: true
    limit: null                 # default: null (no limit)
  max_turns:
    strict: false
    warning: true
    limit: null                 # default: null (no limit)

  # Per-mesh and per-agent overrides
  meshes:
    narrative-engine:
      write_gate:
        strict: true
        kill_threshold: 5
      agents:
        narrator:
          write_gate:
            strict: false
            warning: true
            kill_threshold: 10
```

## Mode: strict / warning

Every guardrail supports two boolean toggles that control enforcement behavior.

| strict | warning | Result |
|--------|---------|--------|
| false  | true    | **Default** — Allow action + inject feedback to agent |
| true   | true    | Block/kill + reason (hard enforcement) |
| true   | false   | Block/kill silently |
| false  | false   | Allow silently (guardrail disabled) |

Default for all guardrails: `strict: false, warning: true`.

Set `strict: true` to restore blocking behavior (the pre-mode-switch default).

### Per-Guardrail Enforcement

| Guardrail | strict=true | warning=true (non-strict) |
|-----------|-------------|---------------------------|
| write_gate | Block tool use | Approve + systemMessage |
| read_gate | Block tool use | Approve + systemMessage |
| identity_gate | Block tool use | Approve + systemMessage |
| bash_guard | Block command + kill after 3 violations | Approve + systemMessage |
| routing_error | Kill/escalate after max_retries; redirect to fallback on edge limit | Log + return (no escalation); log + allow message through |
| max_messages | Kill worker | Log + allow worker to continue |
| max_turns | SDK halts session | No SDK limit; emit warning event at threshold |

### max_turns Special Case

The SDK enforces `maxTurns` internally. In warning mode (`strict: false`):
- `maxTurns: null` passed to SDK (no hard limit)
- Turns tracked manually via assistant message count
- `max-turns-warning` event emitted when configured threshold reached
- Worker continues running (no kill)

## Mesh-Local Config

```yaml
# meshes/my-mesh/config.yaml
guardrails:
  write_gate:
    strict: true
    kill_threshold: 5
  max_turns:
    strict: false
    warning: true
    limit: 50
  agents:
    narrator:
      write_gate:
        strict: false
        warning: true
        kill_threshold: 10
      max_turns:
        limit: 100
```

## Override Chain

Mesh-local wins. Global is fallback. Applies to both mode flags (`strict`/`warning`) and value fields.

```
1. mesh config.yaml guardrails.agents.{agent}.{field}   (mesh-local, agent)
2. mesh config.yaml guardrails.{field}                   (mesh-local, mesh)
3. global config.yaml guardrails.meshes.{mesh}.agents... (global, agent)
4. global config.yaml guardrails.meshes.{mesh}.{field}   (global, mesh)
5. global config.yaml guardrails.{field}                 (global)
6. Hardcoded default
```

`strict` and `warning` resolve independently through the same chain.

## Guardrails Reference

### Write Gate

Intercepts: `Write`, `Edit`, `NotebookEdit`, Bash redirects (`>`, `>>`, `tee`)

Activates when agent has `writes` entries in the mesh manifest.

| Behavior | Description |
|----------|-------------|
| Strike < threshold | Block + error listing allowed paths (strict) or approve + systemMessage (warning) |
| Strike >= threshold | Kill worker + log.error (strict only) |
| Exempt paths | `.ai/tx/msgs/`, `.ai/tx/logs/` (always allowed) |
| Separate counters | File tools and Bash redirects tracked independently |

Default kill threshold: **null** (block only, no kill)

### Read Gate

Intercepts: `Read`, `Glob`, `Grep`

Activates when agent has `reads` entries in the mesh manifest.

| Behavior | Description |
|----------|-------------|
| Strike (no kill) | Block + error (strict) or approve + systemMessage (warning) |
| Strike >= threshold | Kill worker if threshold set (strict only) |
| Bidirectional match | Parent dirs of allowed paths also pass (for Glob/Grep) |

Default kill threshold: **null** (data gathering mode, no kill)

### Identity Gate

Intercepts: `Write` to `.ai/tx/msgs/` directory

Validates `from:` field in message frontmatter matches agent's actual identity. Catches weaker models that forget their agent name.

| Behavior | Description |
|----------|-------------|
| Always enabled | No manifest entry required — applies to all agents |
| Frontmatter parsing | Extracts `from:` from YAML frontmatter |
| Identity matching | Exact match, case-insensitive, or partial (agent name without mesh) |
| Strike < threshold | Block + error with correct identity (strict) or approve + systemMessage (warning) |
| Strike >= threshold | Kill worker + log.error (strict only) |

Default kill threshold: **null** (block only, no kill)

**Example violation**: Agent `dev/worker` writes message with `from: some-other-agent`

### Routing Error

Corrective injection when an agent targets a non-existent mesh/agent, and per-edge message caps to prevent infinite loops.

| Field | Default | Description |
|-------|---------|-------------|
| `max_retries` | 3 | Attempts before escalating to human (strict) or logging (warning) |
| `routing_retry_max` | null | Max messages per edge per turn. null = no edge limit |
| `routing_fallback` | null | Fallback agent when edge limit hit (strict: redirect, warning: log only) |

Edge limit fields use the full resolution chain (agent > mesh > global > default). Top-level `routing_fallback` and `routing_retry_max` are deprecated — use `guardrails.routing_error` instead.

### Max Messages

Per-agent cap on outbound messages per worker invocation.

| Field | Default | Description |
|-------|---------|-------------|
| `limit` | null | Message cap (null = no limit) |

Strict: kills worker. Warning: logs and allows.

### Max Turns

Per-agent cap on SDK conversation turns.

| Field | Default | Description |
|-------|---------|-------------|
| `limit` | null | Turn cap (null = no limit) |

Strict: SDK enforces hard limit. Warning: emits event at threshold, no kill.

### Max Mesh Messages

Mesh-wide cap on total messages across all agents in a mesh run.

| Field | Default | Description |
|-------|---------|-------------|
| `limit` | null | Total message cap for mesh (null = no limit) |

Strict: kills all active workers in the mesh. Warning: logs and allows mesh to continue.

Configured at mesh level only (not per-agent). Resets when a new turn starts (entry_point receives a task).

**Note**: The top-level `max_mesh_messages` field in mesh `config.yaml` takes precedence over the guardrails chain. Falls back to `guardrails.max_mesh_messages` (mesh > global > default).

```yaml
# Mesh config.yaml - direct value
max_mesh_messages: 50

# Mesh config.yaml - object form
max_mesh_messages:
  strict: true
  warning: true
  limit: 50

# Global config.yaml guardrails
guardrails:
  max_mesh_messages:
    strict: false
    warning: true
    limit: 100
  meshes:
    my-mesh:
      max_mesh_messages:
        limit: 30
```

### Violation Escalation

Gate violations inject a steering message that tells the agent what paths are allowed. The message includes guidance to write to `core/core` if the agent believes a path should be allowed — putting escalation in the agent's hands rather than auto-notifying.

### Bash Guard

SDK PreToolUse hook that enforces workDir boundary for Bash commands. Replaces Docker container isolation with runtime boundary enforcement.

**Philosophy**: Docker replacement model — agents have full Bash access but cannot escape the working directory, just like processes inside a container cannot access the host filesystem.

**Config**: `guardrails.bash_guard` or per-mesh/agent override.

```yaml
guardrails:
  bash_guard:
    strict: true    # Block violations (default: true)
    warning: true   # Include reason in block message (default: true)
```

| Behavior | Description |
|----------|-------------|
| Catastrophic denylist | Blocks privilege escalation (sudo, su), system operations (reboot, systemctl), raw disk writes (dd, mkfs), root filesystem destruction (rm -rf /), Docker host mount, encoded payload piped to shell |
| Write-path boundary | Extracts destination paths from write operations (rm, cp, mv, mkdir, redirects, tar -C, git clone, pip/npm install --target, sed -i, tee, scripting language file writes) and blocks if outside workDir |
| cd/pushd blocking | Blocks `cd` or `pushd` to directories outside workDir (prevents state change that affects subsequent commands) |
| cd-then-destroy detection | Detects `cd /outside && rm -rf *` compound commands where cd changes context before destruction |
| Home directory protection | Catches `~`, `~/path`, `$HOME`, `${HOME}` — resolves and blocks if outside workDir |
| Env var protection | Catches `$TMPDIR`, `$TMP`, `$TEMP`, `$OLDPWD` and `${VAR}` variants |
| Kill threshold | 3 violations in strict mode = worker terminated |
| Network allowed | curl, wget, ssh, git push, npm publish — all allowed (Docker parity) |
| Reads allowed | cat, head, grep, find (read-only) — allowed anywhere. Only write operations are boundary-checked |

**Explicitly NOT blocked**: Network access, read operations, relative paths within workDir, /dev/null|stdout|stderr.

**Escape hatch**: `tx start dev --god-mode` bypasses all permissions including bash guard (sets `TX_GOD_MODE=1`).

```yaml
# Per-mesh strict enforcement
# meshes/my-mesh/config.yaml
guardrails:
  bash_guard:
    strict: true
    warning: true
```

| File | Role |
|------|------|
| `src/worker/bash-guard.ts` | BashGuard class — catastrophic denylist, path extraction, boundary check |
| `src/worker/permissions.ts` | Default tool lists, permission resolution, god mode |
| `src/worker/dispatcher.ts` | Wires BashGuard into PreToolUse hooks |

### Orchestrator Gate

Per-agent flag that restricts an agent to routing-only behavior.

**Config**: Set `orchestrator: true` on an agent in `config.yaml`.

| Behavior | Description |
|----------|-------------|
| Tool allowlist | Only `Read` and `Write` tools available (no Bash, Edit, Glob, Grep, etc.) |
| Write path restriction | `Write` calls blocked unless `file_path` starts with the msgs directory |
| PreToolUse hook | Enforced via SDK hook — agent cannot bypass |
| Use case | Coordinator/dispatcher agents that should route work, not implement it |

```yaml
# meshes/my-mesh/config.yaml
agents:
  - name: orchestrator
    model: sonnet
    prompt: orchestrator.md
    orchestrator: true   # Read anything, Write only to msgs dir
```

**Why not just a prompt instruction?** LLMs with access to tools will often ignore "don't code" instructions when the task seems simple enough. System-level enforcement prevents this.

### Parity (Non-configurable)

Always-on validation that completion agents match boundary agents. Not exposed in config.

## Implementation

| File | Role |
|------|------|
| `src/worker/guardrail-config.ts` | GuardrailConfig class — load config, resolve thresholds and mode |
| `src/worker/bash-guard.ts` | BashGuard class — workDir boundary enforcement for Bash |
| `src/worker/permissions.ts` | Tool permission defaults and resolution (dontAsk mode) |
| `src/worker/write-gate.ts` | WriteGate class — SDK PreToolUse hooks for writes |
| `src/worker/read-gate.ts` | ReadGate class — SDK PreToolUse hooks for reads |
| `src/worker/identity-gate.ts` | IdentityGate class — SDK PreToolUse hooks for message identity |
| `src/worker/dispatcher.ts` | Wires guardrails into worker spawn pipeline |
| `src/worker/sdk-runner.ts` | max_turns warning mode (manual turn tracking) |

## Setting null vs number

- `kill_threshold: 3` — kill worker after 3 violations
- `kill_threshold: null` — block violations but never kill (data gathering)
- Omit entirely — use parent level or hardcoded default

## max_messages / max_turns as Objects

These fields accept either a bare number (backward compatible) or an object:

```yaml
# Bare number (legacy, strict/warning inherit from parent)
max_messages: 10
max_turns: 50

# Object (full control)
max_messages:
  strict: true
  warning: true
  limit: 10
max_turns:
  strict: false
  warning: true
  limit: 50
```

## Reliability (Four Nines)

The reliability module (`src/reliability/`) provides four-nines (99.99%) patterns inspired by Karpathy's "March of Nines". Each nine requires fundamentally new approaches:

| Nine | Target | TX Mechanism |
|------|--------|-------------|
| 1 (90%) | Basic error handling | Logging, guardrails, FSM validation |
| 2 (99%) | Message recovery | Dead Letter Queue, retry with backoff |
| 3 (99.9%) | Failure isolation | Circuit breakers, heartbeat monitoring |
| 4 (99.99%) | Proactive safety | SLI tracking, safe mode, failure taxonomy |

### Configuration

Add to `.ai/tx/data/config.yaml`:

```yaml
reliability:
  circuitBreaker:
    failureThreshold: 3      # Failures before circuit opens
    cooldownMs: 60000         # Wait before probe request
    windowMs: 300000          # Failure counting window (5 min)
  heartbeat:
    warnMs: 60000             # Silence before warning (1 min)
    staleMs: 120000           # Silence before stale (2 min)
    deadMs: 300000            # Silence before dead (5 min)
    checkIntervalMs: 15000    # Check interval (15s)
  safeMode:
    defaultLevel: normal      # normal | cautious | restricted | lockdown
    autoEscalate: false       # Auto-escalate based on SLI
    cautiousThreshold: 0.95   # SLI rate triggering cautious mode
    restrictedThreshold: 0.90 # SLI rate triggering restricted mode
    lockdownThreshold: 0.80   # SLI rate triggering lockdown
  dlq:
    maxRetries: 3             # Max retries before DLQ
  sli:
    retentionMs: 604800000    # SLI data retention (7 days)
```

### Dead Letter Queue (DLQ)

Messages that fail delivery after max retries are routed to the DLQ instead of being silently dropped. DLQ entries persist in SQLite and can be replayed manually.

- Automatic retry with exponential backoff
- Failure reason tracking for taxonomy
- Replay capability for manual recovery
- Stats available via `reliability.dlq.getStats()`

### Circuit Breaker

Prevents cascading failures when an agent repeatedly fails. Three states:

| State | Behavior |
|-------|----------|
| **Closed** | Normal — requests pass through |
| **Open** | Failures exceeded threshold — requests fail immediately |
| **Half-Open** | After cooldown — single probe request allowed |

Applied per-agent (`mesh/agent`). Resets on mesh completion.

### Heartbeat Monitor

Detects stalled/hung workers by monitoring output timestamps:

| Level | Default | Action |
|-------|---------|--------|
| Warn | 60s silence | Log warning |
| Stale | 120s silence | Inject nudge to worker |
| Dead | 300s silence | Record failure, trigger circuit breaker |

### SLI Tracker

Tracks success rates, latencies, and failure categories per mesh:

- **Success rate**: Per-mesh and per-agent (target: 99.99%)
- **MTTR**: Mean time to recovery (failure → next success)
- **Failure taxonomy**: Categorized failures for targeted fixes
- **Nines level**: Human-readable "99.9% (3 nines)" display

Failure categories: `model_error`, `routing_error`, `timeout`, `guardrail_kill`, `crash`, `stuck`, `policy_violation`, `gate_failure`, `circuit_open`, `unknown`

### Safe Mode

Treat autonomy as a knob, not a switch. Four levels:

| Level | Tools Disabled | Actions Blocked |
|-------|---------------|-----------------|
| **normal** | None | None |
| **cautious** | None | Destructive bash, git push, file delete |
| **restricted** | Write, Edit, Bash | All writes, all bash, git operations |
| **lockdown** | All tools | All operations (stops agent execution) |

Safe mode can be:
- Set manually per-mesh or globally
- Auto-escalated based on SLI thresholds (when `autoEscalate: true`)
- Only escalates automatically; human must clear/de-escalate

### Test Meshes

Two meshes for testing reliability features:

- **`reliability-test`**: Simple 3-agent linear mesh (planner → worker → checker) with tight guardrails
- **`reliability-fsm`**: FSM-based mesh with gate scripts, iteration tracking, and state transitions

### Implementation

| File | Role |
|------|------|
| `src/reliability/index.ts` | Module exports |
| `src/reliability/reliability-manager.ts` | Central coordinator (single integration point) |
| `src/reliability/dead-letter-queue.ts` | DLQ with SQLite persistence |
| `src/reliability/circuit-breaker.ts` | Per-agent circuit breaker |
| `src/reliability/heartbeat-monitor.ts` | Stalled worker detection |
| `src/reliability/sli-tracker.ts` | SLI measurement and nines calculation |
| `src/reliability/safe-mode.ts` | Gradual autonomy control |

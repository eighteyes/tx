# Human Review Gates — Reliability

Every reliability feature includes human review steps. The system **never** silently changes behavior, retries destructively, or masks failures.

> **The system does work. The human makes decisions.**

- Retries within limits → automatic (but visible)
- Recovery, replay, escalation → always human-approved
- Failures → always surfaced with context and options
- No silent state changes that affect mesh behavior

See [reliability.md](./reliability.md) for feature details.

---

## Nine 1 — Basic Error Handling

### Worker Retries
- When retries exhaust → DLQ entry created → core presents failure to user
- User decides: retry with variation, recover from checkpoint, or drop

### Injection Poll Loop
- Stale entries (>5min) are dropped but remain available via `tx inbox`
- If file-based fallback activates, user sees pending messages on next interaction

### Routing Correction
- When routing retries exhaust → escalated to user with full attempt history
- User sees which targets were tried and picks correct one

### Usage Policy Errors
- Human chooses: retry, skip, modify prompt, or abort
- Full diagnostic context (triggering prompt, recent history) included in ask-human message

### Recovery Handler
- First 2 recovery requests: automatic guidance with FSM state and valid routes
- 3rd+ request in 60s: escalated to human — agent is repeatedly stuck

---

## Nine 2 — Validation & Protocol Enforcement

### Parity Gate
- Violations → reminder injected to agent
- If unresolved after reminder → surfaced to user with pending asks list

### Identity Gate
- Kill events → logged with full reason (agent ID, expected vs actual `from:` field)
- User can audit identity violations via logs

### Mesh Validator
- Validation errors → block mesh load, user sees what's wrong and how to fix it
- Warnings → logged but don't block (user can review in logs)

### Manifest Validator
- Validation failures → surfaced to user with missing/invalid paths and responsible agents

### Bash Guard
- 1-2 violations → error response with allowed paths shown to agent
- 3+ violations → worker killed, logged for forensics
- User can audit bash guard events in logs

---

## Nine 2.5 — Self-Healing & Auto-Recovery

### Nudge Detector
- Nudges are logged and visible in `tx spy`
- Max 1 nudge per agent prevents recovery loops

### Deadlock Breaker
- Shallow cycles (depth ≤ 3) → auto-broken, logged
- Deep cycles (depth 5+) → escalated to human with cycle visualization (A→B→C→A)
- User decides which agent's ask to drop

### Stale Message Cleaner
- Stale messages archived with reason — no silent deletion
- User can audit via `tx spy` and review archived messages

### Quality Iteration Loops
- Max iterations hit → presents feedback history to user
- User decides: retry, accept current output, or drop
- Each iteration's feedback is visible for review

---

## Nine 3 — Monitoring, Circuit Breaking, DLQ

### Circuit Breaker
- Circuit open → agent skipped, logged with failure count
- Half-open test spawn → user can monitor via `tx mesh health`
- Circuits don't auto-close silently — health dashboard shows state

### Heartbeat Monitor
- Warn threshold → logged warning (no action)
- Stale threshold → logged stale warning
- Dead threshold → **worker killed**, failure recorded, routed to DLQ
- All events visible in `tx mesh health` with silence duration

### Dead Letter Queue
- **Recovery always requires human review** (except crash recovery on restart)
- Core agent diagnoses, presents options (resume vs rewind vs drop), gets explicit confirmation
- Available checkpoints shown before any recovery action
- `tx mesh dlq` shows all pending entries with recovery mode and context

### Checkpoint Log & Rewind-To
- Checkpoint notification: core can surface "Mesh X completed 'build' — checkpoint saved"
- Before rewind-to replay, core presents: which checkpoint, what replays, what's discarded
- Post-replay: result presented for user approval before mesh continues
- **Replay never happens without user choosing a checkpoint**

### SLI Tracker
- Threshold alerts: "Mesh X reliability dropped to 94.2% (below 95% cautious threshold). 3 failures in last 10 runs. Categories: 2x model_error, 1x timeout."
- Periodic health summary available via `tx mesh health`
- SLI data always visible — never hidden from user

### Safe Mode
- **Escalation beyond cautious requires user confirmation** when surfaced via core
- Auto-escalation (if enabled) is logged with reason and SLI data
- **Never auto-de-escalates** — human must clear via `resetMesh()` or `resetAll()`
- Core presents: "SLI recovered to 98%. Clear restricted mode for mesh X?"

---

## Roadmap — Nine 4

### Retry-With-Variation
- First failure: core reports "Agent X failed (model_error). Retrying with variation: [description]. Retry 1/3."
- Each retry logs what changed (e.g., "retry 2: simplified prompt, dropped optional context")
- Exhausted retries: core presents full retry history with variations tried — user decides next step
- New variation strategies require review before taking effect

### Output Schema Validation
- Validation failure: core reports "Agent X output failed validation: missing required field 'summary'."
- Before retry with validation feedback, core presents: "Ask agent X to fix? Validation errors: [list]. Or drop?"
- Schema changes in mesh config: core surfaces impact on existing agents
- Partial pass: core shows what passed/failed, user decides accept partial, retry, or drop

### Critical/Non-Critical Agent Classification
- On mesh load, core can surface classifications: "critical=[planner, builder], non-critical=[linter]"
- Non-critical failure: "Agent 'linter' failed (timeout). Mesh continues. Output from this step missing."
- Repeated non-critical failures: "Agent 'linter' failed 5 times. Promote to critical or disable?"
- Critical failures always stop the mesh and present recovery options

### Aggregate Observability Dashboard
- Anomaly alerts: "Mesh X failure rate spiked from 2% to 15% in last hour. Category: model_error."
- Cost review gate: "Recovering mesh X with rewind-to will replay ~50k tokens. Proceed?"
- Dashboard is passive — all actions from insights go through standard human review

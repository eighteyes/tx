/**
 * tx agent-help - Runtime reference for AI agents
 *
 * Outputs critical TX information that agents can consume at runtime.
 * Designed to be called by agents when they need a refresher on message
 * format, frontmatter fields, workflows, debugging, etc.
 *
 * Usage:
 *   tx agent-help                  Show all topics
 *   tx agent-help messages         Message format and frontmatter
 *   tx agent-help parallel         Parallel instance spawning
 *   tx agent-help routing          Routing and outcomes
 *   tx agent-help workflows        Common workflows (send, interrupt, stop, debug)
 *   tx agent-help recovery         Session resumption, DLQ, checkpoints, crash recovery
 *   tx agent-help operator         Operator tools for stuck meshes
 *   tx agent-help debugging        Logs, forensics, troubleshooting
 */

const TOPICS: Record<string, string> = {

  messages: `# TX Message Format

Messages are markdown files written to .ai/tx/msgs/

## Structure

\`\`\`markdown
---
to: mesh/agent
from: core/core
msg-id: task-{timestamp}
headline: Short description
timestamp: {ISO-8601}
---

Body content here.
\`\`\`

## Required Frontmatter

| Field       | Description                                    |
|-------------|------------------------------------------------|
| to          | Recipient: mesh/agent (e.g., dev/worker)       |
| from        | Sender: mesh/agent (e.g., core/core)           |
| msg-id      | Unique ID for correlation                      |
| headline    | Human-readable summary                         |
| timestamp   | ISO-8601 timestamp                             |

## Optional Frontmatter

| Field            | Default | Description                                      |
|------------------|---------|--------------------------------------------------|
| type             | -       | Inferred from routing. Explicit: task, task-complete, error |
| status           | -       | Routing outcome: complete, error, blocked        |
| command          | -       | Slash command to trigger (e.g., /know:build)     |
| feature          | -       | Feature name for worktree meshes (kebab-case)    |
| model            | agent   | Override model: opus, sonnet, haiku              |
| inject-response  | false   | Auto-inject response into core session           |
| session-id       | -       | Resume specific session                          |
| priority         | -       | Queue processing priority                        |
| revision         | -       | Update mode: interrupt, append, replace          |
| parallel         | -       | Set to "true" to spawn parallel instance         |
| mesh-id          | -       | Instance identifier for parallel meshes          |
| format           | -       | Response display: "verbatim" = render as-is      |

## Filename Convention

{timestamp}-{type}-{from}--{to}-{msg-id}.md

Example: 1772565000-task-core--dev-worker-task-123.md

## Type Inference (Terminal-by-Default)

Type is inferred when omitted:
- To core/core with status: complete → task-complete
- To core/core without status → ask-human (suspends sender)
- To worker agent → task
- From core/core → ask-response (resumes suspended agent)
`,

  parallel: `# Parallel Mesh Instances

Run multiple copies of the same mesh simultaneously.

## Spawning a New Instance

Add parallel: true and mesh-id to frontmatter:

\`\`\`markdown
---
to: dev-lite/worker
from: core/core
parallel: true
mesh-id: auth-module
msg-id: task-123
headline: Build auth module
timestamp: 2026-01-01T00:00:00.000Z
---

Build the authentication module.
\`\`\`

## Rules

- parallel: true + mesh-id → spawns new instance
- mesh-id alone (no parallel) → routes to existing instance
- parallel: true WITHOUT mesh-id → ERROR
- Instance names: {mesh}-{mesh-id} (e.g., dev-lite-auth-module)
- Each instance has independent sessions and state
- max_instances guardrail enforced per mesh (see guardrails config)

## Routing to Existing Instance

Omit parallel: true, keep mesh-id:

\`\`\`markdown
---
to: dev-lite/worker
from: core/core
mesh-id: auth-module
msg-id: task-456
headline: Add tests for auth
timestamp: 2026-01-01T00:00:00.000Z
---

Add unit tests.
\`\`\`

## Completion

Parallel instances are tracked in SQLite (parallel_instances table).
When a completion agent sends task-complete with mesh-id, the instance
is marked completed. Routing to a completed instance returns an error.
`,

  routing: `# Message Routing

## Routing Modes

Meshes use one of two routing modes:

1. **agent** (default) — routing table in config.yaml maps agent outcomes to next agents
2. **dispatcher** — coordinator agent decides routing dynamically

## Agent Routing (config.yaml)

\`\`\`yaml
routing:
  analyst:
    complete:
      writer: "Analysis done"
    needs-more-data:
      sourcer: "Need more sources"
  writer:
    complete:
      core/core: "Report finished"
\`\`\`

## Outcomes (status field)

Workers set \`status\` in their response frontmatter:
- complete — task finished, route to next agent
- error — task failed
- blocked — needs human intervention
- Custom statuses defined in routing config

## Completion Agents

Agents whose routing includes core/core as a target are completion agents.
When a completion agent sends task-complete to core/core:
1. Parity gate checks for unanswered ask-human messages
2. If clear → mesh marked complete, state cleaned up
3. If pending asks → completion blocked until resolved

## FSM Meshes

Meshes with fsm: config use file-based state machine routing.
FSM gates validate conditions before state transitions.
Intermediate agent completions are suppressed from core.
`,

  workflows: `# Common Workflows

## 1. Send a Task to a Mesh

Write a markdown file to .ai/tx/msgs/:

\`\`\`markdown
---
to: dev-lite/worker
from: core/core
msg-id: task-{Date.now()}
headline: Build the feature
timestamp: {new Date().toISOString()}
---

Description of work to do.
\`\`\`

IMPORTANT: Use the Write tool, not Edit. File writes trigger the consumer.
Edits do NOT trigger the file watcher.

## 2. Send and Auto-Receive Response

Add inject-response: true to have the result pushed back into your session:

\`\`\`yaml
inject-response: true
\`\`\`

Without this, you must poll tx inbox or wait for tx-context hook notifications.

## 3. Interrupt a Running Mesh

Edit the ORIGINAL task message file with a revision field:

\`\`\`yaml
revision: interrupt   # Hot-inject into active worker (default)
revision: append      # Add to context without discarding
revision: replace     # Discard previous work, start fresh
\`\`\`

## 4. Stop/Kill a Mesh

\`\`\`bash
tx mesh kill <mesh>            # Kill all workers in mesh
tx mesh kill <mesh> <agent>    # Kill specific agent
\`\`\`

Workers receive SIGUSR2 and gracefully exit. Sessions are preserved.

## 5. Check What's Running

\`\`\`bash
tx mesh list                   # Overview of all meshes
tx mesh status <mesh>          # Detailed view of specific mesh
tx status --json               # Full system status as JSON
\`\`\`

## 6. Answer a Stuck ask-human

When a worker asks for human input and nobody responds:

\`\`\`bash
tx mesh status <mesh>          # Find the msg-id of the pending ask
tx mesh resolve <msg-id> "Your answer here"
\`\`\`

## 7. Clear and Restart a Mesh

\`\`\`bash
tx mesh clear <mesh>           # Wipe all state (sessions, asks, FSM)
\`\`\`

Then send a new task message to restart from scratch.

## 8. Route a Slash Command

When user says /know:build or similar, write a task with command frontmatter:

\`\`\`yaml
command: /know:build
\`\`\`

The worker prepends the command to the user prompt.

## 9. Send to a Worktree Mesh

Add feature field (kebab-case):

\`\`\`yaml
feature: user-authentication
\`\`\`

Worker runs in isolated git worktree at .ai/worktrees/{feature}/.

## 10. Spawn Parallel Work

Send multiple tasks to the same mesh with different mesh-ids:

\`\`\`yaml
parallel: true
mesh-id: task-a
\`\`\`

Each instance runs independently. See: tx agent-help parallel
`,

  debugging: `# Debugging & Troubleshooting

NOTE: tx logs and tx spy are interactive/real-time — agents CANNOT use them.
Read the files directly instead.

## Key Files (read these directly)

### Logs
- .ai/tx/logs/v4.jsonl           Current session logs (JSONL, one JSON object per line)
- .ai/tx/logs/v4.1.jsonl         Previous session logs (rotated)
- .ai/tx/logs/activity.jsonl     Activity stream (message routing, spawns, completions)

Each log line is JSON with: timestamp, level, component, message, metadata.
Grep for "error" or a mesh name to find relevant entries.

### Messages
- .ai/tx/msgs/                   All message files (markdown with frontmatter)

Read message files directly to see what was sent/received.
Filename format: {timestamp}-{type}-{from}--{to}-{msg-id}.md

### System State
- .ai/tx/data/status.json        Current system status snapshot
- .ai/tx/data/workers.json       Active worker processes
- .ai/tx/data/halted.json        Halted mesh info (why it stopped)
- .ai/tx/data/runtime.json       Runtime configuration
- .ai/tx/data/queue.db           SQLite message queue (sessions, asks, mesh_runs)

### Mesh Configs
- meshes/{mesh}/config.yaml      Mesh configuration (agents, routing, FSM)
- meshes/{mesh}/{agent}/prompt.md Agent prompt files

## CLI Commands Agents CAN Use

\`\`\`bash
tx status --json               # Full system status as JSON
tx mesh list                   # All meshes with status columns
tx mesh status <mesh>          # Detailed: FSM state, workers, pending asks
tx mesh status <mesh> --json   # Machine-readable full status
tx forensics <mesh>            # Analyze recent session (routing failures, stale state)
tx forensics <mesh> --json     # Machine-readable forensics
tx session <mesh> list         # List recent sessions
tx session <mesh> get 1        # Most recent session transcript
tx session <mesh> get 1 --summary   # Condensed summary (~200 tokens)
tx session <mesh> search "query"    # Search session content
tx inbox                       # Unread messages for core
\`\`\`

## Common Issues

### Mesh stuck — no progress
1. tx mesh status <mesh> → check for pending asks or halted state
2. Read .ai/tx/data/halted.json for halt reason
3. If pending asks → tx mesh resolve <msg-id> "response"
4. If halted → tx mesh unstick <mesh>
5. If spinning → tx mesh kill <mesh>

### Message not being picked up
1. Check file is in .ai/tx/msgs/ with .md extension
2. Verify frontmatter has required fields (to, from, msg-id, headline, timestamp)
3. Grep .ai/tx/logs/v4.jsonl for the filename to find parse errors
4. Ensure consumer is running: tx status --json

### Worker spawns then immediately dies
1. Grep .ai/tx/logs/v4.jsonl for the agent name → find errors
2. tx forensics <mesh> → look at last session analysis
3. tx session <mesh> get 1 --summary → see what happened
4. Common causes: invalid prompt path, missing model config, permission error

### FSM stuck in wrong state
1. tx mesh status <mesh> → see current FSM state and gate conditions
2. tx mesh fsm-chain <mesh> → see full transition chain
3. tx mesh fsm-goto <mesh> <state> → force to correct state
4. tx mesh fsm-reset <mesh> → reset to initial state

### Queue backed up
1. tx mesh status <mesh> → check QUEUED column
2. tx mesh drain <mesh> → mark all pending as delivered (use with caution)

### Parallel instance issues
1. tx mesh list → check for instance meshes
2. Verify mesh-id is present when parallel: true
3. Cannot route to completed instances — spawn a new one
`,

  operator: `# Operator Tools

Commands for fixing stuck meshes:

## Diagnostics

  tx mesh list                    All meshes with status
  tx mesh status <mesh>           Detailed view: FSM, workers, pending asks
  tx mesh status <mesh> --next    Machine-readable next dispatch
  tx mesh status <mesh> --json    Full JSON with gate status
  tx mesh cost <mesh>             Per-agent cost/token summary
  tx mesh flow <mesh>             Agent execution timeline
  tx mesh ideal <mesh>            Ideal execution stages from config

## Intervention

  tx mesh kill <mesh> [agent]     Kill workers (all or specific agent)
  tx mesh clear <mesh>            Clear all SQLite state for mesh
  tx mesh unstick <mesh>          Clear halt state only (keep FSM)
  tx mesh resolve <msg-id> "msg"  Answer a stuck ask-human message
  tx mesh drain <mesh>            Mark all pending messages as delivered

## FSM Control

  tx mesh fsm-chain <mesh>        Show state transition chain
  tx mesh fsm-reset <mesh>        Reset FSM to initial state
  tx mesh fsm-goto <mesh> <state> Force FSM to specific state

## Session Management

  tx mesh dump <mesh>             Chronological dump of all events

## When to Use

- ask-human piling up → tx mesh resolve <msg-id> "response"
- Agent stuck/spinning → tx mesh kill <mesh>
- FSM in wrong state → tx mesh fsm-goto <mesh> <state>
- Need fresh start → tx mesh clear <mesh>
- Queue jammed → tx mesh drain <mesh>
- Need full picture → tx mesh dump <mesh>
`,

  recovery: `# Recovery & Session Resumption

## Recovery Mechanisms Overview

TX has layered recovery: session continuation (automatic), DLQ (failure capture),
checkpoint rewind (FSM meshes), and crash recovery (startup restore).

## 1. Session Continuation (Automatic)

Within a single mesh run, agents resume their conversation from the last turn.
No action needed — the dispatcher loads the previous session ID automatically.

Config (mesh config.yaml):
\`\`\`yaml
continuation: true          # Default: all agents resume sessions within a run
continuation: [analyst]     # Only these agents get session reuse
continuation: false         # Fresh session every dispatch
\`\`\`

## 2. Session Persistence (Cross-Run)

Sessions survive across mesh runs (restarts). Disabled by default.

\`\`\`yaml
persistence: true           # All agents keep sessions across runs
persistence: [oracle]       # Only these agents persist
\`\`\`

## 3. Resume a Specific Session

Force dispatch to a known session ID via frontmatter:

\`\`\`markdown
---
to: dev/worker
from: core/core
session-id: sess_abc123
msg-id: resume-{timestamp}
headline: Continue from previous session
timestamp: {ISO-8601}
---

Pick up where you left off.
\`\`\`

## 4. Dead Letter Queue (DLQ)

Failed work is captured with session context for later recovery.

### Diagnose
\`\`\`bash
tx mesh health <mesh>       # SLI rate, circuit breakers, safe mode level
tx mesh dlq <mesh>          # Failed entries: agent, category, recovery mode
\`\`\`

### Recovery Modes (auto-determined)
| Mode | When | Effect |
|------|------|--------|
| session_resume | Session ID captured | Resume conversation from crash point |
| requeue | No session available | Re-inject original message as fresh dispatch |
| manual | Retries exhausted | Requires human decision |

### Trigger Recovery
Write a message with \`recover: true\`:

\`\`\`markdown
---
to: <mesh>/<entry-point>
from: core/core
recover: true
msg-id: recover-{timestamp}
headline: Recover failed work
timestamp: {ISO-8601}
---

Recover from DLQ.
\`\`\`

### Clear Recovered Entries
\`\`\`bash
tx mesh dlq clear           # GC entries marked recovered
tx mesh clear <mesh>        # Full state reset (nuclear option)
\`\`\`

## 5. Checkpoint Rewind (FSM Meshes)

Every FSM state transition saves a checkpoint (state name → session ID).
Rewind replays from a previous state's session instead of the crash point.

### View Checkpoints
\`\`\`bash
tx mesh status <mesh>       # Shows FSM state + available checkpoints
\`\`\`

### Trigger Rewind
Add \`rewind-to\` alongside \`recover\`:

\`\`\`markdown
---
to: <mesh>/<entry-point>
from: core/core
recover: true
rewind-to: build
msg-id: recover-{timestamp}
headline: Rewind to build checkpoint
timestamp: {ISO-8601}
---

Verify step failed. Rewind to after build completed.
\`\`\`

CLI equivalent:
\`\`\`bash
tx mesh recover <mesh> --rewind-to=build
\`\`\`

## 6. Crash Recovery (Automatic on Startup)

On restart, the dispatcher:
1. Restores suspended sessions from SQLite
2. Resumes sessions where responses arrived before the crash
3. Recovers pending DLQ entries

No action needed — this happens automatically.

## 7. Circuit Breaker Recovery

When an agent fails repeatedly, the circuit breaker blocks new spawns.

\`\`\`bash
tx mesh health <mesh>       # Check breaker state (closed/open/half-open)
\`\`\`

Circuit breakers auto-recover after cooldown (default: 30s). Half-open state
allows one test request through. On success → closed. On failure → re-open.

## 8. Safe Mode Escalation

Failure rate triggers automatic safe mode levels:

| Level | Trigger | Effect |
|-------|---------|--------|
| normal | Default | Full autonomy |
| cautious | Failure rate rising | Extra logging |
| restricted | Sustained failures | Limited tool access via PreToolUse hooks |
| lockdown | Critical failure rate | All spawns blocked |

\`\`\`bash
tx mesh health <mesh>       # Shows current safe mode level
\`\`\`

Safe mode never auto-de-escalates. Requires human approval to step down.

## 9. Ask-Human Suspension & Resume

When an agent writes to core/core without \`status: complete\`, the session suspends.
The agent's session is preserved in SQLite. When the human responds, the dispatcher
resumes the exact session with the response injected.

\`\`\`bash
tx mesh status <mesh>       # Shows pending ask-human messages
tx mesh resolve <msg-id> "response"   # Resume the suspended session
\`\`\`

## Recovery Decision Tree

1. Agent stuck/no output → Check heartbeat status → \`tx mesh kill\` if dead
2. Agent failed/error → Check DLQ → \`recover: true\` message or \`--rewind-to\`
3. Agent asking for input → Check pending asks → \`tx mesh resolve\`
4. Circuit breaker open → Wait for cooldown or \`tx mesh clear\`
5. Safe mode lockdown → \`tx mesh health\`, present to user, get approval to de-escalate
6. FSM wrong state → \`tx mesh fsm-goto <mesh> <state>\`
7. Complete reset needed → \`tx mesh clear <mesh>\` + send new task
`,

};
const ALL_TOPICS_ORDER = ['messages', 'parallel', 'routing', 'workflows', 'recovery', 'debugging', 'operator'];

export function agentHelp(topic?: string): void {
  if (topic && TOPICS[topic]) {
    console.log(TOPICS[topic]);
    return;
  }

  if (topic && !TOPICS[topic]) {
    console.error(`Unknown topic: "${topic}". Available: ${ALL_TOPICS_ORDER.join(', ')}`);
    process.exit(1);
  }

  // No topic — show all
  console.log('# TX Agent Help\n');
  console.log(`Available topics: ${ALL_TOPICS_ORDER.join(', ')}\n`);
  console.log('Usage: tx agent-help [topic]\n');

  for (const t of ALL_TOPICS_ORDER) {
    console.log(TOPICS[t]);
    console.log('---\n');
  }
}

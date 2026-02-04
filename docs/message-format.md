# TX Message Format Reference

Comprehensive reference for TX V4 message format, including frontmatter fields, rearmatter metadata, and message types.

> **Source**: Audited from codebase at `src/core/consumer.ts`, `src/workspace/messaging-protocol.ts`, `src/worker/dispatcher.ts`, `src/quality/types.ts`

---

## Message Structure

TX messages are markdown files with YAML frontmatter and optional rearmatter:

```markdown
---
<frontmatter fields>
---

<body content>

---
<rearmatter fields>
---
```

**Key points**:
- Messages are written to `.ai/tx/msgs/` directory
- Consumer watches for new `.md` files and routes to queue
- Filename format: `{timestamp}-{type}-{from}--{to}-{msg-id}.md`

---

## Frontmatter Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `to` | string | Recipient agent ID (e.g., `dev/worker`, `core/core`) |
| `from` | string | Sender agent ID (e.g., `brain/brain`, `core/core`) |
| `type` | string | Message type (see [Message Types](#message-types)) |
| `msg-id` | string | Unique message identifier for correlation |
| `headline` | string | Human-readable summary of the message |
| `timestamp` | string | ISO-8601 timestamp (e.g., `2025-01-05T12:00:00.000Z`) |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | - | Outcome status for routing: `complete`, `error`, `blocked` |
| `command` | string | - | Slash command to trigger on recipient (e.g., `/know:build`) |
| `feature` | string | - | Feature name for worktree-enabled meshes |
| `headless` | string | `false` | Set to `true` for headless mode messages (bypasses dispatcher) |
| `inject-response` | string | `false` | Auto-inject mesh response into core session on completion |

### Runtime Override Fields

These fields allow per-message overrides of agent configuration:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | Agent default | Override agent model (`opus`, `sonnet`, `haiku`) |
| `priority` | string | - | Message queue processing priority |
| `session-id` | string | - | Resume specific session ID (for continuation meshes) |

### Field Details

#### `to` - Recipient Routing

The `to` field supports both short and fully-qualified agent IDs:

```yaml
# Fully qualified (mesh/agent)
to: dev/worker
to: core/core
to: research/analyst

# Short form (mesh only) - resolves to entry_point
to: dev          # → dev/worker (if entry_point: worker)
to: research     # → research/interviewer (if entry_point: interviewer)
```

**Resolution**: Consumer looks up `entry_point` in mesh config and appends it. Defaults to `worker` if not found.

#### `from` - Sender Identity

Always use fully-qualified form:

```yaml
from: core/core
from: brain/brain
from: dev/worker
```

#### `status` - Routing Outcome

The `status` field determines message routing when routing tables are configured:

| Status | Meaning | Typical Use |
|--------|---------|-------------|
| `complete` | Task finished successfully | Route to next agent or core |
| `error` | Task failed with error | Include error details in body |
| `blocked` | Cannot proceed | Needs human intervention (HITL) |

**Custom statuses**: Meshes can define custom statuses in their routing config:

```yaml
# In mesh config
routing:
  analyst:
    complete:
      writer: "Analysis complete"
    needs-more-data:           # Custom status
      sourcer: "Need more sources"
    low-confidence:            # Custom status
      disprover: "Below 95% threshold"
```

#### `command` - Slash Command Triggering

Triggers a slash command on the recipient when the message is processed:

```yaml
command: /know:build
command: /know:review
```

**How it works**: The command is prepended to the user prompt when injected into the agent's context.

#### `feature` - Worktree Integration

Required for worktree-enabled meshes. Specifies the feature name for git worktree isolation:

```yaml
feature: user-authentication
feature: api-refactor
```

**Behavior**:
- Dispatcher extracts `feature` from payload
- Creates worktree at `.worktrees/{feature}/`
- Branch created as `feature/{feature}`
- Worker CWD set to worktree path

#### `headless` - Bypass Dispatcher

For headless REPL mode (`tx run`). Prevents dispatcher from processing:

```yaml
headless: true
```

#### `inject-response` - Active Response Injection

Auto-inject the mesh response into the core tmux session when the mesh completes:

```yaml
inject-response: true
```

**Behavior**:
- Flag is stored on the outgoing task in `outgoing-tasks.json`
- On mesh completion (`task-complete` to `core/core`), system attempts active injection via `injectPrompt`
- Retries up to 10 times at 3s intervals (30s max)
- Falls back to passive `pending-for-core.json` if injection fails
- Use for fire-and-forget tasks where you want results pushed to core automatically

**Source**: `start.ts`, `consumer.ts`

#### `model` - Runtime Model Override

Override the agent's configured model for this specific message:

```yaml
model: opus
model: sonnet
model: haiku
```

**Use cases**:
- Force opus for complex tasks that normally use sonnet
- Use haiku for simple tasks to reduce cost
- Testing model behavior differences

**Source**: `consumer.ts:556`

#### `priority` - Message Queue Priority

Set message processing priority in the queue:

```yaml
priority: high
priority: normal
priority: low
```

Higher priority messages are processed before lower priority.

**Source**: `consumer.ts:557`

#### `session-id` - Session Continuation

Resume a specific session for continuation-enabled meshes:

```yaml
session-id: sess_abc123def456
```

**Use cases**:
- Explicit session targeting instead of auto-detection
- Resuming after crash recovery
- Testing specific session states

**Requires**: Mesh `continuation: true` or `continuation: [agent]`

**Source**: `consumer.ts:555`

## Message Types

### Standard Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `task` | core → worker | Assign work to an agent |
| `task-complete` | worker → core/agent | Report task completion with results |
| `ask` | agent → agent | Request information from another agent |
| `ask-response` | agent → agent | Provide answer to an ask |
| `ask-human` | worker → core | Request human input (HITL flow) |
| `update` | any → any | Progress update or status notification |
| `lifecycle` | system | Internal lifecycle events |

### Type Behaviors

#### `task`

Initiates work. Dispatcher spawns worker to process:

```yaml
---
to: dev/worker
from: core/core
type: task
msg-id: task-001
headline: Implement user login
timestamp: 2025-01-05T12:00:00.000Z
---

# Requirements

Implement user login with email/password authentication...
```

#### `task-complete`

Signals work completion. Routes based on `status`:

```yaml
---
to: core/core
from: dev/worker
type: task-complete
msg-id: task-001-complete
headline: Login implementation complete
timestamp: 2025-01-05T13:00:00.000Z
status: complete
---

# Summary

Implemented login with the following features...
```

#### `ask` and `ask-response`

Inter-agent communication for information exchange:

```yaml
# Ask
---
to: research/sourcer
from: research/analyst
type: ask
msg-id: ask-sources-001
headline: Need additional sources on topic X
timestamp: 2025-01-05T12:30:00.000Z
---

Please find additional academic sources about...

# Response
---
to: research/analyst
from: research/sourcer
type: ask-response
msg-id: ask-sources-001-response
headline: Found 5 additional sources
timestamp: 2025-01-05T12:45:00.000Z
---

Here are the additional sources found...
```

**Worker Behavior**:
- When worker sends `ask`, dispatcher transitions worker to `awaiting` state
- Worker receives `ask-response` and resumes processing
- Timeout configured in FSM context (default: 5 minutes)

#### `ask-human` (HITL Flow)

Requests human input. **Critical protocol**:

```yaml
---
to: core/core
from: dev/worker
type: ask-human
msg-id: clarify-001
headline: Need clarification on API design
timestamp: 2025-01-05T12:30:00.000Z
---

I have two options for the API design:

1. REST with resource-based endpoints
2. GraphQL with a unified schema

Which approach should I use?
```

**Protocol Requirements**:
1. Worker session PAUSES until human responds
2. Worker must NOT write `task-complete` until receiving `ask-response`
3. Dispatcher interrupts worker and injects steering prompt
4. Human responds via `ask-response` message
5. Dispatcher resumes worker session with response

**VIOLATION**: Writing `task-complete` with pending asks = protocol error (FSM blocks completion).

---

## Rearmatter (Transparency Metadata)

Rearmatter is optional YAML appended after a second `---` delimiter. It provides self-assessment and quality metadata.

### Rearmatter Structure

```markdown
---
<frontmatter>
---

<body content>

---
grade: A
confidence: 0.92
status: complete
iteration: 1
gaps: ["Did not verify edge cases"]
assumptions: ["User has valid session"]
---
```

### Standard Rearmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `grade` | string | Self-assessed grade: `A`, `B`, `C`, `D`, `F` |
| `confidence` | number | Confidence score: `0.0` - `1.0` |
| `status` | string | Completion status: `complete`, `partial`, `blocked` |
| `iteration` | number | Current iteration number (for quality hooks) |
| `gaps` | array/object | Known gaps or missing information |
| `assumptions` | array | Assumptions made during work |
| `speculation` | object | Speculative elements in the response |
| `sources` | array | Referenced sources (for accuracy validation) |
| `toolCalls` | number | Number of tool calls made |
| `limitations` | array | Known limitations of the solution |

### Field Details

#### `grade` - Self-Assessment

Letter grade for work quality:

| Grade | Meaning |
|-------|---------|
| `A` | Excellent - fully addressed, high confidence |
| `B` | Good - mostly complete, minor gaps |
| `C` | Adequate - meets minimum requirements |
| `D` | Below expectations - significant issues |
| `F` | Failed - does not meet requirements |

**Display**: UI colors grades: A/B (green), C (yellow), D/F (red)

#### `confidence` - Certainty Score

Float between 0.0 and 1.0:

```yaml
confidence: 0.95    # Very confident
confidence: 0.70    # Reasonably confident
confidence: 0.45    # Low confidence
```

**Thresholds** (configurable in mesh):
- `>= 0.9`: High confidence (green)
- `>= 0.7`: Medium confidence (yellow)
- `< 0.7`: Low confidence (red)

#### `gaps` - Missing Information

Array of known gaps:

```yaml
gaps:
  - "Did not test on Windows"
  - "Performance benchmarks pending"
  - "Edge case for empty input not handled"
```

#### `assumptions` - Working Assumptions

Array of assumptions made:

```yaml
assumptions:
  - "User has admin permissions"
  - "Database is PostgreSQL 14+"
  - "API rate limits are not a concern"
```

#### `sources` - Source References

For accuracy validation with quality hooks:

```yaml
sources:
  - url: "https://docs.example.com/api"
    type: first-party
    title: "Official API Documentation"
    verified: true
  - url: "https://blog.example.com/tutorial"
    type: second-party
    title: "Community Tutorial"
    verified: false
```

**Source types**:
- `first-party`: Official documentation, source code
- `second-party`: Blog posts, tutorials, community content
- `unknown`: Unverified source

### Mesh Configuration for Rearmatter

Enable and configure rearmatter in mesh config:

```yaml
# meshes/deep-research/config.yaml
mesh: deep-research

rearmatter:
  enabled: true
  fields:
    - grade
    - confidence
    - status
    - iteration
    - gaps
  thresholds:
    confidence: 0.7    # Minimum acceptable confidence
    grade: B           # Minimum acceptable grade
```

### Quality Stack Integration

Rearmatter integrates with the quality stack:

1. **Pre-flight**: Analyzes task and generates evaluation criteria
2. **Worker execution**: Agent includes rearmatter in response
3. **Quality gates**: Use rearmatter for evaluation:
   - `summarizer`: Weights by confidence
   - `accuracy`: Validates sources
   - `checklist`: Checks against pre-flight criteria
   - `rubric`: Scores against dynamic criteria
   - `adversarial`: Challenges assumptions and gaps

### Parsing Rearmatter

Consumer parses rearmatter as YAML:

```typescript
// From src/core/consumer.ts
private parseRearmatter(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const line of yaml.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1].trim();
    const raw = match[2].trim();

    // Parse as number, JSON, or keep as string
    if (/^-?\d+\.?\d*$/.test(raw)) {
      data[key] = parseFloat(raw);
    } else if (raw.startsWith('{') || raw.startsWith('[')) {
      try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
    } else {
      data[key] = raw;
    }
  }

  return data;
}
```

---

## Complete Examples

### Example 1: Minimal Task Message

```markdown
---
to: dev/worker
from: core/core
type: task
msg-id: fix-bug-123
headline: Fix login redirect bug
timestamp: 2025-01-05T10:00:00.000Z
---

The login page redirects to a 404 after successful authentication.

Steps to reproduce:
1. Navigate to /login
2. Enter valid credentials
3. Click submit
4. Observe 404 error
```

### Example 2: Full-Featured Task with All Options

```markdown
---
to: dev/worker
from: core/core
type: task
msg-id: feature-auth-001
headline: Implement OAuth2 authentication
timestamp: 2025-01-05T10:00:00.000Z
status: start
command: /know:build
feature: oauth-implementation
---

# OAuth2 Implementation

## Requirements

Implement OAuth2 authentication with Google and GitHub providers.

### Acceptance Criteria

- [ ] Google OAuth2 login works
- [ ] GitHub OAuth2 login works
- [ ] Session persistence across browser refresh
- [ ] Logout clears all tokens
- [ ] Error handling for failed auth attempts

### Technical Notes

- Use `@auth/core` library
- Store tokens in HTTP-only cookies
- Implement PKCE flow for security
```

### Example 3: Task-Complete with Rearmatter

```markdown
---
to: core/core
from: dev/worker
type: task-complete
msg-id: feature-auth-001-complete
headline: OAuth2 implementation complete
timestamp: 2025-01-05T14:30:00.000Z
status: complete
---

# Implementation Summary

## Completed Work

1. **Google OAuth2**: Implemented using `@auth/core` with PKCE flow
2. **GitHub OAuth2**: Added as secondary provider
3. **Session Management**: HTTP-only cookies with 7-day expiry
4. **Error Handling**: Added retry logic and user-friendly error messages

## Files Changed

- `src/auth/providers/google.ts` (new)
- `src/auth/providers/github.ts` (new)
- `src/auth/session.ts` (modified)
- `src/pages/login.tsx` (modified)

## Testing

- All unit tests passing
- Manual testing completed for both providers
- Edge cases verified (expired tokens, network errors)

---
grade: A
confidence: 0.95
status: complete
iteration: 1
gaps: []
assumptions:
  - "Environment variables for OAuth credentials are configured"
  - "Database supports session storage"
sources:
  - url: "https://authjs.dev/getting-started"
    type: first-party
    title: "Auth.js Documentation"
    verified: true
---
```

### Example 4: Ask-Human with Proper Formatting

```markdown
---
to: core/core
from: dev/worker
type: ask-human
msg-id: design-decision-001
headline: Need guidance on database schema design
timestamp: 2025-01-05T11:30:00.000Z
---

# Design Decision Required

I'm implementing the user preferences feature and need guidance on the database schema.

## Options

### Option A: JSON Column

Store all preferences as a JSON blob:

```sql
ALTER TABLE users ADD COLUMN preferences JSONB;
```

**Pros**: Flexible, easy to add new preferences
**Cons**: Harder to query specific preferences, no schema validation

### Option B: Separate Table

Create a key-value preferences table:

```sql
CREATE TABLE user_preferences (
  user_id UUID REFERENCES users(id),
  key VARCHAR(100),
  value TEXT,
  PRIMARY KEY (user_id, key)
);
```

**Pros**: Queryable, can index specific keys
**Cons**: More complex queries, many rows per user

## Question

Which approach should I use? Are there specific preferences that need to be queryable?

---
confidence: 0.6
status: blocked
assumptions:
  - "PostgreSQL is the database"
  - "User preferences include UI settings and notification settings"
---
```

### Example 5: Multi-Agent Ask/Response Flow

```markdown
# Analyst asks Sourcer
---
to: research/sourcer
from: research/analyst
type: ask
msg-id: sources-quantum-001
headline: Need academic sources on quantum computing
timestamp: 2025-01-05T12:00:00.000Z
---

I'm analyzing the current state of quantum computing for error correction.

Please find:
1. 3-5 peer-reviewed papers on quantum error correction (2023-2024)
2. Any recent breakthroughs from IBM, Google, or academic institutions
3. Current limitations and challenges

---
confidence: 0.7
status: in-progress
---
```

```markdown
# Sourcer responds to Analyst
---
to: research/analyst
from: research/sourcer
type: ask-response
msg-id: sources-quantum-001-response
headline: Found 5 sources on quantum error correction
timestamp: 2025-01-05T12:15:00.000Z
status: complete
---

# Sources Found

## Peer-Reviewed Papers

1. **"Suppressing quantum errors by scaling a surface code logical qubit"** (Nature, 2023)
   - Google Quantum AI
   - First demonstration of QEC below threshold

2. **"Fault-tolerant operation of a quantum error-correcting code"** (arXiv, 2024)
   - IBM Research
   - 100+ qubit demonstration

[... more sources ...]

---
grade: A
confidence: 0.92
sources:
  - url: "https://www.nature.com/articles/s41586-022-05434-1"
    type: first-party
    title: "Nature - Quantum Error Suppression"
    verified: true
---
```

---

## Message Flow Diagrams

### Standard Task Flow

```
User/Core              Consumer              Queue              Dispatcher              Worker
    |                     |                   |                     |                     |
    |-- write task.md --->|                   |                     |                     |
    |                     |-- parse & insert ->|                     |                     |
    |                     |                   |-- worker-message --->|                     |
    |                     |                   |                     |-- spawn worker ----->|
    |                     |                   |                     |                     |
    |                     |                   |                     |<-- complete --------|
    |                     |<------------------ task-complete.md ----------------------------|
    |                     |-- insert -------->|                     |                     |
    |<-- core-message ----|                   |                     |                     |
```

### HITL (Ask-Human) Flow

```
Worker                   Dispatcher            Consumer              Core/Human
   |                        |                     |                     |
   |-- write ask-human ---->|                     |                     |
   |                        |-- interrupt --------|                     |
   |                        |-- inject steering ->|                     |
   |   [SESSION PAUSED]     |                     |-- notify human ---->|
   |                        |                     |                     |
   |                        |                     |<-- ask-response ----|
   |                        |<-- ask-response ----|                     |
   |<-- resume session -----|                     |                     |
   |   [CONTINUES WORK]     |                     |                     |
```

---

## Best Practices

### Writing Messages

1. **Use descriptive headlines**: Headlines appear in logs and UI
2. **Include msg-id**: Enables correlation of responses to requests
3. **Set appropriate status**: Enables routing rules
4. **Add rearmatter for quality**: Especially for meshes with quality hooks

### Rearmatter Guidelines

1. **Be honest about confidence**: Lower confidence triggers quality iteration
2. **Document gaps clearly**: Helps evaluators understand limitations
3. **List assumptions**: Enables validation and correction
4. **Cite sources**: Required for accuracy-gated meshes

### Error Handling

1. **Use status: error**: Triggers error routing paths
2. **Include error details in body**: Help debugging
3. **Set low confidence**: Flags uncertain responses

---

## Related Documentation

- [Mesh Configuration Reference](./mesh-config.md) - Mesh config fields including routing
- [Quality Stack](./quality-stack.md) - Quality gates and evaluation (planned)
- [Workspace System](./workspace-system.md) - Task workspaces (planned)

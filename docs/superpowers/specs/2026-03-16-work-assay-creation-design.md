# Work Assay Creation

Three-stage post-completion pipeline: rearmatter (agent self-report) → summarizer (independent audit) → assay (structured artifact).

## Pipeline

```
agent writes completion message with rearmatter after third ---
  → consumer detects file
  → consumer parses message: frontmatter | body | rearmatter (three --- sections)
  → parses rearmatter section as YAML
  → saves to .ai/tx/assay/[mesh]/[agent]/[msg-id]-rearmatter.yaml
  → replaces rearmatter section with reference pointer in body
  → if agent has summarizer assigned:
      → spawns summarizer (sync, with timeout)
      → inputs: intent + rearmatter + session transcript
      → summarizer analyzes inputs, produces full assay YAML
      → saved to .ai/tx/assay/[mesh]/[agent]/[msg-id]-assay.yaml
      → assay pointer appended to body
  → inserts to queue (confidence in payload for routing)
  → emits event
```

Delivery is **synchronous**: the message waits for the summarizer to complete (or timeout) before being queued. The human always receives message + assay together.

## 1. Rearmatter

Structured self-report written by agents at the end of their messages. Injected as a post-completion instruction — after the agent signals work is done, not during work. Keeps the working context clean.

### Config

Boolean flag at agent level in mesh config.yaml.

```yaml
agents:
  architect:
    rearmatter: true
```

### Message Format

Rearmatter uses the existing `---` delimiter convention. A message with rearmatter has three sections:

```markdown
---
to: core/core
from: mesh/architect
type: task-complete
msg-id: abc123
---

Here's what I built. The auth module now supports OAuth2...

---

understanding: Implement OAuth2 support for the auth module
strategy: Read existing auth code, extend token handler, write tests
actions: Added OAuth2 provider, updated token validation, wrote tests
result: Done. Refresh token expiry path untested.
grade: { confidence: 0.82, limiting_factors: [refresh token expiry untested] }
changes: [src/auth/oauth2-provider.ts (new), src/auth/token-handler.ts (modified)]
uncertainties: [token refresh timing under load]
next_steps: [test refresh token expiry, add rate limiting]
```

### Rearmatter Fields

The rearmatter is a lean self-report. Seven core fields:

| Field | Type | Description |
|-------|------|-------------|
| `understanding` | string | Agent's restatement of the ask |
| `strategy` | string | How the agent decided what to do (method, not results) |
| `actions` | string | What the agent actually did |
| `result` | string | Honest self-assessment: done, partial, stuck, confused, diverged |
| `grade` | object | `confidence` (0-1) + `limiting_factors` (string[]) |
| `changes` | string[] | Files and state changes |
| `uncertainties` | string[] | Things noticed as shaky |
| `next_steps` | string[] | What to do if work continued |

The prompt instructs agents to include all fields. The system tolerates missing fields as defense-in-depth — validation logs which fields are present/absent but never rejects. This is not a contradiction: the prompt sets the expectation, the system handles reality.

### Extraction

The consumer already splits messages on `---` delimiters. The existing `parseRearmatter` method is upgraded to handle full YAML (nested objects, arrays, multiline scalars) instead of flat key-value pairs.

```typescript
interface ExtractionResult {
  body: string;          // narrative with rearmatter replaced by reference pointer
  rearmatter: Record<string, unknown> | null;  // parsed YAML, null if missing/malformed
  raw: string;           // original text preserved for summarizer trace
}
```

- No third section: `rearmatter: null`, body unchanged, no file written.
- Third section present but malformed YAML: log info, save raw text, `rearmatter: null`.
- Parsed successfully: save YAML file, replace third section with pointer, add confidence to payload.

### After Extraction

### Delivery Rules

Rearmatter and assay are always saved to files. How they appear in the message depends on the destination:

**User-facing messages** (`to: core/core`): rearmatter and assay are included inline in the message body. The human sees everything together — narrative + self-report + audit.

```markdown
---
to: core/core
from: mesh/architect
type: task-complete
msg-id: abc123
---

Here's what I built. The auth module now supports OAuth2...

---

understanding: Implement OAuth2 support for the auth module
strategy: Read existing auth code, extend token handler, write tests
actions: Added OAuth2 provider, updated token validation, wrote tests
result: Done. Refresh token expiry path untested.
grade: { confidence: 0.82, limiting_factors: [refresh token expiry untested] }
changes: [src/auth/oauth2-provider.ts (new), src/auth/token-handler.ts (modified)]
uncertainties: [token refresh timing under load]
next_steps: [test refresh token expiry, add rate limiting]

---

verdict: partial
narrative: OAuth2 provider added and working. Agent accurately reported its work but...
[full assay inline]
```

**Internal messages** (agent-to-agent): rearmatter and assay are replaced with reference links. Keeps inter-agent messages clean — agents don't need to wade through another agent's self-assessment.

```markdown
---
to: mesh/reviewer
from: mesh/architect
type: task-complete
msg-id: abc123
---

Here's what I built. The auth module now supports OAuth2...

[rearmatter: .ai/tx/assay/research/architect/abc123-rearmatter.yaml]
[assay: .ai/tx/assay/research/architect/abc123-assay.yaml]
```

Both cases save the same YAML files to `.ai/tx/assay/`. The difference is presentation only.

## 2. Summarizers

Named post-completion workers defined at mesh level. Assigned to agents by name with optional per-agent overrides.

### Config

```yaml
summarizers:
  assay-gen:
    prompt: summarizer/assay.md
    model: haiku
    destination: core/core
    inputs:
      intent: true
      rearmatter: true
      trace: true

  handoff-brief:
    prompt: summarizer/handoff.md
    model: haiku
    destination: next

agents:
  architect:
    rearmatter: true
    summarizer: assay-gen

  researcher:
    rearmatter: true
    summarizer: assay-gen
    summarizerOptions:
      destination: architect

  coder:
    rearmatter: true
    # no summarizer — rearmatter only
```

### Summarizer Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | yes | Path to summarizer prompt file (relative to mesh dir) |
| `model` | string | no | Model override, defaults to mesh model |
| `destination` | string | no | Where to deliver output. `core/core`, agent name, or `next` (next agent in routing chain). Defaults to `core/core` |
| `inputs` | object | no | Which inputs to feed. All default true |
| `inputs.intent` | boolean | no | Include frozen original message |
| `inputs.rearmatter` | boolean | no | Include extracted rearmatter |
| `inputs.trace` | boolean | no | Include session transcript |

### Resolution Chain

`agent.summarizerOptions` deep-merges over `summarizers.[name]` defaults. Agent-level wins per-field, including nested fields. For example, `summarizerOptions: { inputs: { trace: false } }` merges into the summarizer's `inputs` — it does not replace the entire `inputs` object.

Agents cannot override `prompt` via `summarizerOptions`. To use a different prompt, define a new summarizer.

### Summarizer Lifecycle

1. Consumer extracts rearmatter from agent's completion message.
2. Consumer checks `agent.summarizer` config.
3. If assigned, resolves summarizer definition (merge with `summarizerOptions`).
4. Spawns summarizer as a system worker using the SDK runner directly (not via dispatcher). System workers do not count against mesh guardrails (max_messages, max_turns).
5. Summarizer runs in fresh context with no session history.
6. Inputs assembled from configured sources:
   - **Intent**: `.ai/tx/assay/[mesh]/intent.md` (frozen when mesh starts — written by consumer on first message to mesh entry_point agent)
   - **Rearmatter**: just-extracted `.ai/tx/assay/[mesh]/[agent]/[msg-id]-rearmatter.yaml`
   - **Trace**: session transcript from `.ai/tx/session/` for the completing agent's session
   - **Previous assay**: (retries only) prior assay file if one exists
7. Summarizer receives the 7 rearmatter fields as agent testimony and produces the full assay — it **creates** the analytical fields (verdict, strategy assessment, discrepancies, delta, residue, speculations, narrative, etc.) from its own cross-check of intent vs rearmatter vs trace.
8. Summarizer outputs YAML. Saved to `.ai/tx/assay/[mesh]/[agent]/[msg-id]-assay.yaml`.
9. Reference pointer appended to message body.
10. Delivery proceeds. On summarizer failure (spawn error, timeout, malformed output): log, deliver message without assay.

### Timeout

Summarizer has a configurable timeout (default: 60s). If the summarizer does not complete within the timeout, delivery proceeds without an assay. The timeout is per-summarizer:

```yaml
summarizers:
  assay-gen:
    prompt: summarizer/assay.md
    model: haiku
    timeout: 60  # seconds
```

## 3. Assay

Structured audit artifact produced by the summarizer. The summarizer creates the full assay from the lean rearmatter inputs — the analytical depth (discrepancies, strategy assessment, speculations, narrative) is the summarizer's contribution, not the agent's.

### Schema

Canonical type definition: `.ai/input/assay-schema.ts`

Key fields:

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `version` | string | system | Schema version (`0.1.0`) |
| `assay_id` | string | system | Unique ID |
| `provenance` | object | system | mesh_id, session_id, platform, model |
| `iteration` | object | system | attempt number, previous_assay_id, delta |
| `intent` | string | frozen | Original message verbatim |
| `verdict` | enum | **summarizer** | `done`, `partial`, `failed`, `diverged` |
| `grade` | object | **summarizer** | Summarizer's confidence in its own assessment (0-1) |
| `strategy` | object | **summarizer** | Claimed vs observed strategy, alignment, appropriateness |
| `delta` | object | **summarizer** | Files changed, mutations, state_changes (from trace) |
| `residue` | object | **summarizer** | open_questions, unresolved_problems, deferred_work |
| `discrepancies` | array | **summarizer** | Where rearmatter and trace disagree |
| `gaps` | array | **summarizer** | What's missing from the work |
| `opportunities` | array | **summarizer** | Doors that opened |
| `assumptions` | array | **summarizer** | What was taken as given, blast radius |
| `dependencies` | array | **summarizer** | What work relies on, verified vs assumed |
| `risks` | array | **summarizer** | Exposure created, severity, affected scope |
| `artifacts` | array | **summarizer** | Pointers to what was produced |
| `cost` | object | system | tokens, tool_calls, elapsed_seconds, turns (from session metadata) |
| `speculations` | array | **summarizer** | Where summarizer is inferring, not observing |
| `narrative` | string | **summarizer** | One-paragraph human-readable story |

The "Source" column clarifies responsibility. System fields are populated automatically. Summarizer fields are the analytical output — the summarizer's value-add over raw rearmatter.

### Storage

```
.ai/tx/assay/
  [mesh-name]/
    intent.md                                    # frozen on first message to entry_point
    [agent-name]/
      [msg-id]-rearmatter.yaml                   # extracted self-report (7 fields)
      [msg-id]-assay.yaml                        # summarizer output (full analysis)
```

### Intent Freezing

The intent file is written by the consumer when the first message to a mesh's `entry_point` agent is processed. It captures the original human ask verbatim. Once written, it is never overwritten. For mesh instances with unique IDs, the path includes the instance ID.

## 4. Routing Integration

Extracted confidence score from rearmatter added to queue payload:

```typescript
interface MessagePayload {
  // ...existing fields
  confidence?: number;  // from rearmatter grade.confidence (agent's self-assessed confidence)
}
```

This is the **agent's** confidence in its own work (from rearmatter), not the summarizer's confidence in its assessment (from assay). The agent's confidence is available immediately at extraction time and is the right signal for routing decisions (retry on low confidence, escalate to stronger model, etc.).

The dispatcher reads `payload.confidence` for routing without opening files. Assay fields (verdict, discrepancies) remain file-based for deeper inspection.

## 5. Failure Handling

Every stage: log, deliver anyway. Summarizer is sync with timeout — the only case where delivery is delayed.

| Stage | Failure | Behavior |
|-------|---------|----------|
| Extraction | No third `---` section | Deliver message as-is, no rearmatter |
| Extraction | Malformed YAML | Save raw text, deliver without parsed data |
| Validation | Missing fields | Log which fields absent, continue |
| Summarizer | Spawn fails | Log, deliver message without assay |
| Summarizer | Output malformed | Save raw output, log warning, deliver without assay |
| Summarizer | Timeout | Log, deliver message without assay |

## 6. Config Validation

The mesh validator checks:

| Rule | Error |
|------|-------|
| `agent.summarizer` references name not in `summarizers:` | Invalid summarizer reference |
| Summarizer `prompt` file does not exist | Missing summarizer prompt |
| `agent.summarizer` set but `agent.rearmatter` is false | Warning: summarizer without rearmatter input |
| `summarizerOptions` contains `prompt` | Error: use a new summarizer definition instead |

## 7. Architectural Boundaries

- **Prompt builder** and **post-completion injection** are separate systems. Prompt builder runs before agent work. Rearmatter injection happens after the agent signals done.
- **Consumer** owns extraction and summarizer orchestration. Extraction and optional summarizer run between file read and queue insert.
- **Summarizers** are system workers spawned via SDK runner directly. They do not participate in the agent graph, routing, or mesh guardrails.
- **Message frontmatter** stays clean — AI meta lives in extracted rearmatter, not message headers.
- **Rearmatter** uses the existing `---` delimiter (third section), not fenced code blocks.
- **Delivery is synchronous** — message waits for summarizer (with timeout) so human always receives message + assay together.

## Confidence Semantics

Two different confidence values exist in this system:

| Value | Source | Meaning | Available at |
|-------|--------|---------|-------------|
| `rearmatter.grade.confidence` | Agent | Agent's confidence in its own work | Extraction time (queue payload) |
| `assay.grade.confidence` | Summarizer | Summarizer's confidence in its ability to assess | After summarizer completes (file) |

`MessagePayload.confidence` carries the agent's value for immediate routing. The summarizer's confidence is in the assay file for human review.

## Input Specs

- `.ai/input/rearmatter-spec.md` — rearmatter block format and field rules
- `.ai/input/summarizer-prompt.md` — default assay summarizer prompt
- `.ai/input/assay-schema.ts` — Assay TypeScript type definitions

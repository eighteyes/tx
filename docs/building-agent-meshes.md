# Building Agent Meshes

Quick reference for creating multi-agent workflows.

---

## Quick Start

```bash
# 1. Create directories
mkdir -p meshes/agents/my-mesh/{agent-1,agent-2}

# 2. Write agent prompts
# meshes/agents/my-mesh/agent-1/prompt.md
# meshes/agents/my-mesh/agent-2/prompt.md

# 3. Create config
# meshes/mesh-configs/my-mesh.json

# 4. Test
tx spawn my-mesh --init "test task"
```

---

## Config File Structure

**Location**: `meshes/mesh-configs/{mesh-name}.json` (NOT `meshes/{mesh-name}.json`!)

```json
{
  "mesh": "my-mesh",
  "type": "ephemeral",
  "description": "What this mesh does",
  "agents": [
    "my-mesh/agent-1",
    "my-mesh/agent-2",
    "my-mesh/agent-3"
  ],
  "type": "sequential",
  "entry_point": "agent-1",
  "completion_agent": "agent-3"
}
```

**Critical Rules:**
- Config must be in `meshes/mesh-configs/` directory
- `agents` is array of strings: `["mesh/agent-id"]`, NOT objects
- Agent metadata goes in prompts, not config

---

## Agent Prompt Template

**Location**: `meshes/agents/{mesh}/{agent}/prompt.md`

```markdown
# My Mesh - Agent Name

## Your Role
What this agent does.

## Workflow
1. Receive task from X
2. Process
3. Send to Y using `send-next Y`

## Deliverables
Save to: `.ai/tx/mesh/my-mesh/shared/output/`

## Completion
Use `send-next agent-name` or `respond` when done.
```

---

## Workflow Patterns

### Sequential (A → B → C)
```json
{
  "agents": ["mesh/a", "mesh/b", "mesh/c"],
  "type": "sequential",
  "entry_point": "a",
  "completion_agent": "c"
}
```

### Map-Reduce (A → [B,C,D] → E)
```json
{
  "agents": ["mesh/coordinator", "mesh/worker-1", "mesh/worker-2", "mesh/synthesizer"],
  "type": "map-reduce",
  "entry_point": "coordinator",
  "completion_agent": "synthesizer"
}
```

Coordinator broadcasts to workers, synthesizer combines results.

### Iterative (A → B → check → B or C)
```json
{
  "agents": ["mesh/generator", "mesh/critic", "mesh/improver", "mesh/finalizer"],
  "type": "iterative",
  "entry_point": "generator",
  "completion_agent": "finalizer"
}
```

Loop until quality threshold met.

### Conditional (A → B|C|D)
```json
{
  "agents": ["mesh/router", "mesh/simple", "mesh/complex", "mesh/research"],
  "type": "conditional",
  "entry_point": "router"
}
```

Router picks path based on task type.

### Quality Gate (A → [B,C,D] → E → Validator → Core)
```json
{
  "agents": [
    "mesh/coordinator",
    "mesh/worker-1",
    "mesh/worker-2",
    "mesh/synthesizer",
    "mesh/validator"
  ],
  "type": "map-reduce",
  "entry_point": "coordinator",
  "completion_agent": "validator"
}
```

**Purpose**: Prevent spec violations by validating deliverables before delivery to core.

**How it works**:
1. Coordinator extracts requirements from task and sends to parallel workers
2. Synthesizer combines results, sends to validator with original requirements
3. **Validator checks deliverable against requirements**:
   - ✅ All requirements met → approve and `respond` to core with `task-status: resolved`
   - ❌ Any requirement violated → reject and `send-next synthesizer` with specific issues
4. Synthesizer rebuilds if rejected

**Critical Note**: `completion_agent` is **documentation only**, NOT enforced by the system. Completion is detected by:
- Any agent using `respond` to send message to core
- Message includes `task-status: resolved` frontmatter

The validator pattern works via **convention** (agent prompts define the workflow), not system enforcement. The synthesizer can bypass the validator if it doesn't follow its prompt instructions.

**Example**: See `meshes/mesh-configs/interactive-prototyper.json` - uses validator to reject Canvas when SVG is required.

---

## Agent Templates

### Requirements Validator Agent

**Purpose**: Final quality gate to verify deliverables meet original requirements.

**Location**: `meshes/agents/{mesh}/requirements-validator/prompt.md`

```markdown
# {Mesh Name} - Requirements Validator

## Your Role

**Critical Gate**: Verify the deliverable meets ALL original requirements before delivery to core.

You are the final quality gate. Your job is to REJECT outputs that don't meet specs, even if they're technically excellent.

## Workflow

1. **Receive** deliverable and original requirements from previous agent
2. **Extract requirements** from original task
3. **Validate deliverable** against each requirement
4. **Decision**:
   - If ALL requirements met → approve and `respond` to core
   - If ANY requirement violated → reject and send back with specific issues

## Validation Checklist

For each requirement in the original task:

### Technical Requirements
- [ ] **Rendering technology** - SVG vs Canvas vs other (MUST match spec)
- [ ] **Framework constraints** - "no frameworks" vs "whatever works" (enforce if specified)
- [ ] **Performance targets** - Validate FPS, load time if specified
- [ ] **File structure** - Single file vs multiple (enforce if specified)

### Feature Requirements
- [ ] **Core features** - All specified features implemented?
- [ ] **UI controls** - All requested controls present?
- [ ] **Behaviors** - All specified behaviors work?

## Critical Rule: Exact Match Required

**If the user says "SVG animation", you MUST reject Canvas implementations.**

Even if:
- ✅ Performance is excellent
- ✅ Features are complete
- ✅ Code is beautiful
- ❌ **But it uses Canvas instead of SVG**

Result: **REJECT**

## Message Formats

### To Core (Approval)
```markdown
---
from: {mesh}/requirements-validator
to: core
type: task-complete
task-status: resolved
validation: approved
---

# Requirements Validation: APPROVED ✅

## Validation Summary
All requirements met. Deliverable approved for delivery.

## Requirements Checklist
[Full checklist with all ✅]

## Deliverables
[Location of files]
\```

### To Previous Agent (Rejection)
\```markdown
---
from: {mesh}/requirements-validator
to: {mesh}/{previous-agent}
type: validation-failure
task-status: rejected
---

# Requirements Validation: REJECTED ❌

## Failed Requirements

### Critical Failures
1. **{Requirement Name}** - ❌ FAIL
   - Required: {what was required}
   - Delivered: {what was delivered}
   - Evidence: {file:line reference}
   - Fix: {specific correction needed}

## Original Requirements
[Paste original task requirements]

## Action Required
Please rebuild addressing the failed requirements above.
\```

## Important Notes

- **User requirements are absolute** - Don't second-guess
- **Performance is NOT an excuse** - If user wants SVG, deliver SVG even if slow
- **Be specific** - Point to exact line numbers, file names for violations
```

**Example**: See `meshes/agents/interactive-prototyper/requirements-validator/prompt.md`

---

## Common Pitfalls

### ❌ Wrong Config Location
```
meshes/my-mesh.json  ← WRONG
```
### ✅ Correct
```
meshes/mesh-configs/my-mesh.json
```

### ❌ Wrong Agent Format
```json
"agents": [{"id": "coordinator", "capabilities": ["ask"]}]
```
### ✅ Correct
```json
"agents": ["my-mesh/coordinator", "my-mesh/worker"]
```

### ❌ Hyphen in UID
If task contains single chars (like "-"), UID may break.
**Fix**: Already patched in `lib/utils/uid-generator.js`

---

## Debugging

```bash
# Check status
tx status

# View logs
tail -f .ai/tx/logs/error.jsonl

# Check agent inbox
ls .ai/tx/mesh/{mesh}/agents/{agent}/msgs/inbox/

# Attach to agent
tmux attach -t {mesh}-{agent}
```

**Symptom**: Only "default" agent spawns
**Cause**: Config in wrong location or wrong format

---

## Complete Example

**File structure**:
```
meshes/
├── mesh-configs/
│   └── researcher.json
└── agents/
    └── researcher/
        ├── searcher/
        │   └── prompt.md
        └── reporter/
            └── prompt.md
```

**Config** (`meshes/mesh-configs/researcher.json`):
```json
{
  "mesh": "researcher",
  "type": "ephemeral",
  "agents": ["researcher/searcher", "researcher/reporter"],
  "type": "sequential",
  "entry_point": "searcher",
  "completion_agent": "reporter"
}
```

**Searcher prompt**:
```markdown
# Researcher - Searcher

## Your Role
Search web for information.

## Workflow
1. Receive query
2. Execute searches
3. Send results via `send-next reporter`
```

**Reporter prompt**:
```markdown
# Researcher - Reporter

## Your Role
Compile findings into report.

## Workflow
1. Receive results from searcher
2. Write report
3. Send to core via `respond`
```

**Test**:
```bash
tx spawn researcher --init "Research quantum computing"
```

---

## Reference

**Mesh types**: `ephemeral` (task-specific), `persistent` (long-running)

**Topologies**: `sequential`, `map-reduce`, `iterative`, `conditional`

**Agent communication**:
- `send-next agent-name` - Forward to next agent
- `respond` - Send to core
- `ask agent-name "question"` - Query another agent

**Key locations**:
- Config: `meshes/mesh-configs/{mesh}.json`
- Prompts: `meshes/agents/{mesh}/{agent}/prompt.md`
- Workspace: `.ai/tx/mesh/{mesh}/agents/{agent}/`
- Logs: `.ai/tx/logs/error.jsonl`

**Checklist**:
- [ ] Config in `meshes/mesh-configs/`
- [ ] Agents as string array
- [ ] Agent prompts written
- [ ] Test spawn
- [ ] Verify all agents start (not just "default")

---

See `meshes/mesh-configs/interactive-prototyper.json` for map-reduce example.

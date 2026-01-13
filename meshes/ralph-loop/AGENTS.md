# Ralph-Loop - Operational Guide

This guide documents how the ralph agent operates in the ralph-loop mesh with dual modes (plan vs build).

## Overview

The mesh implements a **single-agent, dual-mode workflow** with deterministic FSM state transitions:

```
Task Input (with request_mode)
    ↓
[Mode Router]
    ↓
request_mode == "plan"  →  [Plan Loop] → PLAN_COMPLETE
request_mode == "build" →  [Build Loop] → BUILD_COMPLETE
```

The agent uses different prompts based on mode, controlled by the FSM.

---

## Mode Detection

The FSM routes based on `request_mode` in message frontmatter:

```yaml
---
to: ralph-loop/ralph
from: core/core
type: task
msg-id: task-123
request_mode: plan          # or "build"
headline: Create plan for feature X
---
```

Default: `plan` (if request_mode missing or invalid)

---

## Plan Mode - Gap Analysis & Planning

**Prompt**: `ralph/plan.md`
**Iterations**: 1-10 (max)
**Role**: Study codebase, identify gaps, create/update IMPLEMENTATION_PLAN.md

### Mandate

- Study specs/ with parallel Task subagents (up to 100)
- Don't assume not implemented - search first
- Compare specs against current code
- Create prioritized task list with dependencies
- Write structured IMPLEMENTATION_PLAN.md

### Phase Structure

| Phase | Action |
|-------|--------|
| 0a | Study specs/ - spawn Task subagents for parallel analysis |
| 0b | Study existing IMPLEMENTATION_PLAN.md (if exists) |
| 0c | Study src/lib shared utilities |
| 0d | Reference workspace paths |
| 1 | Gap analysis - compare specs to code |
| 2 | Prioritize tasks - Ultrathink synthesis |
| 3 | Update IMPLEMENTATION_PLAN.md |
| 4 | Signal completion |
| 999+ | Guardrails in ascending priority |

### Decision Tree

```
Is gap analysis complete?
  NO → REFINE (spawn more subagents)
  YES: Is IMPLEMENTATION_PLAN.md comprehensive?
    NO → REFINE (update plan)
    YES → PLAN_COMPLETE
```

### Success Signals

- `PLAN_COMPLETE`: Plan is comprehensive, ready for build mode
- `REFINE`: More analysis or planning needed
- `BLOCKED`: Fatal error, cannot proceed

---

## Build Mode - Implementation

**Prompt**: `ralph/build.md`
**Iterations**: 1-5 (max per task)
**Role**: Pick task from plan, implement, test, commit

### Mandate

- Study IMPLEMENTATION_PLAN.md
- Pick highest priority pending task
- Don't assume not implemented - search first
- Implement following existing patterns
- Use ONE Task subagent for build/tests (backpressure)
- Commit on success, update plan with discoveries

### Phase Structure

| Phase | Action |
|-------|--------|
| 0a | Study specs/ for current task |
| 0b | Study IMPLEMENTATION_PLAN.md - pick task |
| 0c | Study src/lib patterns |
| 0d | Reference workspace paths |
| 1 | Investigate - search, understand patterns |
| 2 | Implement - multiple Task subagents OK |
| 3 | Validate - ONE Task for build/tests |
| 4 | Commit & Update - git, plan, AGENTS.md |
| 999+ | Guardrails in ascending priority |

### Decision Tree

```
Is task implementation complete?
  NO → REFINE (continue implementing)
  YES: Did tests pass?
    NO → REFINE (fix and retest)
    YES: Committed and updated plan?
      NO → commit → BUILD_COMPLETE
      YES → BUILD_COMPLETE
```

### Success Signals

- `BUILD_COMPLETE`: Task implemented, tested, committed
- `REFINE`: More implementation or testing needed
- `BLOCKED`: Fatal error, cannot proceed

---

## FSM State Transitions

### Mode Router
- **Entry**: Reads `request_mode` from message frontmatter
- **Exit**:
  - `request_mode == "plan"` → `plan_loop`
  - `request_mode == "build"` → `build_loop`
  - Default → `plan_loop`

### Plan Loop
- **Entry**: Increment `plan_iteration`, inject mode context
- **Agent**: ralph (with plan.md prompt)
- **Exit**:
  - `PLAN_COMPLETE` → `complete`
  - `REFINE` → `plan_loop` (iterate)
  - `BLOCKED` → `blocked_state`
  - Iteration > 10 → `blocked_state`

### Build Loop
- **Entry**: Increment `build_iteration`, inject mode context
- **Agent**: ralph (with build.md prompt)
- **Exit**:
  - `BUILD_COMPLETE` → `complete`
  - `REFINE` → `build_loop` (iterate)
  - `BLOCKED` → `blocked_state`
  - Iteration > 5 → `blocked_state`

---

## Workspace Structure

```
.ai/ralph-loop/{topic}/
  ├── specs/                      # Requirements (loaded in 0a)
  ├── IMPLEMENTATION_PLAN.md      # Plan (created/updated)
  ├── AGENTS.md                   # Operational guide
  └── src/                        # Build output
```

---

## Task Subagent Pattern

### Plan Mode (Parallel Analysis)
```
Ralph identifies codebase areas to analyze
    → Spawns up to 100 Task subagents in parallel
    → Each subagent searches/analyzes specific area
    → Ralph synthesizes findings into plan
```

### Build Mode (Backpressure)
```
Ralph implements code changes
    → Multiple Task subagents OK for file operations
    → ONLY ONE Task subagent for build/tests
    → Wait for build/test result before proceeding
```

---

## Ralph Language Patterns (Required)

| Pattern | Usage |
|---------|-------|
| "study" | Not "analyze" or "review" |
| "don't assume not implemented" | Always search codebase first |
| "using parallel subagents" | When spawning multiple Tasks |
| "up to N Task subagents" | Specify parallelism limit |
| "Ultrathink" | Request deep reasoning |
| "keep it up to date" | Maintain IMPLEMENTATION_PLAN.md |
| "resolve them or document them" | Handle ambiguities |

---

## IMPLEMENTATION_PLAN.md Format

```markdown
# Implementation Plan: {topic}

## Completed
- [x] Task description (YYYY-MM-DD, notes)

## In Progress
- [ ] Current task

## Pending (Prioritized)
1. Task A - S - no deps
2. Task B - M - depends on A
3. Task C - L - depends on B

## Blockers
- Description of blocker

## Rationale
Key decisions and reasoning
```

---

## Frontmatter Protocol

Each response includes frontmatter with success_signal:

```markdown
---
to: [next-agent or core]
from: ralph-loop/ralph
type: task-complete
msg-id: [unique-id]
headline: [brief summary]
timestamp: [ISO-8601]
status: complete
success_signal: PLAN_COMPLETE | BUILD_COMPLETE | REFINE | BLOCKED
analysis: "Self-assessment"
mode: plan | build
---

[Full work product here]
```

FSM extracts via:
```bash
echo '$rearmatter' | yq '.success_signal'
```

---

## Success Indicators

**Working Well When**:
- Plan mode produces comprehensive IMPLEMENTATION_PLAN.md in 2-4 iterations
- Build mode completes tasks in 1-3 iterations
- Task subagents used effectively (parallel for analysis, serial for build)
- FSM transitions deterministically based on signals

**Watch For**:
- Spinning in plan mode > 5 iterations → ship partial plan
- Build mode > 3 iterations on same task → may need to decompose
- Task subagent overuse → check backpressure (1 for build/tests)
- IMPLEMENTATION_PLAN.md not being updated → enforce guardrail

---

## Guardrails Summary

### Plan Mode (999+)
- 999: Don't assume not implemented
- 9999: Keep IMPLEMENTATION_PLAN.md current
- 99999: Document operational learnings in AGENTS.md only

### Build Mode (999+)
- 999: Single sources of truth
- 9999: Git tags, increment patch version
- 99999: Keep IMPLEMENTATION_PLAN.md current
- 999999: Update AGENTS.md operational only
- 9999999: Resolve unrelated bugs
- 99999999: Complete implementation, no placeholders
- 999999999: Clean completed items from plan
- 9999999999: Update specs if inconsistencies found

---

## Common Patterns

### Pattern: Plan-First Development
```
1. Send task with request_mode: plan
2. Ralph analyzes, creates IMPLEMENTATION_PLAN.md
3. Send task with request_mode: build
4. Ralph implements from plan
5. Repeat build for remaining tasks
```

### Pattern: Iterative Refinement (Plan)
```
Iteration 1: Initial gap analysis → REFINE
Iteration 2: Deeper analysis with subagents → REFINE
Iteration 3: Plan written → PLAN_COMPLETE
```

### Pattern: Build Cycle
```
Iteration 1: Implement task → REFINE (tests fail)
Iteration 2: Fix tests → BUILD_COMPLETE
```

### Anti-Pattern: Over-Planning
```
Iteration 1 → REFINE
Iteration 2 → REFINE
...
Iteration 8 → still REFINE
```
Ship partial plan, iterate in build mode.

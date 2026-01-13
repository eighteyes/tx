# Ralph-Ice-Cream-3 Agents - Operational Guide

This guide documents how the three agents operate in the ralph-ice-cream-3 mesh with dual modes (plan vs build) across three quality tiers.

## Overview

The mesh implements a **three-tier quality refinement pipeline** with **plan/build mode separation**:

```
Task Input (with request_mode)
    ↓
[Mode Router]
    ↓
┌─────────────────────────────────────────────────────┐
│ request_mode == "plan"                              │
│   [Haiku Plan] → [Sonnet Plan] → [Opus Plan]        │
│      ↓              ↓               ↓               │
│   Draft plan    Review plan    Approve plan         │
└─────────────────────────────────────────────────────┘
    OR
┌─────────────────────────────────────────────────────┐
│ request_mode == "build"                             │
│   [Haiku Build] → [Sonnet Build] → [Opus Build]     │
│      ↓               ↓                ↓             │
│   Draft code    Review code     Approve & commit    │
└─────────────────────────────────────────────────────┘
    ↓
Task Complete
```

Each tier has **plan and build prompts**, with mode-specific quality gates.

---

## Mode Detection

The FSM routes based on `request_mode` in message frontmatter:

```yaml
---
to: ralph-ice-cream-3/haiku
from: core/core
type: task
msg-id: task-123
request_mode: plan          # or "build"
headline: Create plan for feature X
---
```

Default: `plan` (if request_mode missing or invalid)

---

## Quality Gates by Mode

### Plan Mode Gates (4)

| Gate | Question |
|------|----------|
| **Completeness** | All requirements mapped to tasks? |
| **Feasibility** | Dependencies identified correctly? |
| **Clarity** | Plan understandable and actionable? |
| **Structure** | Logical flow, phases clearly defined? |

### Build Mode Gates (4)

| Gate | Question |
|------|----------|
| **Accuracy** | Code correct, tests pass? |
| **Completeness** | All plan tasks addressed? |
| **Clarity** | Code readable, well-documented? |
| **Structure** | Logical organization, follows patterns? |

---

## Tier 1: Haiku - Drafting Agent

**Model**: claude-3-5-haiku (fastest, most cost-effective)
**Iterations**: 1-5 (max)
**Prompts**: `haiku/plan.md`, `haiku/build.md`

### Plan Mode Mandate

- Study specs/ with parallel subagents if needed
- Don't assume not implemented - search first
- Create comprehensive plan draft
- Self-assess against 4 plan quality gates
- Route: PASS (ready for sonnet), REFINE (can improve), BLOCKED (fatal)

### Build Mode Mandate

- Study IMPLEMENTATION_PLAN.md - pick highest priority task
- Investigate before implementing
- Create implementation draft
- Self-assess against 4 build quality gates
- Route: PASS (ready for sonnet), REFINE (can improve), BLOCKED (fatal)

### Phase Structure (Both Modes)

| Phase | Plan Mode | Build Mode |
|-------|-----------|------------|
| 0a | Study specs/ | Study specs/ for current task |
| 0b | Study IMPLEMENTATION_PLAN.md | Study IMPLEMENTATION_PLAN.md - pick task |
| 0c | Study src/lib patterns | Study src/lib patterns |
| 0d | Reference workspace | Reference workspace |
| 1 | Gap analysis | Investigate - search, understand |
| 2 | Task synthesis (Ultrathink) | Implement - draft code |
| 3 | Draft plan | Validate - basic checks |
| 4 | Self-assess | Self-assess |
| 999+ | Guardrails | Guardrails |

### Decision Tree

```
Am I on iteration 1-3?
  YES: Can I improve this draft meaningfully?
    YES → REFINE (iterate)
    NO → PASS (move to sonnet)
  NO (iteration 4-5):
    Just PASS → let sonnet decide
```

### Key Guidelines

1. **Be honest**: Don't PASS mediocre work; don't over-refine good work
2. **Token-aware**: Markdown over JSON; be concise
3. **Complete delivery**: Response body is actual work product
4. **Know your iteration**: Early loops REFINE; late loops PASS

---

## Tier 2: Sonnet Reviewer - Quality Review Agent

**Model**: claude-3-5-sonnet (balanced cost/capability)
**Iterations**: 1-3 (max)
**Prompts**: `sonnet-reviewer/plan.md`, `sonnet-reviewer/build.md`

### Plan Mode Mandate

- Review haiku's plan draft
- Check 4 plan quality gates
- Decide: does refinement add real value?
- If refining, deliver improved plan (not just comments)
- Route: PASS (ready for opus), REFINE (can improve), BLOCKED (fatal)

### Build Mode Mandate

- Review haiku's implementation
- Check 4 build quality gates
- Decide: does refinement add real value?
- If refining, deliver improved code (not just comments)
- Route: PASS (ready for opus), REFINE (can improve), BLOCKED (fatal)

### Phase Structure (Both Modes)

| Phase | Plan Mode | Build Mode |
|-------|-----------|------------|
| 0a | Study specs/ | Study specs/ for current task |
| 0b | Study IMPLEMENTATION_PLAN.md | Study IMPLEMENTATION_PLAN.md |
| 0c | Study src/lib | Study src/lib |
| 0d | Reference workspace | Reference workspace |
| 1 | Load haiku draft | Load haiku's implementation |
| 2 | Apply quality gates | Apply quality gates |
| 3 | Review decision | Review decision |
| 4 | Signal | Signal |
| 999+ | Guardrails | Guardrails |

### Decision Tree

```
Can I add value (not just rewording/style)?
  YES: Is it worth an iteration (iteration < 3)?
    YES → REFINE (fix it)
    NO → PASS (let opus polish)
  NO → PASS (it's good enough)
```

### Key Guidelines

1. **Trust haiku**: Draft is often better than it looks
2. **Add value only**: Rewording for style ≠ improvement
3. **Max 3 iterations**: After iteration 3, PASS regardless
4. **Complete delivery**: Response is the reviewed work

---

## Tier 3: Opus Reviewer - Final Quality Gate

**Model**: claude-3-opus (most capable, most expensive)
**Iterations**: 1-2 (max)
**Prompts**: `opus-reviewer/plan.md`, `opus-reviewer/build.md`

### Plan Mode Mandate

- Make final judgment on plan quality
- If polish needed, apply once (max 1 refinement)
- Your PASS approves plan for delivery
- Write final plan to IMPLEMENTATION_PLAN.md

### Build Mode Mandate

- Make final judgment on code quality
- If polish needed, apply once (max 1 refinement)
- Your PASS approves code for delivery
- Commit, tag, update plan with completion

### Phase Structure (Both Modes)

| Phase | Plan Mode | Build Mode |
|-------|-----------|------------|
| 0a | Study specs/ | Study specs/ |
| 0b | Study IMPLEMENTATION_PLAN.md | Study IMPLEMENTATION_PLAN.md |
| 0c | Study src/lib | Study src/lib |
| 0d | Reference workspace | Reference workspace |
| 1 | Load sonnet's review | Load sonnet's review |
| 2 | Final quality check | Final quality check |
| 3 | Final decision | Final decision |
| 4 | Finalize (write plan) | Finalize (commit, tag, update) |
| 999+ | Guardrails | Guardrails |

### Decision Tree

```
Would I be satisfied with this as a customer?
  YES → PASS (ship it)
  NO: Can I fix it in one iteration?
    YES & iteration == 1 → REFINE (final polish)
    NO or iteration == 2 → PASS (ship it anyway)
```

### Key Guidelines

1. **You are the last line**: Your PASS sends to user
2. **Perfectionism is the enemy**: If work is good, ship it
3. **Max 2 iterations**: After iteration 2, PASS regardless
4. **Own the output**: Response body is final deliverable

---

## FSM State Transitions

### Mode Router
- **Entry**: Reads `request_mode` from message, resets iteration counters
- **Exit**:
  - `request_mode == "plan"` → `haiku_plan_loop`
  - `request_mode == "build"` → `haiku_build_loop`
  - Default → `haiku_plan_loop`

### Plan Mode Chain

#### Haiku Plan Loop
- **Entry**: Increment `haiku_iteration`, inject mode=plan, tier=haiku
- **Agent**: haiku (with haiku/plan.md)
- **Exit**:
  - `PASS` → `sonnet_plan_loop`
  - `REFINE` → `haiku_plan_loop`
  - `BLOCKED` → `blocked_state`
  - Iteration > 5 → `blocked_state`

#### Sonnet Plan Loop
- **Entry**: Increment `sonnet_iteration`, inject mode=plan, tier=sonnet
- **Agent**: sonnet-reviewer (with sonnet-reviewer/plan.md)
- **Exit**:
  - `PASS` → `opus_plan_loop`
  - `REFINE` → `sonnet_plan_loop`
  - `BLOCKED` → `blocked_state`
  - Iteration > 3 → `blocked_state`

#### Opus Plan Loop
- **Entry**: Increment `opus_iteration`, inject mode=plan, tier=opus
- **Agent**: opus-reviewer (with opus-reviewer/plan.md)
- **Exit**:
  - `PASS` → `complete`
  - `REFINE` → `opus_plan_loop`
  - `BLOCKED` → `blocked_state`
  - Iteration > 2 → `complete` (ship anyway)

### Build Mode Chain

#### Haiku Build Loop
- **Entry**: Increment `haiku_iteration`, inject mode=build, tier=haiku
- **Agent**: haiku (with haiku/build.md)
- **Exit**:
  - `PASS` → `sonnet_build_loop`
  - `REFINE` → `haiku_build_loop`
  - `BLOCKED` → `blocked_state`
  - Iteration > 5 → `blocked_state`

#### Sonnet Build Loop
- **Entry**: Increment `sonnet_iteration`, inject mode=build, tier=sonnet
- **Agent**: sonnet-reviewer (with sonnet-reviewer/build.md)
- **Exit**:
  - `PASS` → `opus_build_loop`
  - `REFINE` → `sonnet_build_loop`
  - `BLOCKED` → `blocked_state`
  - Iteration > 3 → `blocked_state`

#### Opus Build Loop
- **Entry**: Increment `opus_iteration`, inject mode=build, tier=opus
- **Agent**: opus-reviewer (with opus-reviewer/build.md)
- **Exit**:
  - `PASS` → `complete`
  - `REFINE` → `opus_build_loop`
  - `BLOCKED` → `blocked_state`
  - Iteration > 2 → `complete` (ship anyway)

---

## Workspace Structure

```
.ai/ralph-ice-cream-3/{topic}/
  ├── specs/                      # Requirements (loaded in 0a)
  ├── IMPLEMENTATION_PLAN.md      # Final plan (opus writes)
  ├── AGENTS.md                   # Operational guide
  ├── plan/
  │   ├── haiku-draft.md          # Haiku's plan draft
  │   ├── sonnet-review.md        # Sonnet's review
  │   └── opus-final.md           # Opus's approval
  └── build/
      ├── src/                    # Build output
      └── build-log.md            # Progress log
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

## Frontmatter Protocol

Each agent response includes frontmatter with success_signal:

```markdown
---
to: [next-agent or core]
from: ralph-ice-cream-3/[agent-name]
type: task-complete
msg-id: [unique-id]
headline: [brief summary]
timestamp: [ISO-8601]
status: complete
success_signal: PASS | REFINE | BLOCKED
analysis: "Self-assessment"
mode: plan | build
tier: haiku | sonnet | opus
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
- Haiku produces solid drafts in 1-3 iterations
- Sonnet catches real issues, not just style
- Opus applies meaningful polish or approves as-is
- Total iterations < 8 per chain
- FSM transitions deterministically

**Watch For**:
- Haiku spinning > 3 iterations → trust and PASS
- Sonnet looping > 2x → likely style, should PASS
- Opus looping > 1x → ship it, perfectionism kills
- Plan/build mode mismatch → check frontmatter

---

## Guardrails Summary

### Haiku Guardrails (999+)
- 999: Don't assume not implemented - search first
- 9999: Complete delivery - draft must be actionable
- 99999: Token-aware - concise, Markdown over JSON

### Sonnet Guardrails (999+)
- 999: Trust haiku - draft often better than it looks
- 9999: Add value only - rewording ≠ improvement
- 99999: Max 3 iterations - then PASS
- 999999: Complete delivery - response is reviewed work

### Opus Guardrails (999+)
- 999: Last line - PASS approves delivery
- 9999: Perfectionism enemy - good enough ships
- 99999: Max 2 iterations - then PASS
- 999999: Own output - commit and update plan
- 9999999: Add caveats if approving with reservations

---

## Common Patterns

### Pattern: Plan-Then-Build Workflow
```
1. Send task with request_mode: plan
   → haiku_plan → sonnet_plan → opus_plan
   → IMPLEMENTATION_PLAN.md created
2. Send task with request_mode: build
   → haiku_build → sonnet_build → opus_build
   → Code committed, plan updated
3. Repeat build for remaining tasks
```

### Pattern: Healthy Plan Iteration
```
Haiku iter 1: Draft plan → REFINE (gaps)
Haiku iter 2: Improved plan → PASS
Sonnet iter 1: Minor fixes → PASS
Opus iter 1: Approve → PASS (complete)
Total: 4 iterations
```

### Pattern: Healthy Build Iteration
```
Haiku iter 1: Draft code → PASS
Sonnet iter 1: Review, minor fix → PASS
Opus iter 1: Polish, commit → PASS (complete)
Total: 3 iterations
```

### Anti-Pattern: Infinite Spinning
```
Haiku iter 1 → REFINE
Haiku iter 2 → REFINE
Haiku iter 3 → REFINE
Haiku iter 4 → ???
```
After iteration 3, PASS and let downstream tier handle.

### Anti-Pattern: Style Polishing
```
Sonnet iter 1: Rewording haiku's draft
Sonnet iter 2: More rewording
Sonnet iter 3: Still rewording
```
Style changes ≠ value. PASS after first real improvement.

---

## Token Efficiency Tips

1. **Compress prompts**: Decision trees over narrative
2. **Reuse context**: Load workspace specs, don't re-explain
3. **Favor PASS**: Downstream tiers often improve work
4. **Complete delivery**: Response body is work (not summaries)
5. **Late loops PASS**: Don't spin at max iterations

---

## Comparison: ralph-ice-cream-2 vs ralph-ice-cream-3

| Aspect | ralph-ice-cream-2 | ralph-ice-cream-3 |
|--------|-------------------|-------------------|
| Modes | Single (combined) | Dual (plan/build) |
| Prompts | 3 (one per tier) | 6 (plan+build per tier) |
| Phase numbering | No | Yes (0a-0d, 1-4, 999+) |
| IMPLEMENTATION_PLAN.md | Optional | Required/enforced |
| Language patterns | Standard | Ralph-specific |
| FSM states | 3 loops | 6 loops (mode-aware) |
| Quality gates | Generic (4) | Mode-specific (4+4) |

---

## When to Use This Mesh

**Use ralph-ice-cream-3 when**:
- Quality-critical work with layered review needed
- Complex features requiring plan-before-build
- Cost optimization important (haiku drafts, opus gates)
- Multi-iteration refinement valuable

**Consider ralph-loop instead when**:
- Simpler tasks with single-agent sufficient
- Task spawning (parallel subagents) more important than review tiers
- Faster iteration preferred over quality gates

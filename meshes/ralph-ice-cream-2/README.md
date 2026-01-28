# Ralph-Ice-Cream-2 Agents - Operational Guide

This guide documents how the three agents in the ralph-ice-cream-2 mesh operate autonomously within the FSM.

## Overview

The mesh implements a **three-layer quality refinement pipeline** with deterministic FSM state transitions:

```
Task Input
    ↓
[Ralph Haiku] → PASS / REFINE / BLOCKED
    ↓
[Sonnet Reviewer] → PASS / REFINE / BLOCKED
    ↓
[Opus Reviewer] → PASS / REFINE / BLOCKED
    ↓
Task Complete / Error
```

Each layer has a **clear mandate**, **quality gates**, and a **decision tree** for routing.

---

## Layer 1: Ralph Haiku - Drafting Agent

**Model**: claude-3-5-haiku (fastest, most cost-effective)
**Iterations**: 1-5 (max)
**Role**: Create a solid, complete first draft addressing all task requirements.

### Mandate

- Read the incoming task completely
- Create comprehensive output (full work product, not outline)
- Use concise, direct language (token efficiency matters)
- Self-assess honesty (accuracy, completeness, clarity)
- Route decision: PASS (ready for review), REFINE (can improve), BLOCKED (fatal error)

### Decision Tree for Routing

```
Am I on iteration 1-3?
  YES: Can I improve this draft meaningfully?
    YES → REFINE (iterate)
    NO → PASS (move to sonnet)
  NO (iteration 4-5):
    Just PASS → let sonnet decide
```

### Key Guidelines

1. **Be honest**: Don't PASS mediocre work; don't over-refine perfect work
2. **Token-aware**: Prefer Markdown over JSON; be concise; skip redundancy
3. **Complete delivery**: Response body is the actual work product (not meta-commentary)
4. **Spawn subagents**: If you need heavy lifting (complex analysis, large codebase search), spawn a worker and let opus follow up
5. **Know your iteration**: FSM context shows which iteration you're on (e.g., `haiku_iteration: 2`)

### Output Signal

Write to message frontmatter:
```yaml
success_signal: PASS | REFINE | BLOCKED
analysis: "Brief self-assessment (1-2 sentences)"
```

The FSM reads `success_signal` and routes accordingly.

---

## Layer 2: Sonnet Reviewer - Quality Review Agent

**Model**: claude-3-5-sonnet (balanced cost/capability)
**Iterations**: 1-3 (max)
**Role**: Review haiku's draft and decide: pass it forward or refine it. Only add real value.

### Mandate

- Read the haiku draft completely
- Check 4 quality gates: **accuracy**, **completeness**, **clarity**, **structure**
- Decide: does refinement add value worth an iteration?
- If refining, deliver improved work (not just comments)
- Route decision: PASS (ready for opus), REFINE (improve it), BLOCKED (fatal error)

### Decision Tree for Routing

```
Can I add value (not just rewording)?
  YES: Is it worth an iteration (iteration < 3)?
    YES → REFINE (fix it)
    NO → PASS (let opus polish)
  NO → PASS (it's good enough)
```

### Quality Gates (Check All 4)

1. **Accuracy**: Are facts correct? Are sources cited? No hallucinations?
2. **Completeness**: Do all task requirements get addressed?
3. **Clarity**: Is it understandable as written? Any confusing sections?
4. **Structure**: Is the flow logical? Do sections connect well?

If all 4 gates pass → **PASS to opus**
If you can meaningfully improve 1+ gates → **REFINE**
If haiku went way off course → **REFINE to haiku** (optional; usually just PASS)

### Key Guidelines

1. **Trust haiku**: The draft is often better than it looks
2. **Add value only**: Rewriting for style alone ≠ improvement
3. **Max 3 iterations**: After iteration 3, PASS even if uncertain (FSM enforces this)
4. **Complete delivery**: Response body is the refined work or unchanged draft if passing
5. **Know your iteration**: FSM context shows which iteration you're on

### Output Signal

```yaml
success_signal: PASS | REFINE | BLOCKED
analysis: "Which gates passed/failed; why PASS or REFINE"
```

---

## Layer 3: Opus Reviewer - Final Quality Gate

**Model**: claude-3-opus (most capable, most expensive)
**Iterations**: 1-2 (max)
**Role**: Make final judgment. Is this ready for delivery? Apply final polish if needed, then ship.

### Mandate

- Read sonnet's output completely
- Make final quality judgment on deliverability
- If polish needed, make it count (max 1 refinement total)
- Route decision: PASS (approve for delivery), REFINE (final polish), BLOCKED (fatal error)
- Your PASS sends work to core/user—own that responsibility

### Decision Tree for Routing

```
Would I be satisfied with this as a customer?
  YES → PASS (ship it)
  NO: Can I fix it in one iteration?
    YES & iteration == 1 → REFINE (final polish)
    NO or iteration == 2 → PASS (ship it anyway)
```

### Final Quality Gates (Check All 4)

1. **Accuracy**: Would I stake my reputation on this? Any doubts?
2. **Completeness**: Does it fully address the original request?
3. **Clarity & Tone**: Professional, well-written, appropriate tone?
4. **Coherence**: Logical flow across all sections? Any gaps or jumps?

If all pass and you're satisfied → **PASS to core**
If you can apply meaningful final polish → **REFINE** (once, then PASS)
If at iteration 2 → **PASS regardless** (FSM enforces this)

### Key Guidelines

1. **You are the last line**: Your PASS approves delivery to the user
2. **Perfectionism is the enemy**: If work is good, ship it (don't over-refine)
3. **Max 2 iterations**: FSM enforces this; after iteration 2, you MUST PASS
4. **Own the output**: Response body is the final deliverable (not comments)
5. **Add caveats if needed**: If you approve with reservations, note them clearly in analysis

### Output Signal

```yaml
success_signal: PASS | REFINE | BLOCKED
analysis: "Final judgment; any caveats or reservations"
```

---

## FSM State Transitions

The FSM deterministically controls loop iterations and state routing based on `success_signal`:

### Ralph Haiku Loop
- **Entry**: Increment `haiku_iteration`
- **Agent**: ralph-haiku
- **Exit Condition** (reads `success_signal` from message):
  - `PASS` → Move to `sonnet_review_loop`
  - `REFINE` → Stay in `ralph_haiku_loop` (iterate)
  - `BLOCKED` → Move to `blocked_state` (error)
  - Iteration > 5 → Move to `blocked_state` (max exceeded)

### Sonnet Review Loop
- **Entry**: Increment `sonnet_iteration`
- **Agent**: sonnet-reviewer
- **Exit Condition**:
  - `PASS` → Move to `opus_review_loop`
  - `REFINE` → Stay in `sonnet_review_loop` (iterate)
  - `BLOCKED` → Move to `blocked_state` (error)
  - Iteration > 3 → Move to `blocked_state` (max exceeded)

### Opus Review Loop
- **Entry**: Increment `opus_iteration`
- **Agent**: opus-reviewer
- **Exit Condition**:
  - `PASS` → Move to `complete` (success)
  - `REFINE` → Stay in `opus_review_loop` (iterate)
  - `BLOCKED` → Move to `blocked_state` (error)
  - Iteration > 2 → Move to `complete` (max exceeded, ship anyway)

---

## Workspace Context Loading

The FSM provides deterministic context per iteration:

```yaml
# FSM injects these into agent prompts
state: ralph_haiku_loop
haiku_iteration: 2
max_haiku_iterations: 5
sonnet_iteration: 0
max_sonnet_iterations: 3
opus_iteration: 0
max_opus_iterations: 2
```

Agents should:
1. Use iteration count to guide decision-making (early loops can REFINE; late loops should PASS)
2. Load workspace context from `.ai/ralph/{topic}/` if available
3. Reference AGENTS.md from workspace if guidance is needed

---

## Subagent Pattern (Optional)

For expensive work (large codebase analysis, complex research), agents can spawn subagents:

1. **Haiku** identifies heavy-lift work → spawns worker with task description
2. **Worker** completes task → writes result to workspace
3. **Haiku** incorporates result into final work
4. **Opus** can verify subagent work during final review

This extends token budget without exceeding main agent limits.

---

## Success Indicators

✅ **Working Well When**:
- Haiku produces focused, complete drafts in 1-2 iterations
- Sonnet identifies and fixes genuine issues (not style nitpicks)
- Opus applies meaningful final polish or approves as-is
- Total iterations < 8 (rare to exceed this)
- FSM transitions happen deterministically based on signals

🚩 **Watch For**:
- Haiku spinning in 3+ iterations on same issue → consider PASS sooner
- Sonnet looping > 2x → likely just rewording, should PASS
- Opus looping > 1x → ship it, perfectionism is the enemy
- Task scope too broad → splits into multiple concerns

---

## Frontmatter Protocol (Critical)

Each agent writes a message with frontmatter containing `success_signal`:

```markdown
---
to: [next-agent]
from: ralph-ice-cream-2/[agent-name]
msg-id: [unique-id]
headline: [brief summary]
timestamp: [ISO-8601]
status: complete
success_signal: PASS | REFINE | BLOCKED
analysis: "Self-assessment text"
---

[Full work product response here]
```

The FSM extracts `success_signal` via:
```bash
echo '$rearmatter' | yq '.success_signal'
```

This drives state transitions deterministically.

---

## Common Patterns

### Pattern: Early Loop Refinement (Haiku)
```
Iteration 1: Draft incomplete → REFINE
Iteration 2: Complete but rough → REFINE
Iteration 3: Solid draft → PASS
```
✅ This is healthy iteration. REFINE when iteration < 4.

### Pattern: Late Loop Clarity (Sonnet)
```
Iteration 1: Draft is good, structure could be clearer → REFINE
Iteration 2: Minor improvements made → PASS
```
✅ One focused refinement. Don't loop again.

### Pattern: Opus Final Ship
```
Iteration 1: Work is 95% there; minor tone issue → REFINE (polish once)
Iteration 2 (forced): PASS (ship it)
```
✅ One polish, then ship. Don't hold for perfection.

### Anti-Pattern: Infinite Spinning
```
Iteration 1 → REFINE
Iteration 2 → REFINE
Iteration 3 → REFINE
Iteration 4 → ???
```
❌ This means either task is under-specified or agent lost confidence.
   After iteration 3, PASS and let downstream agent handle.

---

## Token Efficiency Tips

1. **Compress prompts**: Decision trees over narrative; bullets over paragraphs
2. **Reuse context**: Load workspace specs instead of re-explaining
3. **Delegate expensive work**: Spawn subagents for large codebase analysis
4. **Favor PASS**: Downstream agents often improve work; don't hoard iterations
5. **Complete delivery**: Response body is the work (not summaries or outlines)


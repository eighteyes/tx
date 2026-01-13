# Ralph-Ice-Cream-3 - Operational Guide

Three-tier quality refinement with plan/build mode separation. FSM reads `request_mode`, routes to plan or build chain with progressive model tiers.

## Agents

**Plan Chain**: haiku-plan → sonnet-plan → opus-plan
**Build Chain**: haiku-build → sonnet-build → opus-build

Each tier has max iterations: haiku (5), sonnet (3), opus (2)

## Mode Router

```yaml
request_mode: plan   → haiku_plan_loop → sonnet_plan_loop → opus_plan_loop
request_mode: build  → haiku_build_loop → sonnet_build_loop → opus_build_loop
```

Default: plan chain

## Tier 1: Haiku (Drafting/Building)

**Role**: Create complete implementation - ONE task per iteration, loop until ALL done
**Decision**: REFINE to continue to next task; PASS only when ALL tasks complete

**Build Mode Loop**:
- Pick ONE highest priority pending task
- Implement it fully
- More tasks remain? → **REFINE** (loop back for next task)
- ALL tasks complete? → **PASS** (to sonnet for quality review)

**Phase 0**: Check specs/ - if empty, enter Requirements Definition; if exists, study specs/IMPLEMENTATION_PLAN.md/src/lib
**Phase 1**: Requirements Definition (IF specs/ empty in plan mode) - HITL to define JTBD, break into topics, write specs/, iterate until approved
**Phase 2-4**: Mode-specific workflow (gap analysis → draft plan/code)
**Phase 5**: Self-assess and signal

**Requirements HITL** (plan mode only): If specs/ empty, asks human about project, identifies JTBD, writes specs/ files, iterates until approved

**Guardrails (999+)**: ONE task per iteration; REFINE until all done; be honest, token-aware, spawn Task subagents for heavy lifting

**Signals**: PASS → sonnet tier (ONLY when all tasks complete) | REFINE → self-loop | BLOCKED → error

## Tier 2: Sonnet (Quality Gate on Complete Work)

**Role**: Review haiku's COMPLETE implementation (all tasks finished), add value only
**Quality Gates**: Accuracy, Completeness, Clarity, Structure (across COMPLETE work)

**Key Insight**: Haiku has already completed ALL tasks. You review the ENTIRE body of work, not individual tasks.

**Decision**: Issues in complete work? → REFINE | Otherwise → PASS

**Phase 0**: Study context - understand FULL scope of what haiku built
**Phases 1-4**: Review COMPLETE implementation against 4 gates, refine if needed
**Guardrails (999+)**: You review complete work; trust haiku (often better than appears); max 3 iterations then PASS

**Signals**: PASS → opus tier (complete work approved) | REFINE → self-loop | BLOCKED → error

## Tier 3: Opus (Final Gate on Complete Feature)

**Role**: Final judgment on COMPLETE implementation, apply polish if needed (max 1 refinement)
**Decision**: Customer satisfaction test on COMPLETE feature → PASS or REFINE once

**Key Insight**: All tasks are complete, sonnet has reviewed. You make the final call on the ENTIRE feature.

**Phase 0**: Study context - understand FULL scope of complete feature
**Phases 1-4**: Final review of COMPLETE work, apply polish if needed
**Guardrails (999+)**: You review complete feature; you are the last line; perfectionism is enemy; max 2 iterations then ship

**Signals**: PASS → complete (return to core with complete feature) | REFINE → self-loop | BLOCKED → error

## Quality Gates by Mode

**Plan Mode**: Completeness, Feasibility, Clarity, Structure
**Build Mode**: Accuracy, Completeness, Clarity, Structure

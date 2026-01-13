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

## Tier 1: Haiku (Drafting)

**Role**: Create solid first draft (plan or code)
**Decision**: Early loops (1-3) can REFINE; late loops (4-5) should PASS

**Phase 0**: Check specs/ - if empty, enter Requirements Definition; if exists, study specs/IMPLEMENTATION_PLAN.md/src/lib
**Phase 1**: Requirements Definition (IF specs/ empty in plan mode) - HITL to define JTBD, break into topics, write specs/, iterate until approved
**Phase 2-4**: Mode-specific workflow (gap analysis → draft plan/code)
**Phase 5**: Self-assess and signal

**Requirements HITL** (plan mode only): If specs/ empty, asks human about project, identifies JTBD, writes specs/ files, iterates until approved

**Guardrails (999+)**: Be honest, token-aware, spawn Task subagents for heavy lifting

**Signals**: PASS → sonnet tier | REFINE → self-loop | BLOCKED → error

## Tier 2: Sonnet (Review)

**Role**: Review haiku's draft, add value only (not just rewording)
**Quality Gates**: Accuracy, Completeness, Clarity, Structure

**Decision**: Can I add value AND worth iteration? → REFINE | Otherwise → PASS

**Phase 0**: Study context
**Phases 1-4**: Review against 4 gates, refine if needed
**Guardrails (999+)**: Trust haiku (often better than appears); max 3 iterations then PASS

**Signals**: PASS → opus tier | REFINE → self-loop | BLOCKED → error

## Tier 3: Opus (Final Gate)

**Role**: Final judgment on deliverability, apply polish if needed (max 1 refinement)
**Decision**: Customer satisfaction test → PASS or REFINE once

**Phase 0**: Study context
**Phases 1-4**: Final review, apply polish if needed
**Guardrails (999+)**: You are the last line; perfectionism is enemy; max 2 iterations then ship

**Signals**: PASS → complete (return to core) | REFINE → self-loop | BLOCKED → error

## Quality Gates by Mode

**Plan Mode**: Completeness, Feasibility, Clarity, Structure
**Build Mode**: Accuracy, Completeness, Clarity, Structure

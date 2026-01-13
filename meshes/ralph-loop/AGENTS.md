# Ralph-Loop - Operational Guide

Two-agent mesh with plan/build mode separation. FSM reads `request_mode` from message frontmatter, routes to correct agent loop.

## Agents

**ralph-plan** (ralph/plan.md) - Gap analysis, create IMPLEMENTATION_PLAN.md
**ralph-build** (ralph/build.md) - Implement from plan, test, commit

## Mode Router

```yaml
request_mode: plan   → plan_loop (ralph-plan, max 10 iterations)
request_mode: build  → build_loop (ralph-build, max 5 iterations)
```

Default: plan (if request_mode missing)

## Plan Mode (ralph-plan)

**Phase 0**: Study specs/, IMPLEMENTATION_PLAN.md, src/lib (spawn up to 100 Task subagents for parallel analysis)
**Phase 1**: Gap analysis (compare specs to code, identify TODOs/placeholders)
**Phase 2**: Prioritize tasks (Ultrathink synthesis, note dependencies)
**Phase 3**: Write IMPLEMENTATION_PLAN.md (structured plan with phases, tasks, rationale)
**Phase 4**: Signal PLAN_COMPLETE or REFINE

**Guardrails (999+)**: Don't assume not implemented - search first; keep IMPLEMENTATION_PLAN.md current; document operational discoveries in AGENTS.md only

## Build Mode (ralph-build)

**Phase 0**: Study specs/, IMPLEMENTATION_PLAN.md, src/lib
**Phase 1**: Investigate (search relevant source, spawn Task subagents for exploration)
**Phase 2**: Implement (use multiple Tasks for file ops, ONLY ONE Task for build/tests - backpressure)
**Phase 3**: Validate (run tests, REFINE if fail)
**Phase 4**: Commit & update (commit with message, update IMPLEMENTATION_PLAN.md + AGENTS.md, signal BUILD_COMPLETE)

**Guardrails (999+)**: Single sources of truth; create git tags, increment patch; implement completely, avoid placeholders; resolve bugs discovered; update specs if inconsistent

## Success Signals

**PLAN_COMPLETE / BUILD_COMPLETE**: Work done → complete state → return to core
**REFINE**: Needs iteration → loop to self (check max iterations)
**BLOCKED**: Fatal error → blocked_state → error

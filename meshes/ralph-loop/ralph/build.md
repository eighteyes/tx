# Ralph - Build Mode

You implement from the plan. Your job: pick highest priority task, implement, test, commit.

## Phase 0: Orientation

**0a - Study specs/**
- Load relevant specifications from `{workspace}/specs/`
- Focus on specs for current task only

**0b - Study IMPLEMENTATION_PLAN.md**
- Load `{workspace}/IMPLEMENTATION_PLAN.md`
- **Pick ONLY ONE highest priority pending task** (singular)
- Check dependencies are satisfied
- **CRITICAL**: Implement ONLY this one task per iteration, no more

**0c - Study src/lib**
- Identify shared utilities to use
- Note existing patterns to follow

**0d - Reference workspace**
- Workspace: `.ai/ralph-loop/{topic}/`
- Source: `{workspace}/src/`
- Plan: `{workspace}/IMPLEMENTATION_PLAN.md`

## Phase 1: Investigate

Before implementing:
- Search relevant source (don't assume not implemented)
- Spawn Task subagents for codebase exploration if needed
- Understand existing patterns
- Identify integration points

## Phase 2: Implement

Implementation approach:
- Use multiple Task subagents for file operations
- Follow existing patterns in codebase
- Keep single sources of truth (no migrations/adapters)
- Complete implementation - avoid placeholders

## Phase 3: Validate

Testing approach:
- Use ONLY ONE Task subagent for build/tests (backpressure)
- If tests fail → analyze, fix, `success_signal: REFINE`
- If tests pass → proceed to Phase 4

## Phase 4: Commit & Update

**ONE TASK PER LOOP** - After completing the single task:
- Commit with descriptive message (ONE task only)
- Create git tag, increment patch version
- Update IMPLEMENTATION_PLAN.md:
  - Mark THIS TASK complete with date
  - Add discoveries/learnings

**Loop Decision**:
- More tasks remaining? → **Signal REFINE** (loop back for next task)
- ALL tasks complete? → **Signal BUILD_COMPLETE** (work done, ready for delivery)

## Decision Tree

```
Are there pending tasks in IMPLEMENTATION_PLAN.md?
  YES:
    Pick next highest priority task
    Implement it
    Did tests pass?
      NO → REFINE (fix and retest)
      YES → Commit, update plan
        → REFINE (loop back for next task)
  NO (all tasks complete):
    → BUILD_COMPLETE (all work done, ready for delivery)
```

Late iteration (4-5):
```
Am I blocked or spinning?
  YES → BUILD_COMPLETE (ship partial progress)
  NO → continue normally
```

## Output Signal (YAML Frontmatter)

```yaml
success_signal: BUILD_COMPLETE | REFINE | BLOCKED
analysis: "Task status; test results; blockers"
mode: build
```

## Guardrails (999+)

**999**: **ONE TASK PER ITERATION** - Pick one task, implement it, commit it, REFINE for next task, BUILD_COMPLETE only when ALL tasks done
**9999**: Single sources of truth - no migrations, adapters, or duplicate implementations
**99999**: Create git tags, increment patch version on successful builds
**999999**: Keep IMPLEMENTATION_PLAN.md current with discoveries
**9999999**: Update AGENTS.md with operational learnings only
**99999999**: Resolve unrelated bugs discovered during implementation
**999999999**: Implement completely - avoid placeholders and TODOs
**9999999999**: Clean completed items from plan periodically
**99999999999**: Update specs if inconsistencies found (flag for review)

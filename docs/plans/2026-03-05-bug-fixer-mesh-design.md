# Bug Fixer Mesh Design

## Overview

Batch bug fixing mesh that takes a markdown list of bugs, researches them in parallel, groups into non-conflicting batches, fixes each batch with parallel workers, and validates via Playwright.

**Target:** Next.js / React web applications with Playwright test infrastructure.

## Agent Roster

| Agent | Model | Role |
|-------|-------|------|
| triage | haiku | Parse bug list, count bugs, emit structured entries |
| researcher | sonnet | Investigate one bug: find files, root cause, assess dependencies |
| planner | sonnet | Group bugs into non-conflicting batches by file overlap |
| fixer | opus | Fix bugs in one batch, write targeted Playwright tests |
| validator | sonnet | Run Playwright suite (existing + new tests), report pass/fail |
| reporter | haiku | Summarize all results back to core |

## Flow

```
User sends bug list (markdown)
         │
    ┌────▼────┐
    │ TRIAGE  │  haiku — parse, count, structure
    └────┬────┘
         │ fan-out (dynamic ensemble, one per bug)
    ┌────▼────┬────────┬────────┐
    │ RSRCH-1 │ RSRCH-2│ RSRCH-N│  sonnet — root cause, files, deps
    └────┬────┴────┬───┴────┬───┘
         │ fan-in (batch, concat aggregation)
    ┌────▼─────────▼────────▼──┐
    │        PLANNER           │  sonnet — group into batches
    └────────────┬─────────────┘
                 │ FSM batch loop
         ┌───── ▼ ─────┐
         │  BATCH N     │
    ┌────▼────┬─────┐   │
    │ FIXER-1 │FIX-M│   │  opus — fix + write PW tests
    └────┬────┴──┬──┘   │
         │ fan-in       │
    ┌────▼───────▼──┐   │
    │  VALIDATOR    │   │  sonnet + Playwright MCP
    └───────┬───────┘   │
      PASS? ├─no──► FIXER (retry ≤3)
      yes ──┼──► next batch ──► loop
            │
    ┌───────▼───────┐
    │   REPORTER    │  haiku — final summary
    └───────────────┘
```

## Architecture: Dispatcher + FSM

- `routing_mode: dispatcher` handles fan-out/fan-in for researchers and fixers
- FSM tracks batch iteration, retry counts, and state transitions
- Dynamic ensemble for researchers (count set by triage)
- Per-batch ensemble for fixers (count set by planner per batch)

## FSM States

| State | Agents | Purpose |
|-------|--------|---------|
| triage | [triage] | Parse bugs, set bug_count |
| research | ensemble: researcher × bug_count | Parallel investigation |
| planning | [planner] | Receive research, output batch plan |
| fixing | ensemble: fixer × batch_size | Parallel fix per batch |
| validating | [validator] | Run Playwright, pass/fail |
| reporting | [reporter] | Final summary |
| complete | [core] | Terminal |

## FSM Context Variables

```yaml
context:
  bug_count: 0
  batch_index: 0
  batch_count: 0
  retry_count: 0
  max_retries: 3
```

## Key Design Decisions

1. **Dynamic researcher ensemble** — triage sets count from bug list length
2. **Planner groups by file overlap** — bugs touching same files go in same batch
3. **Fixer writes Playwright tests** — each fix includes verification test
4. **Validator has Playwright MCP** — browser-based verification
5. **Retry cap of 3** — after 3 failures, skip batch and report
6. **FSM batch loop** — counter-driven iteration over batches
7. **No lifecycle hooks** — all validation through dedicated validator agent

## Validation Strategy

- Validator runs existing Playwright test suite (regression check)
- Validator runs new tests written by fixer (fix verification)
- On failure: test output sent back to fixer with context
- On success: advance to next batch
- After max_retries: skip batch, mark bugs as unresolved

## Input Format

Markdown list in the message body:
```markdown
1. Bug title - description of the bug
2. Bug title - description of the bug
...
```

## Output

Reporter agent sends summary to core with:
- Fixed bugs (with test evidence)
- Skipped/unresolved bugs (with failure context)
- New Playwright test files created
- Batching rationale

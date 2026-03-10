# Bug Fixer Mesh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mesh that takes a bug list, researches bugs in parallel, batches them by file overlap, fixes each batch with parallel workers, and validates via Playwright.

**Architecture:** FSM-driven pipeline with dynamic ensembles for both research and fixing phases. FSM self-loop iterates over batches with retry logic. No dispatcher — FSM ensemble handles all parallelism.

**Tech Stack:** TX mesh (config.yaml + prompt files), Playwright MCP for validation, FSM for batch loop state.

---

### Task 1: Create directory structure and config.yaml

**Files:**
- Create: `meshes/bug-fixer/config.yaml`

**Step 1: Create the mesh directory**

```bash
mkdir -p meshes/bug-fixer
```

**Step 2: Write config.yaml**

```yaml
# bug-fixer/config.yaml
# Batch bug fixing with parallel research and Playwright validation
# Responsibilities:
#   - Parse bug lists into structured entries
#   - Research bugs in parallel via dynamic ensemble
#   - Group bugs into non-conflicting batches
#   - Fix each batch with parallel workers
#   - Validate fixes via Playwright
#   - Retry failed fixes, skip after max retries

mesh: bug-fixer
description: "Batch bug fixing with parallel research and Playwright validation"

agents:
  - name: triage
    model: haiku
    prompt: triage.md

  - name: researcher
    model: sonnet
    prompt: researcher.md

  - name: planner
    model: sonnet
    prompt: planner.md

  - name: fixer
    model: opus
    prompt: fixer.md

  - name: validator
    model: sonnet
    prompt: validator.md
    mcpServers:
      playwright:
        command: npx
        args: ["@playwright/mcp@latest"]

  - name: reporter
    model: haiku
    prompt: reporter.md

entry_point: triage
completion_agents: [reporter]

routing:
  triage:
    complete:
      researcher: "Bugs triaged, spawn researchers"
  researcher:
    complete:
      planner: "Research findings ready"
  planner:
    complete:
      fixer: "Batch plan ready, spawn fixers"
  fixer:
    complete:
      validator: "Fixes applied, validate"
  validator:
    complete:
      reporter: "All batches processed"
  reporter:
    complete:
      core: "Bug fixing complete"

workspace:
  path: ".ai/tx/workspaces/bug-fixer/"
  create_on_init: true
  locations:
    workspace: ".ai/tx/workspaces/bug-fixer/"

fsm:
  initial: triage

  context:
    bug_count: 0
    batch_index: 0
    batch_count: 0
    batch_size: 0
    retry_count: 0
    max_retries: 3

  states:
    triage:
      agents: [triage]
      exit:
        set:
          bug_count: "$(echo '$rearmatter' | yq '.bug_count')"
        default: research

    research:
      ensemble:
        type: parallel
        agent: researcher
        count: $bug_count
        aggregation: concat
        timeout_ms: 600000
      exit:
        set:
          research_findings: "$ENSEMBLE_OUTPUT"
        default: planning

    planning:
      agents: [planner]
      exit:
        gates:
          planner:
            - "$workspace/batch-plan.yaml"
        set:
          batch_count: "$(echo '$rearmatter' | yq '.batch_count')"
          batch_size: "$(echo '$rearmatter' | yq '.first_batch_size')"
          batch_index: 0
        default: fixing

    fixing:
      ensemble:
        type: parallel
        agent: fixer
        count: $batch_size
        aggregation: concat
        timeout_ms: 600000
      exit:
        set:
          fix_output: "$ENSEMBLE_OUTPUT"
        default: validating

    validating:
      agents: [validator]
      exit:
        when:
          - condition: success_signal == "NEXT_BATCH"
            set:
              batch_index: "$batch_index + 1"
              retry_count: 0
              batch_size: "$(echo '$rearmatter' | yq '.next_batch_size')"
            target: fixing
          - condition: success_signal == "RETRY"
            set:
              retry_count: "$retry_count + 1"
            target: fixing
          - condition: success_signal == "SKIP_BATCH"
            set:
              batch_index: "$batch_index + 1"
              retry_count: 0
              batch_size: "$(echo '$rearmatter' | yq '.next_batch_size')"
            target: fixing
          - condition: success_signal == "ALL_DONE"
            target: reporting
        default: reporting

    reporting:
      agents: [reporter]
      exit:
        default: complete

    complete:
      terminal: true

  scripts: {}

guardrails:
  strict: false
  warning: true
  agents:
    researcher:
      max_turns:
        limit: 15
        strict: true
        warning: true
    fixer:
      max_turns:
        limit: 30
        strict: true
        warning: true
    validator:
      max_turns:
        limit: 20
        strict: true
        warning: true

playbook_notes: |
  Bug-fixer combines two proven patterns:
  - Dynamic ensemble (from bug-sleuth) for parallel research and parallel fixing
  - FSM self-loop (from test-fsm-loop) for batch iteration with retry

  Flow: triage → research ensemble → planner → [fix ensemble → validate] × N batches → report

  The planner writes batch-plan.yaml to workspace. The validator reads it to determine
  next_batch_size and routing signals. Fixers use ENSEMBLE_INDEX + batch_index to pick
  their assigned bug from the plan.

  Retry logic: validator sends RETRY (up to max_retries=3), then SKIP_BATCH or ALL_DONE.
  The FSM tracks retry_count and batch_index; the validator makes the routing decision
  based on test results + FSM context values.
```

**Step 3: Verify config syntax**

Run: `yq . meshes/bug-fixer/config.yaml`
Expected: Valid YAML output, no errors.

**Step 4: Commit**

```bash
git add meshes/bug-fixer/config.yaml
git commit -m "feat(mesh): add bug-fixer config with FSM batch loop"
```

---

### Task 2: Write triage prompt

**Files:**
- Create: `meshes/bug-fixer/triage.md`

**Step 1: Write triage.md**

```markdown
# Triage Agent
# bug-fixer mesh
# Responsibilities:
#   - Parse markdown bug list into structured entries
#   - Count bugs and assess overall scope
#   - Emit structured bug entries for parallel research

## Role

You parse incoming bug lists into structured entries for parallel investigation.

## Workflow

1. **Parse the bug list** from the incoming message
   - Each bug is a numbered item in markdown
   - Extract: title, description, reproduction steps (if provided)
   - Assign each bug an ID (bug-1, bug-2, etc.)

2. **Write structured bug entries** to workspace
   - Save to `{workspace}/bugs.yaml` with all parsed bugs
   - Format:
     ```yaml
     bugs:
       - id: bug-1
         title: "Short title"
         description: "Full description"
         repro: "Steps if provided"
       - id: bug-2
         ...
     total: 3
     ```

3. **Set bug_count in rearmatter** for the FSM to spawn researchers

## Rearmatter Output

```
signal: complete
bug_count: 3
```

Replace `3` with actual bug count from the parsed list.
```

**Step 2: Verify prompt builds**

Run: `npx tsx src/cli/index.ts prompt bug-fixer triage --raw 2>/dev/null || echo "prompt cmd not available"`
Expected: Prompt content with injected protocol sections.

**Step 3: Commit**

```bash
git add meshes/bug-fixer/triage.md
git commit -m "feat(mesh): add bug-fixer triage prompt"
```

---

### Task 3: Write researcher prompt

**Files:**
- Create: `meshes/bug-fixer/researcher.md`

**Step 1: Write researcher.md**

```markdown
# Researcher Agent
# bug-fixer mesh
# Responsibilities:
#   - Investigate one bug from the bug list
#   - Find relevant source files and understand root cause
#   - Assess file dependencies for batch planning
#   - Report findings for the planner

## Role

You are a parallel research worker. Multiple researchers run simultaneously, each investigating one bug. Use your ENSEMBLE_INDEX to pick your assigned bug from `{workspace}/bugs.yaml`.

## Workflow

1. **Read your assigned bug**
   - Read `{workspace}/bugs.yaml`
   - Your bug is at index ENSEMBLE_INDEX (0-based)
   - Understand the symptoms and any reproduction steps

2. **Find relevant files**
   - Search the codebase for files related to the bug
   - Use Grep for error messages, component names, API routes
   - Use Glob for file patterns (e.g., `src/components/**/*.tsx`)
   - Document every file path that is relevant

3. **Assess root cause**
   - Read the relevant files
   - Identify the likely root cause
   - Note what needs to change and where

4. **Document file dependencies**
   - List ALL files this bug fix would touch
   - This is critical for batch planning — bugs touching the same files must be in the same batch

## Output Format

```
## Bug: [bug-id] — [title]

### Relevant Files
- `src/path/to/file.tsx:45-67` — description of relevance
- `src/path/to/other.ts:12` — description

### Root Cause
[Analysis of what's wrong and why]

### Proposed Fix
[High-level description of what to change]

### Files That Would Change
- `src/path/to/file.tsx`
- `src/path/to/other.ts`

### Complexity
[simple | moderate | complex]

### Confidence
[high | medium | low] — [reasoning]
```
```

**Step 2: Commit**

```bash
git add meshes/bug-fixer/researcher.md
git commit -m "feat(mesh): add bug-fixer researcher prompt"
```

---

### Task 4: Write planner prompt

**Files:**
- Create: `meshes/bug-fixer/planner.md`

**Step 1: Write planner.md**

```markdown
# Planner Agent
# bug-fixer mesh
# Responsibilities:
#   - Receive research findings for all bugs
#   - Group bugs into non-conflicting batches by file overlap
#   - Write batch plan to workspace for fixer and validator to consume

## Role

You receive parallel research findings and create a batch execution plan. Bugs that touch the same files go in the same batch to prevent merge conflicts.

## Workflow

1. **Parse research findings**
   - Read the incoming message containing all researcher outputs
   - Extract the "Files That Would Change" list from each bug report

2. **Build dependency graph**
   - For each bug, note which files it touches
   - Find overlaps: if bug-1 touches `src/auth.ts` and bug-3 touches `src/auth.ts`, they share a dependency

3. **Group into batches**
   - Bugs with overlapping files go in the SAME batch (sequential safety)
   - Bugs with NO overlapping files go in DIFFERENT batches (parallel safety)
   - Optimize for maximum parallelism: more smaller batches is better
   - Single-file bugs with no overlap can be grouped together in one batch

4. **Write batch plan**
   - Save to `{workspace}/batch-plan.yaml`:
     ```yaml
     batches:
       - index: 0
         bugs: [bug-1, bug-3]
         size: 2
         reason: "Both touch src/auth.ts"
       - index: 1
         bugs: [bug-2, bug-4, bug-5]
         size: 3
         reason: "No file overlap"
     total_batches: 2
     ```

5. **Set rearmatter for FSM**

## Rearmatter Output

```
signal: complete
batch_count: 2
first_batch_size: 2
```

Replace values with actual counts from your batch plan.
```

**Step 2: Commit**

```bash
git add meshes/bug-fixer/planner.md
git commit -m "feat(mesh): add bug-fixer planner prompt"
```

---

### Task 5: Write fixer prompt

**Files:**
- Create: `meshes/bug-fixer/fixer.md`

**Step 1: Write fixer.md**

```markdown
# Fixer Agent
# bug-fixer mesh
# Responsibilities:
#   - Fix one bug from the current batch
#   - Write a targeted Playwright test to verify the fix
#   - Report what was changed

## Role

You are a parallel fix worker. Multiple fixers run per batch. Use ENSEMBLE_INDEX and the current batch_index from FSM context to identify your assigned bug.

## Workflow

1. **Identify your bug**
   - Read `{workspace}/batch-plan.yaml`
   - Current batch is at `batches[batch_index]`
   - Your bug within the batch is at position ENSEMBLE_INDEX
   - Read `{workspace}/bugs.yaml` for full bug details
   - Read the research findings from earlier messages for root cause analysis

2. **Implement the fix**
   - Read the relevant source files identified by the researcher
   - Make the minimal change needed to fix the bug
   - Follow existing code style and patterns
   - Use Edit tool for surgical changes, not full file rewrites

3. **Write a Playwright test**
   - Create a test file: `tests/e2e/bug-fixes/[bug-id].spec.ts`
   - The test should:
     - Navigate to the affected page/component
     - Reproduce the original bug scenario
     - Assert the correct behavior after fix
   - Use existing test patterns from the project if available
   - Template:
     ```typescript
     import { test, expect } from '@playwright/test';

     test('[bug-id]: [title]', async ({ page }) => {
       await page.goto('/affected-route');
       // reproduce scenario
       // assert correct behavior
     });
     ```

4. **Report changes**

## Output Format

```
## Fixed: [bug-id] — [title]

### Changes Made
- `src/path/to/file.tsx:45` — description of change
- `src/path/to/file.tsx:67` — description of change

### Test Written
- `tests/e2e/bug-fixes/[bug-id].spec.ts`

### Fix Explanation
[Why this change fixes the bug]
```
```

**Step 2: Commit**

```bash
git add meshes/bug-fixer/fixer.md
git commit -m "feat(mesh): add bug-fixer fixer prompt"
```

---

### Task 6: Write validator prompt

**Files:**
- Create: `meshes/bug-fixer/validator.md`

**Step 1: Write validator.md**

```markdown
# Validator Agent
# bug-fixer mesh
# Responsibilities:
#   - Run Playwright tests (existing suite + new bug-fix tests)
#   - Determine pass/fail for current batch
#   - Route FSM: NEXT_BATCH, RETRY, SKIP_BATCH, or ALL_DONE

## Role

You validate bug fixes by running the Playwright test suite. You have access to Playwright MCP tools for browser-based verification. You also determine FSM routing based on test results and batch state.

## Workflow

1. **Run the existing Playwright test suite**
   - Execute: `npx playwright test` via Bash
   - This catches regressions introduced by the fixes
   - Capture the full output

2. **Run the new bug-fix tests**
   - Execute: `npx playwright test tests/e2e/bug-fixes/` via Bash
   - These are the targeted tests written by the fixers
   - Capture per-test pass/fail

3. **If tests fail: use Playwright MCP to investigate**
   - Navigate to the failing page
   - Take screenshots of the broken state
   - Check the accessibility tree for unexpected DOM
   - Save screenshots to `{workspace}/validation/`

4. **Determine routing signal**
   - Read `{workspace}/batch-plan.yaml` for batch info
   - Read FSM context values: `batch_index`, `batch_count`, `retry_count`, `max_retries`

   **Decision logic:**
   - All tests PASS + more batches remain → `NEXT_BATCH`
   - All tests PASS + this was the last batch → `ALL_DONE`
   - Tests FAIL + retry_count < max_retries → `RETRY`
   - Tests FAIL + retry_count >= max_retries + more batches → `SKIP_BATCH`
   - Tests FAIL + retry_count >= max_retries + last batch → `ALL_DONE`

5. **Write validation report**
   - Save to `{workspace}/validation/batch-[batch_index]-attempt-[retry_count].yaml`:
     ```yaml
     batch_index: 0
     attempt: 1
     status: pass|fail
     existing_tests: {passed: N, failed: N, total: N}
     bugfix_tests: {passed: N, failed: N, total: N}
     failures: [list of failed test names and errors]
     ```

## Rearmatter Output

```
signal: complete
success_signal: NEXT_BATCH
next_batch_size: 3
```

Set `success_signal` to one of: `NEXT_BATCH`, `RETRY`, `SKIP_BATCH`, `ALL_DONE`.
Set `next_batch_size` from the next batch in batch-plan.yaml (only needed for NEXT_BATCH and SKIP_BATCH).
```

**Step 2: Commit**

```bash
git add meshes/bug-fixer/validator.md
git commit -m "feat(mesh): add bug-fixer validator prompt with Playwright MCP"
```

---

### Task 7: Write reporter prompt

**Files:**
- Create: `meshes/bug-fixer/reporter.md`

**Step 1: Write reporter.md**

```markdown
# Reporter Agent
# bug-fixer mesh
# Responsibilities:
#   - Summarize all batch results
#   - Report fixed vs skipped bugs
#   - List new Playwright test files created

## Role

You compile the final report of the bug-fixing session.

## Workflow

1. **Read all validation reports**
   - Read files in `{workspace}/validation/`
   - Gather pass/fail status for each batch and attempt

2. **Read the batch plan**
   - Read `{workspace}/batch-plan.yaml` for bug-to-batch mapping

3. **Read the original bug list**
   - Read `{workspace}/bugs.yaml` for bug titles

4. **Compile summary**

## Output Format

```
# Bug Fixer Report

## Summary
- Total bugs: N
- Fixed: N
- Skipped (max retries): N
- Batches: N (M retried)

## Fixed Bugs
| Bug | Title | Batch | Tests |
|-----|-------|-------|-------|
| bug-1 | Title | 0 | tests/e2e/bug-fixes/bug-1.spec.ts |

## Skipped Bugs
| Bug | Title | Batch | Failure Reason |
|-----|-------|-------|----------------|
| bug-4 | Title | 2 | Test error details |

## New Test Files
- tests/e2e/bug-fixes/bug-1.spec.ts
- tests/e2e/bug-fixes/bug-2.spec.ts
...
```
```

**Step 2: Commit**

```bash
git add meshes/bug-fixer/reporter.md
git commit -m "feat(mesh): add bug-fixer reporter prompt"
```

---

### Task 8: Validate with dev_mode dry run

**Files:**
- Modify: `meshes/bug-fixer/config.yaml` (add dev_mode temporarily)

**Step 1: Add dev_mode flag**

Add `dev_mode: true` to the top of config.yaml (after description).

**Step 2: Verify all prompts build**

Run each agent prompt through the prompt builder:
```bash
for agent in triage researcher planner fixer validator reporter; do
  echo "=== $agent ==="
  npx tsx src/cli/index.ts prompt bug-fixer $agent --raw 2>&1 | head -5
done
```
Expected: Each agent shows prompt content without errors.

**Step 3: Verify config loads**

```bash
npx tsx src/cli/index.ts status 2>&1 | head -20
```

**Step 4: Remove dev_mode flag**

Remove `dev_mode: true` from config.yaml — it was only for validation.

**Step 5: Final commit**

```bash
git add meshes/bug-fixer/
git commit -m "feat(mesh): complete bug-fixer mesh with all prompts"
```

---

## File Manifest

| File | Purpose |
|------|---------|
| `meshes/bug-fixer/config.yaml` | Mesh config: agents, FSM, routing, guardrails |
| `meshes/bug-fixer/triage.md` | Parse bug list, count bugs, write bugs.yaml |
| `meshes/bug-fixer/researcher.md` | Investigate one bug, find files, assess root cause |
| `meshes/bug-fixer/planner.md` | Group bugs into non-conflicting batches |
| `meshes/bug-fixer/fixer.md` | Fix one bug + write Playwright test |
| `meshes/bug-fixer/validator.md` | Run Playwright, route FSM based on results |
| `meshes/bug-fixer/reporter.md` | Final summary of fixed/skipped bugs |

## Runtime Artifacts (created by mesh execution)

| File | Created By | Read By |
|------|-----------|---------|
| `{workspace}/bugs.yaml` | triage | researcher, fixer, reporter |
| `{workspace}/batch-plan.yaml` | planner | fixer, validator, reporter |
| `{workspace}/validation/batch-N-attempt-M.yaml` | validator | reporter |
| `tests/e2e/bug-fixes/[bug-id].spec.ts` | fixer | validator |

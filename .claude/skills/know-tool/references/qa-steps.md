# Writing QA_STEPS

QA_STEPS.md files verify a feature works from the **user's perspective**. They are not developer test verification.

## The Core Distinction

| QA_STEPS (Correct) | Developer Verification (Wrong) |
|-------------------|-------------------------------|
| `tx start` | `npm run build` |
| `tx spy` | `node --test ...` |
| `tx msg dev/worker "..."` | `grep -E "export"` |
| "Watch the evaluators run" | "19 tests pass" |
| Observable behavior | Code internals |

## What QA_STEPS Must Include

### 1. Prerequisites
What needs to be running or configured:
```markdown
## Prerequisites
- TX running (`tx start` in another terminal)
- Mesh configured with `graded: true`
```

### 2. User Actions
Commands the user actually runs:
```markdown
## Steps

### 1. Start TX and spy
```bash
# Terminal 1
tx start

# Terminal 2
tx spy
```

### 2. Send a task
```bash
tx msg dev/worker "implement fibonacci function"
```
```

### 3. Observable Expectations
What the user should SEE:
```markdown
**Expected in tx spy:**
- `[preflight] generating criteria for task...`
- `[worker:spawn] dev/worker starting...`
- `[evaluator:rubric] checking criteria... PASS`
- `[evaluator:adversarial] challenging assumptions... PASS`
- `[pipeline] final verdict: PASS`
```

### 4. Failure Scenarios
How to trigger and observe failure paths:
```markdown
### 3. Trigger a FAIL iteration
Send a deliberately incomplete task:
```bash
tx msg dev/worker "implement something"
```

**Expected:**
- `[evaluator:checklist] missing requirements... FAIL`
- `[pipeline] iteration 1/3, retrying with feedback...`
- Worker receives feedback and retries
```

## What QA_STEPS Must NOT Include

- `node --test` or `npm test` commands
- `grep` for exports or internals
- "X tests pass" as success criteria
- Implementation details
- Code snippets to verify

## The E2E Connection

Every feature with QA_STEPS should have a corresponding E2E test:

```markdown
## Automated Verification

The E2E test exercises this flow programmatically:
```bash
node --import tsx --test test/e2e/19-quality-stack.test.ts
```

This test does what the manual QA steps describe, but automated.
```

The E2E is for CI. QA_STEPS are for humans to see the feature work.

## Example: Good vs Bad

### Bad QA_STEPS (developer-focused)
```markdown
### 1. Run unit tests
node --import tsx --test test/unit/quality-gates.test.ts
**Expected:** 19 tests pass

### 2. Verify exports
grep -E "export (function|const)" src/quality-gates/*.ts
**Expected:** checkGradeGate, checkConfidenceGate...
```

### Good QA_STEPS (user-focused)
```markdown
### 1. Configure graded mesh
Edit `meshes/configs/dev.json`:
```json
{ "graded": true }
```

### 2. Watch the quality stack
```bash
tx spy
```

### 3. Send a task
```bash
tx msg dev/worker "build a login form"
```

### 4. Observe
**Expected in spy output:**
- Pre-flight generates criteria
- Worker executes task
- Evaluators run in sequence
- Final verdict displayed

If FAIL, watch the retry loop with feedback.
```

## Questions to Ask

When writing QA_STEPS, ask:

1. **Can the user SEE this?** - If not, it's not QA
2. **Does this use the actual CLI?** - tx commands, not node/npm
3. **Is this observable behavior?** - What appears on screen
4. **Would a user understand this?** - No code internals

## Checklist Format

Use checkboxes for verification, but keep them user-observable:

```markdown
## Verification Checklist
- [ ] Pre-flight criteria visible in spy output
- [ ] Worker spawn event shows in spy
- [ ] Each evaluator result displayed
- [ ] FAIL triggers visible retry
- [ ] HALT stops immediately (no more evaluators run)
- [ ] Final verdict shown
```

NOT:
```markdown
- [ ] 19 unit tests pass
- [ ] Exports exist in index.ts
```

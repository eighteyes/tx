---
name: Know: Review Feature
description: Interactive QA walkthrough for end-user acceptance testing of completed features
category: Know
tags: [know, review, qa, testing, acceptance]
---

**Main Objective**

Guide user through interactive end-user acceptance testing of a completed feature using the generated QA_STEPS.md, recording results and updating feature status based on approval.

**CRITICAL: ACTIVE TESTING WORKFLOW**
This is NOT just a code review. The assistant should:
1. **Test what can be automated**: Run CLI commands, execute scripts, check file outputs, verify logs
2. **Guide user to validate the rest**: UI behavior, visual elements, user experience, edge cases requiring judgment

**Testing Responsibilities**:
- **AI tests**: CLI output, file generation, data validation, error handling, API responses, calculations
- **User validates**: UI appearance, visual feedback, usability, subjective quality, cross-browser behavior

**Workflow**:
- For each QA step, determine if it's automatable
- If automatable: Execute the test, show results, ask user to confirm
- If not automatable: Guide user through manual validation
- Record all results (Pass/Fail/Skip) and collect failure details

**Prerequisites**
- Feature must have completed `/know:build` (status: "complete" or "review-ready")
- `.ai/know/<feature>/QA_STEPS.md` must exist
- **Application must be running and ready to test**

**Usage**

```
/know:review <feature-name>
```

**Workflow**

### 1. Initialization

**Steps**:
1. Verify feature directory exists at `.ai/know/<feature>/`
2. Check that `QA_STEPS.md` exists (if not, inform user to run `/know:build` Phase 7 first)
3. Check spec-graph status (using **haiku agent**):
   - `know -g .ai/spec-graph.json show feature:<name>`
   - Verify status is "complete", "review-ready", or "in-progress"
4. Load `QA_STEPS.md` content

### 2. Display Context and Confirm User is Ready to Test

**Steps**:
1. Show feature objective from QA_STEPS.md
2. Display prerequisites/setup requirements
3. **Explicitly remind user**: "You will need to manually test the feature in your running application. I will guide you through each test step and record your results."
4. Ask user: "Is your application running and are you ready to begin testing? [Yes/No]"
   - If No: Exit with message "Start your application and complete prerequisites first"
   - If Yes: Proceed to interactive testing

### 3. Interactive Test Execution

**For each test step in QA_STEPS.md**:

1. **Display step number, description, and expected outcome**
2. **Determine if step is automatable**:
   - CLI command? → Run it with Bash tool
   - File check? → Use Read/Glob tools
   - API call? → Execute and verify response
   - Data validation? → Run and check output
   - UI/UX/Visual? → Ask user to validate
3. **Execute or guide**:
   - **If automatable**:
     - Run the test automatically
     - Display results to user
     - Ask: "Does this output look correct to you? [Pass/Fail/Skip]"
   - **If not automatable**:
     - Instruct user: "Please test this manually in your application"
     - Ask: "Did this step work as expected? [Pass/Fail/Skip]"
4. **If "Fail"**:
   - Ask follow-up: "What happened instead? Describe the issue."
   - Record detailed failure description
5. **Track results for summary**

**Tracking format**:
```
Step 1: [PASS/FAIL/SKIP]
  Description: ...
  Expected: ...
  Actual: [if failed, user's description]
```

### 4. Acceptance Criteria Check

**After all test steps**:

1. Display acceptance criteria from QA_STEPS.md
2. For each criterion:
   - Ask: "Is this criterion met? [Yes/No]"
   - Record response
3. Calculate pass rate:
   - Passed steps / Total steps (excluding skipped)

### 5. Final Decision

**Steps**:
1. Display summary:
   - Test steps: X passed, Y failed, Z skipped
   - Acceptance criteria: A/B met
   - Overall pass rate: XX%
2. Use AskUserQuestion:
   - Question: "What is your decision on this feature?"
   - Options:
     - "Approve" - Feature meets requirements, ready for deployment
     - "Needs Work" - Issues found, requires fixes
     - "Defer" - Testing incomplete, review again later
3. Based on decision:
   - **Approve**:
     - Update spec-graph status to "done" (using **haiku agent**)
     - Offer: "Run `/know:done` to archive feature? [Yes/No]"
   - **Needs Work**:
     - Keep status as "in-progress"
     - Proceed to "Create Action Items" (section 5a)
   - **Defer**:
     - Keep current status
     - Save progress for next review session

### 5a. Create Action Items (if "Needs Work" selected)

**Steps**:
1. **Categorize each failed test step**:
   - For each failure, ask user: "How should this issue be tracked?"
     - "Bug" - Defect that needs fixing
     - "Change" - Modification to requirements or approach
     - "Enhancement" - Improvement suggestion
     - "Skip" - Don't track this one
2. **Assign severity** for each bug/change:
   - Ask: "What is the severity?"
   - Options: Critical / High / Medium / Low
3. **Create structured tracking files**:
   - Create directories if they don't exist:
     - `.ai/know/<feature>/bugs/`
     - `.ai/know/<feature>/changes/`
   - For each bug: Create `bugs/NNN-slug.md` (numbered sequentially)
   - For each change: Create `changes/NNN-slug.md`
4. **Update todo.md** with new unchecked items:
   - Add at the top of todo.md (above existing items):
     ```markdown
     ## Review Fixes (from YYYY-MM-DD review)
     - [ ] Fix Bug #001: [Description] (see bugs/001-slug.md)
     - [ ] Implement Change #001: [Description] (see changes/001-slug.md)
     ```
5. **Offer to create implementation plan**:
   - If 3+ bugs/changes, ask: "Create implementation plan for these fixes? [Yes/No]"
   - If Yes: Create `.ai/know/<feature>/plans/review-fixes-YYYYMMDD.md`

**Bug file template** (`.ai/know/<feature>/bugs/001-description.md`):
```markdown
# Bug #001: [Title from test step]

**Severity:** [Critical/High/Medium/Low]
**Status:** Open
**Found:** YYYY-MM-DD Review
**Test Step:** [Step number from QA_STEPS.md]

## Description
[From review feedback - what went wrong]

## Steps to Reproduce
[Copy from QA_STEPS.md]

## Expected Behavior
[From QA_STEPS.md expected outcome]

## Actual Behavior
[User's description of what happened]

## Related Tasks
- [ ] Fix bug #001: [Description] (in todo.md)
```

**Change file template** (`.ai/know/<feature>/changes/001-description.md`):
```markdown
# Change #001: [Title]

**Priority:** [Critical/High/Medium/Low]
**Status:** Proposed
**Identified:** YYYY-MM-DD Review
**Test Step:** [Step number that triggered this]

## Current Behavior
[What exists now]

## Proposed Change
[What should be different]

## Rationale
[Why this change is needed - from review feedback]

## Impact
- [Areas affected by this change]

## Related Tasks
- [ ] Implement change #001: [Description] (in todo.md)
```

### 6. Generate Review Artifacts

**Always create**:
- `.ai/know/<feature>/review-results.md`:
  ```markdown
  # Review Results: <Feature Name>
  Date: YYYY-MM-DD
  Reviewer: [User name if available]

  ## Summary
  - Test Steps: X passed, Y failed, Z skipped
  - Acceptance Criteria: A/B met
  - Pass Rate: XX%
  - Decision: [Approve/Needs Work/Defer]

  ## Test Step Results

  ### Step 1: [Description]
  - Status: [PASS/FAIL/SKIP]
  - Expected: ...
  - Actual: ...

  [... for each step]

  ## Acceptance Criteria

  - [x] Criterion 1
  - [ ] Criterion 2

  ## Notes
  [Any additional comments from user]
  ```

**If "Needs Work" selected**:
- `.ai/know/<feature>/review-feedback.md`:
  ```markdown
  # Review Feedback: <Feature Name>
  Date: YYYY-MM-DD

  ## Summary
  - Test Steps: X passed, Y failed
  - Bugs Created: Z
  - Changes Proposed: W

  ## Issues Found

  ### Issue 1: [From failed step]
  - Step: Step X
  - Expected: ...
  - Actual: ...
  - Tracked As: Bug #001 (see bugs/001-description.md)
  - Severity: [Critical/High/Medium/Low]

  [... for each failed step]

  ## Action Items Created

  See updated todo.md for checklist of:
  - [ ] Bug fixes (X bugs in bugs/ directory)
  - [ ] Changes (Y changes in changes/ directory)

  ## Next Steps

  1. Address bugs/changes as prioritized
  2. Update todo.md as items are completed
  3. Re-run `/know:review <feature>` after fixes
  ```
- Structured bug/change files in:
  - `.ai/know/<feature>/bugs/NNN-description.md`
  - `.ai/know/<feature>/changes/NNN-description.md`
- Updated `.ai/know/<feature>/todo.md` with new unchecked items

### 7. Update Spec-Graph

**Using haiku agent**:
- If Approved:
  - `know -g .ai/spec-graph.json update feature:<name> '{"status": "done"}'` (or similar update)
  - Add review completion date to meta if possible
- If Needs Work:
  - Keep status as "in-progress"
- If Deferred:
  - No status change

**Outputs**:
- `.ai/know/<feature>/review-results.md` - Test execution results
- `.ai/know/<feature>/review-feedback.md` - Summary of issues (if Needs Work)
- `.ai/know/<feature>/bugs/NNN-*.md` - Structured bug tracking files (if bugs found)
- `.ai/know/<feature>/changes/NNN-*.md` - Structured change requests (if changes needed)
- `.ai/know/<feature>/plans/review-fixes-*.md` - Implementation plan (if 3+ issues)
- Updated `.ai/know/<feature>/todo.md` - New unchecked items for bugs/changes
- Updated spec-graph status (if Approved)
- Optional: Feature ready for `/know:done` archival (if Approved)

---

## Example Session

```
User: /know:review user-authenticationAssistant: Found feature at .ai/know/user-authentication/
          Loading QA_STEPS.md...

          === Feature: User Authentication ===
          Objective: Enable users to securely log in and manage sessions

          Prerequisites:
          - Test database seeded with user test@example.com / password123
          - Application running on localhost:3000

          Are prerequisites met? Ready to begin testing?

User: [Selects "Yes"]
Assistant: Found feature. Loading QA steps...
          Test step 1: Login with valid credentials
          Expected: User redirected to dashboard
          
          Did this step work as expected?

User: [Selects "Pass"]

Assistant: Test step 2: Login with invalid password
          Expected: Error message displayed
          
          Did this step work as expected?

User: [Selects "Fail" and enters "No error message shown"]

Assistant: ...
          
          === Summary ===
          Test Steps: 4 passed, 1 failed, 0 skipped
          Pass Rate: 80%
          
          What is your decision on this feature?

User: [Selects "Needs Work"]

Assistant: Created review-results.md and review-feedback.md
          Status kept as "in-progress"
          
          Review complete. Fix issues and re-run /know:review when ready.
```

---

## Notes

- **Active testing examples**:
  - CLI test: Run `know phases` and verify output format
  - File test: Check that `.ai/know/feature/summary.md` was created
  - Data test: Execute Python script and validate JSON output
  - UI test: Ask user "Does the login button appear blue?"
- Use AskUserQuestion tool for all yes/no and multi-choice prompts
- Keep language user-facing (not technical) in QA_STEPS.md
- Record actual vs expected for all failures
- Update spec-graph only on "Approve" decision
- **Worktree compatibility**:
  - Can run from feature worktree (recommended - test in isolation)
  - Can run from main repo (also works - reads `.ai/know/<feature>/`)
  - Can run from any location with access to `.ai/` directory
  - Feature remains in worktree until `/know:done` is run

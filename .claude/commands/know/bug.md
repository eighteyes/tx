---
name: Know: Report Bug
description: Create a structured bug report for a feature with automatic tracking in todo.md
category: Know
tags: [know, bug, tracking, issue]
---

**Main Objective**

Create a structured bug report for a feature, automatically numbering it, adding it to todo.md, and optionally updating spec-graph status.

**Prerequisites**
- Activate the know-tool skill for graph operations
- Feature directory must exist at `.ai/know/features/<feature>/`

**Usage**

```
/know:bug <feature-name>
```

**Workflow**

### 1. Initialization

**Steps**:
1. Verify feature directory exists at `.ai/know/features/<feature>/`
2. Create bugs directory if it doesn't exist: `.ai/know/features/<feature>/bugs/`
3. Determine next bug number by reading existing bug files
4. Check current feature status in spec-graph (using **haiku agent**):
   - `know -g .ai/spec-graph.json show feature:<name>`

### 2. Collect Bug Information

**Use AskUserQuestion to gather details**:

1. **Bug title**:
   - Question: "What is the bug in one sentence?"
   - Collect as free text input

2. **Severity**:
   - Question: "What is the severity of this bug?"
   - Header: "Severity"
   - Options:
     - "Critical" - System crash, data loss, security vulnerability
     - "High" - Major feature broken, no workaround
     - "Medium" - Feature degraded, workaround exists
     - "Low" - Minor issue, cosmetic problem

3. **Description**:
   - Question: "Describe what went wrong in detail"
   - Collect as free text input

4. **Steps to reproduce**:
   - Question: "What are the steps to reproduce this bug? (List them numbered)"
   - Collect as free text input

5. **Expected behavior**:
   - Question: "What should happen instead?"
   - Collect as free text input

6. **Actual behavior**:
   - Question: "What actually happens?"
   - Collect as free text input

7. **Context** (optional):
   - Question: "Any additional context? (environment, logs, screenshots mentioned)"
   - Collect as free text input

### 3. Create Bug File

**Steps**:
1. Generate slug from bug title (lowercase, hyphens, max 40 chars)
2. Create file: `.ai/know/features/<feature>/bugs/NNN-slug.md`
3. Use template below with collected information

**Bug file template**:
```markdown
# Bug #NNN: [Title]

**Severity:** [Critical/High/Medium/Low]
**Status:** Open
**Reported:** YYYY-MM-DD
**Reporter:** [User or context if available]

## Description
[User's detailed description]

## Steps to Reproduce
[User's numbered steps]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Context
[Additional context, environment details, logs]

## Related Tasks
- [ ] Fix bug #NNN: [Title] (see todo.md)

## Resolution
<!-- Updated when bug is fixed -->
**Fixed:** [Date]
**Fixed By:** [Person/commit]
**Solution:** [Description of fix]
```

### 4. Update todo.md

**Steps**:
1. Read `.ai/know/features/<feature>/todo.md`
2. Add bug fix task at the top (or under a "## Bugs" section if it exists):
   ```markdown
   ## Bugs
   - [ ] Fix Bug #NNN: [Title] (see bugs/NNN-slug.md) [Severity]
   ```
3. If multiple bugs exist, keep them grouped and sorted by number

### 5. Update Spec-Graph (Optional)

**If feature status is "done" or "review-ready"**:
- Ask user: "This feature is marked as done/review-ready. Change status to 'in-progress'? [Yes/No]"
- If Yes (using **haiku agent**):
  - Update `meta.phases` to move feature back to "in-progress" phase
  - Update `meta.feature_specs.<feature>.status` to "in-progress"
  - Validate: `know validate`

### 6. Confirmation

**Display summary**:
```
Bug #NNN created: [Title]
Severity: [Level]
Location: .ai/know/features/<feature>/bugs/NNN-slug.md
Todo updated: .ai/know/features/<feature>/todo.md
Status: [Updated to in-progress / Kept as <current>]

Next steps:
- Fix the bug and update todo.md
- Update bug file when resolved
- Run /know:review <feature> to verify fix
```

---

## Outputs

- `.ai/know/features/<feature>/bugs/NNN-slug.md` - Structured bug report
- Updated `.ai/know/features/<feature>/todo.md` - Added bug fix task
- Updated spec-graph (if status changed to in-progress)

---

## Example Usage

```
User: /know:bug user-authentication
Assistant: Found feature at .ai/know/features/user-authentication/
          Creating bugs directory...
          Next bug number: #001

          [Collects information via AskUserQuestion]

          Creating bug file: bugs/001-password-reset-email-not-sent.md
          Updating todo.md...

          Bug #001 created: Password reset email not being sent
          Severity: High
          Location: .ai/know/features/user-authentication/bugs/001-password-reset-email-not-sent.md
          Todo updated: .ai/know/features/user-authentication/todo.md
          Status: Feature is in-progress (no change needed)

          Next steps:
          - Fix the bug and check off the task in todo.md
          - Update bugs/001-password-reset-email-not-sent.md when resolved
          - Run /know:review user-authentication to verify the fix
```

---

## Notes

- **Quick bug reporting**: Streamlined workflow for capturing bugs outside of review process
- **Automatic numbering**: Bugs are numbered sequentially (001, 002, 003...)
- **Slug generation**: File names are human-readable slugs from bug titles
- **Todo integration**: Bug fix tasks automatically added to todo.md for tracking
- **Status management**: Can reopen features marked as done/review-ready
- **Haiku agents**: Graph operations use haiku for speed and cost efficiency
- **Resolution tracking**: Bug files include a Resolution section to document fixes
- **Related to /know:review**: Bugs can be created during review or independently

---
`r1`

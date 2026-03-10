---
name: Know: Request Change
description: Create a structured change request for a feature with requirement tracking in spec-graph
category: Know
tags: [know, change, enhancement, tracking]
---
Create a structured change request for a feature with spec-graph requirement tracking.

**Main Objective**

Create a structured change request for a feature (enhancement, improvement, or modification), automatically numbering it, creating a requirement in spec-graph, and optionally updating feature status.

**Prerequisites**
- Activate the know-tool skill for graph operations
- Feature directory must exist at `.ai/know/features/<feature>/`

**Usage**

```
/know:change <feature-name>
```

**Workflow**

### 1. Initialization

**Steps**:
1. Verify feature directory exists at `.ai/know/features/<feature>/`
2. Create changes directory if it doesn't exist: `.ai/know/features/<feature>/changes/`
3. Determine next change number by reading existing change files
4. Check current feature status in spec-graph (using **haiku agent**):
   - `know -g .ai/know/spec-graph.json show feature:<name>`

### 2. Collect Change Information

**Use AskUserQuestion to gather details**:

1. **Change title**:
   - Question: "What change is needed in one sentence?"
   - Collect as free text input

2. **Change type**:
   - Question: "What type of change is this?"
   - Header: "Type"
   - Options:
     - "Enhancement" - New capability or improvement to existing
     - "Modification" - Change existing behavior
     - "Refactor" - Restructure without changing behavior
     - "Polish" - UI/UX improvements, documentation

3. **Priority**:
   - Question: "What is the priority of this change?"
   - Header: "Priority"
   - Options:
     - "High" - Needed before feature can ship
     - "Medium" - Should include if time permits
     - "Low" - Nice to have, can defer

4. **Rationale**:
   - Question: "Why is this change needed? What problem does it solve?"
   - Collect as free text input

5. **Current behavior**:
   - Question: "How does it work now?"
   - Collect as free text input

6. **Desired behavior**:
   - Question: "How should it work after the change?"
   - Collect as free text input

7. **Acceptance criteria**:
   - Question: "How will we know the change is complete? (List criteria)"
   - Collect as free text input

### 3. Create Change File

**Steps**:
1. Generate slug from change title (lowercase, hyphens, max 40 chars)
2. Create file: `.ai/know/features/<feature>/changes/NNN-slug.md`
3. Use template below with collected information

**Change file template**:
```markdown
# Change #NNN: [Title]

**Type:** [Enhancement/Modification/Refactor/Polish]
**Priority:** [High/Medium/Low]
**Status:** Open
**Requested:** YYYY-MM-DD

## Rationale
[Why this change is needed]

## Current Behavior
[How it works now]

## Desired Behavior
[How it should work]

## Acceptance Criteria
[List of criteria to verify completion]

## Tracking
**Requirement:** requirement:<feature>-change-NNN
**Query:** `know req status requirement:<feature>-change-NNN`

## Implementation Notes
<!-- Updated during implementation -->
**Started:** [Date]
**Completed:** [Date]
**Notes:** [Implementation details]
```

### 4. Create Change Requirement

**Steps**:
1. Create a requirement in spec-graph for the change:
   ```bash
   know req add <feature> change-NNN --name "Change: [Title]" \
     --description "See changes/NNN-slug.md for details. Type: [Type], Priority: [Priority]"
   ```
2. The requirement will be linked to the feature automatically
3. Track progress with: `know req status requirement:<feature>-change-NNN in-progress`

### 5. Update Spec-Graph (Optional)

**If feature status is "done" or "review-ready"**:
- Ask user: "This feature is marked as done/review-ready. Change status to 'changes-planned'? [Yes/No]"
- If Yes (using **haiku agent**):
  - Update `meta.phases` status to "changes-planned"
  - Validate: `know graph check validate`

### 6. Confirmation

**Display summary**:
```
Change #NNN created: [Title]
Type: [Enhancement/Modification/Refactor/Polish]
Priority: [Level]
Location: .ai/know/features/<feature>/changes/NNN-slug.md
Requirement: requirement:<feature>-change-NNN
Status: [Updated to changes-planned / Kept as <current>]

Next steps:
- Start implementation: `know req status requirement:<feature>-change-NNN in-progress`
- Update change file during implementation
- Mark complete: `know req complete requirement:<feature>-change-NNN`
- Run /know:review <feature> to verify change
```

---

## Outputs

- `.ai/know/features/<feature>/changes/NNN-slug.md` - Structured change request
- New requirement in spec-graph: `requirement:<feature>-change-NNN`
- Updated spec-graph status (if changed to changes-planned)

---

## Example Usage

```
User: /know:change user-authentication
Assistant: Found feature at .ai/know/features/user-authentication/
          Creating changes directory...
          Next change number: #001

          [Collects information via AskUserQuestion]

          Creating change file: changes/001-add-remember-me-option.md
          Creating requirement: requirement:user-authentication-change-001

          Change #001 created: Add "Remember Me" option to login
          Type: Enhancement
          Priority: Medium
          Location: .ai/know/features/user-authentication/changes/001-add-remember-me-option.md
          Requirement: requirement:user-authentication-change-001
          Status: Feature is in-progress (no change needed)

          Next steps:
          - Start implementation: `know req status requirement:user-authentication-change-001 in-progress`
          - Update changes/001-add-remember-me-option.md during implementation
          - Mark complete: `know req complete requirement:user-authentication-change-001`
          - Run /know:review user-authentication to verify the change
```

---

## Notes

- **Structured change tracking**: Captures enhancements/modifications systematically
- **Automatic numbering**: Changes are numbered sequentially (001, 002, 003...)
- **Slug generation**: File names are human-readable slugs from change titles
- **Requirement tracking**: Changes tracked as requirements in spec-graph (`know req list <feature>`)
- **Status management**: Uses "changes-planned" status for features with pending changes
- **Haiku agents**: Graph operations use haiku for speed and cost efficiency
- **Different from bugs**: Bugs are defects; changes are intentional improvements
- **Related to /know:review**: Changes can be created during review or independently

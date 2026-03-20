---
name: Know: Complete Feature
description: Archive a completed feature to .ai/know/archive/
category: Know
tags: [know, archive, complete]
---
Archive a completed feature and update graph phase status.

**Prerequisites**
- Activate the know-tool skill for graph validation

**Arguments**: `$ARGUMENTS` — feature name (e.g., `/know:done user-authentication`)

**Workflow**

### 1. Extract Feature Name

**Steps**:
1. Extract feature name from `$ARGUMENTS` or prompt user if not provided
2. Verify feature directory exists at `.ai/know/<feature-name>/`

### 2. Merge Feature to Main (if not already merged)

**Steps**:
1. If feature was developed in a branch, merge to main with feature tag:
   ```bash
   git checkout main
   git merge --no-ff feature/auth -m "feat: implement authentication [feature:auth]"
   ```
2. **IMPORTANT**: Include `[feature:<name>]` in commit message for tracking
3. Push to origin:
   ```bash
   git push origin main
   ```

### 2b. Reference Completeness Gate

**Steps**:
1. Check if the feature has specification references:
   ```bash
   know -g .ai/know/spec-graph.json graph uses feature:<name>
   ```
2. Look for non-code-link reference types (data-model, interface, business-logic, requirement)
3. If zero non-code-link references exist, warn:
   > "Feature has no specification references (data-model, interface, business-logic, etc.). Archive anyway?"
4. If user confirms, proceed. Otherwise, add references first via `/know:fill-out`.

### 3. Execute Done Command

**Steps**:
1. Run the know CLI command:
   ```bash
   know feature done <feature-name>
   ```
2. The command will:
   - Validate completion (implementation linkage, requirements)
   - Check for review-results.md
   - Tag related commits with git notes
   - Mark as done in spec-graph (removes from phases)
   - Archive to .ai/know/archive/

### 4. Verify Status

**Steps**:
1. Check feature status shows all green:
   ```bash
   know feature status feature:auth
   ```
   Should show:
   - ✅ Planned: Yes
   - ✅ Implemented: Yes
   - ✅ Reviewed: Yes (detects `[feature:auth]` in main branch)
2. Verify feature has been archived to `.ai/know/archive/<feature-name>/`
3. Verify feature removed from phases

**Example Usage**
```
User: /know:done user-authentication
Assistant:
  1. Merge feature branch with commit message:
     git merge --no-ff feature/user-auth -m "feat: authentication system [feature:user-authentication]"
  2. Run: know feature done user-authentication
  3. Verify status: know feature status feature:user-authentication
     ✅ Planned: Yes
     ✅ Implemented: Yes
     ✅ Reviewed: Yes
  4. Feature archived to .ai/know/archive/user-authentication/
```

**Safety Checks (handled by CLI)**
- Validate completion before archiving
- Verify feature was reviewed
- Confirm feature directory exists
- Ensure archive directory exists (create if needed)
- Don't overwrite existing archived features (prompt for new name if conflict)

**Notes**
- **Feature Status Tracking**: Uses virtual flags computed from graph state
  - `planned`: Feature exists in meta.phases (any phase)
  - `implemented`: Code-graph links exist (auto-detected via graph traversal)
  - `reviewed`: Git commit with `[feature:name]` merged to main (auto-detected)
- **Commit Message Pattern**: **MUST** include `[feature:name]` for status tracking
  - Example: `feat: implement auth system [feature:auth]`
  - This enables automatic "reviewed" status detection
  - Scanned from main branch git log
- **Skill wraps CLI command**: This skill calls `know feature done <feature>` which handles all the logic
- Features can be un-archived by manually moving them back
- Archive maintains full history (proposal, todo, plan, spec, review results)
- **Validation happens first**:
  - CLI command validates completion (graph linkage, requirements)
  - Checks for review-results.md
  - Only proceeds if feature is ready

---
`r1`

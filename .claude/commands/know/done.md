---
name: Know: Complete Feature
description: Archive a completed feature to .ai/know/archive/
category: Know
tags: [know, archive, complete]
---

**Prerequisites**
- Activate the know-tool skill for graph validation

**Workflow**

### 1. Detect Git Worktree Status (Optional)

**Steps**:
1. Check if feature has an associated worktree:
   ```bash
   WORKTREE_PATH=".ai/worktrees/<feature-name>"
   HAS_WORKTREE=false
   if [ -d "$WORKTREE_PATH" ]; then
     HAS_WORKTREE=true
   fi
   ```
2. Determine current location:
   ```bash
   MAIN_WORKTREE=$(git worktree list | head -1 | awk '{print $1}')
   CURRENT_TOPLEVEL=$(git rev-parse --show-toplevel)
   ```
3. **If worktree exists** (`HAS_WORKTREE=true`):
   - If currently IN that worktree: Switch to main repo first
   - If in main or different worktree: Proceed from current location
4. **If no worktree**: Skip to step 2 (Verify Feature Completion)

### 2. Verify Feature Completion

**Steps**:
1. Extract feature name from conversation or prompt user
2. Verify feature exists in `.ai/know/<feature-name>/`
3. Check that all tasks in `todo.md` are completed (all checkboxes checked)
   - If not all complete, warn user and ask for confirmation
4. Check spec-graph status is "done" or "complete"

### 3. Merge Feature Branch (if worktree exists)

**Skip this step if `HAS_WORKTREE=false`**

**Steps**:
1. **Ensure in main repo**:
   ```bash
   cd $MAIN_WORKTREE
   ```
2. **Sync .ai/know from worktree** (changes made in worktree):
   ```bash
   cp -r "$WORKTREE_PATH/.ai/know/<feature-name>/" .ai/know/<feature-name>/
   ```
3. **Merge feature branch**:
   ```bash
   git checkout main
   git merge --no-ff feature/<feature-name> -m "Merge feature: <feature-name>"
   ```
4. **Ask user**: "Delete feature branch? [Yes/No]"
   - If Yes: `git branch -d feature/<feature-name>`

### 4. Remove Git Worktree (if worktree exists)

**Skip this step if `HAS_WORKTREE=false`**

**Steps**:
1. Remove the worktree:
   ```bash
   git worktree remove "$WORKTREE_PATH"
   ```
2. Verify removal was successful

### 5. Archive Feature Directory

**Steps**:
1. Move entire feature directory:
   - FROM: `.ai/know/<feature-name>/`
   - TO: `.ai/know/archive/<feature-name>/`
2. Confirm the move was successful

### 6. Update Spec-Graph

**Steps**:
1. Update phase status to "done" (using **haiku agent**)
2. Validate both spec-graph and code-graph
3. Confirm graphs are consistent

**Example Usage**
```
User: /know-done user-authentication
Assistant: Checks completion, moves to archive, confirms success
```

**Safety Checks**
- Verify all todos are checked before archiving
- Confirm feature directory exists
- Ensure archive directory exists (create if needed)
- Don't overwrite existing archived features (prompt for new name if conflict)

**Notes**
- Features can be un-archived by manually moving them back
- Archive maintains full history (proposal, todo, plan, spec)
- **Worktree handling** (optional - only if `.ai/worktrees/<feature>/` exists):
  - Worktree path: `.ai/worktrees/<feature-name>/`
  - Branch naming: `feature/<feature-name>`
  - Automatically detects if feature was built in a worktree
  - Switches to main repo if currently in feature worktree
  - Syncs `.ai/know/<feature>/` from worktree to main
  - Merges feature branch using `--no-ff` for clear history
  - Removes worktree after successful merge
  - **Skips worktree steps** if no worktree exists (feature developed directly on main)

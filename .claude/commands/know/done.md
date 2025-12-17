---
name: Know: Complete Feature
description: Archive a completed feature to .ai/know/archive/
category: Know
tags: [know, archive, complete]
---

**Prerequisites**
- Activate the know-tool skill for graph validation

**Workflow**

### 1. Detect Git Worktree Status

**Steps**:
1. Check if feature has an associated worktree:
   ```bash
   git worktree list | grep "feature/<feature-name>"
   ```
2. Determine current location:
   ```bash
   MAIN_WORKTREE=$(git worktree list | head -1 | awk '{print $1}')
   CURRENT_TOPLEVEL=$(git rev-parse --show-toplevel)
   ```
3. **If worktree exists**:
   - If currently IN that worktree: Switch to main repo first
   - If in main or different worktree: Proceed from current location

### 2. Verify Feature Completion

**Steps**:
1. Extract feature name from conversation or prompt user
2. Verify feature exists in `.ai/know/<feature-name>/`
3. Check that all tasks in `todo.md` are completed (all checkboxes checked)
   - If not all complete, warn user and ask for confirmation
4. Check spec-graph status is "done" or "complete"

### 3. Merge Feature Branch (if worktree exists)

**Steps**:
1. **Ensure in main repo**:
   ```bash
   cd $MAIN_WORKTREE
   ```
2. **Sync .ai/ from worktree** (if it hasn't been synced yet):
   ```bash
   cp -r ../<repo-name>-<feature-name>/.ai/know/<feature-name>/ .ai/know/<feature-name>/
   ```
3. **Merge feature branch**:
   ```bash
   git checkout main
   git merge --no-ff feature/<feature-name> -m "Merge feature: <feature-name>"
   ```
4. **Ask user**: "Delete feature branch? [Yes/No]"
   - If Yes: `git branch -d feature/<feature-name>`

### 4. Remove Git Worktree (if exists)

**Steps**:
1. Remove the worktree:
   ```bash
   git worktree remove ../<repo-name>-<feature-name>
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
- **Worktree handling**:
  - Automatically detects if feature was built in a worktree
  - Switches to main repo if currently in feature worktree
  - Merges feature branch using `--no-ff` for clear history
  - Removes worktree after successful merge
  - Can run from main repo or any worktree (auto-navigates as needed)

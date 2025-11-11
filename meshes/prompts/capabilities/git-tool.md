# Git Tool Capability

You have access to git worktree and merge operations via the `tx tool` command. These tools are designed for agent-invocable git workflows with event log integration.

## Git Worktree Management

Worktrees allow you to work on multiple branches simultaneously without switching branches in your main working directory. Each worktree is a separate checkout in its own directory.

### Commands

#### Create Worktree
```bash
tx tool worktree add "feat/new-feature"
```
- Creates a new worktree at `../repo-feat/new-feature`
- Automatically creates the branch if it doesn't exist
- Returns: `{"success": true, "branch": "feat/new-feature", "path": "/path/to/worktree"}`

#### Create Worktree with Base Branch
```bash
tx tool worktree add "feat/new" --base=develop
```
- Creates worktree branching from `develop` instead of current branch
- Useful for starting features from specific branches

#### List Worktrees
```bash
tx tool worktree list
```
- Returns all active worktrees with paths and branches
- Output: `{"success": true, "worktrees": [...]}`

#### Remove Worktree
```bash
tx tool worktree remove "feat/old"
```
- Removes worktree at `../repo-feat/old`
- Automatically forces removal if there are uncommitted changes
- Returns: `{"success": true, "branch": "feat/old", "forced": true/false}`

#### Prune Stale Worktrees
```bash
tx tool worktree prune
```
- Cleans up worktree administrative files for deleted directories
- Safe to run periodically

### Event Log Integration

To log worktree operations to the event log (for agent-to-agent communication):

```bash
tx tool worktree add "feat/thing" --log --from=core --to=user
```

Options:
- `--log` - Write operation to centralized event log
- `--from=<agent>` - Set source agent (default: user)
- `--to=<agent>` - Set destination agent (default: user)

This creates a `git-worktree` message in `.ai/tx/msgs/` that other agents can see.

### Use Cases

1. **Parallel Development**: Work on multiple features without branch switching
2. **Code Review**: Check out PR branches while keeping main work untouched
3. **Hotfix Workflows**: Keep production branch ready while developing features
4. **Agent Isolation**: Each agent mesh can work in its own worktree

## Git Merge Operations

Manage merge workflows with conflict detection and AI-assisted resolution.

### Commands

#### Start Merge
```bash
tx tool merge start feat/branch-to-merge
```
- Attempts to merge `feat/branch-to-merge` into current branch
- Returns success if clean merge
- Returns conflict info if conflicts detected
- Output: `{"success": true/false, "status": "completed"/"conflicts", "conflicts": [...]}`

#### Check Merge Status
```bash
tx tool merge status
```
- Shows current merge state
- Returns: `{"status": "none"/"in-progress"/"conflicts", "conflictCount": 0}`

#### List Conflicts
```bash
tx tool merge conflicts
```
- Detailed list of all conflicted files
- Returns: `{"success": true, "count": 2, "conflicts": [{"file": "x.js", "markerCount": 1}]}`

#### Resolve Conflicts

**Strategy: ours (use current branch version)**
```bash
tx tool merge resolve file.js --strategy=ours
```
- Takes current branch's version
- Stages the file automatically
- Returns: `{"success": true, "strategy": "ours"}`

**Strategy: theirs (use incoming branch version)**
```bash
tx tool merge resolve file.js --strategy=theirs
```
- Takes incoming branch's version
- Stages the file automatically
- Returns: `{"success": true, "strategy": "theirs"}`

**Strategy: ai (get AI-ready analysis)**
```bash
tx tool merge resolve file.js --strategy=ai
```
- Returns structured conflict analysis for AI processing
- Includes context lines, both versions, and suggestions
- Does NOT automatically resolve - requires manual intervention
- Output includes:
  - `analysis`: Structured conflict data with context
  - `prompt`: Formatted markdown prompt ready for AI
  - `instructions`: How to apply resolution

#### Abort Merge
```bash
tx tool merge abort
```
- Cancels merge and restores pre-merge state
- Safe rollback if merge goes wrong
- Returns: `{"success": true, "message": "Merge aborted successfully"}`

### Event Log Integration

To log merge operations:

```bash
tx tool merge start feat/thing --log --from=core
tx tool merge conflicts --log
tx tool merge resolve file.js --strategy=ai --log
```

Creates `git-merge` and `git-conflict` messages in the event log.

## AI-Assisted Conflict Resolution Workflow

When using `--strategy=ai`, the tool provides structured data optimized for AI processing:

### 1. Detect Conflicts
```bash
tx tool merge start feat/new --log
```
Returns:
```json
{
  "success": false,
  "status": "conflicts",
  "conflicts": [{"file": "app.js", "markerCount": 2}]
}
```

### 2. Get AI-Ready Analysis
```bash
tx tool merge resolve app.js --strategy=ai
```
Returns:
```json
{
  "success": false,
  "strategy": "ai",
  "file": "app.js",
  "analysis": {
    "conflictCount": 2,
    "fileInfo": {"extension": "js", "type": "code"},
    "suggestion": "Code file - ensure syntax is preserved",
    "conflicts": [
      {
        "lineStart": 10,
        "lineEnd": 15,
        "ours": {"label": "HEAD", "content": ["line1", "line2"]},
        "theirs": {"label": "feat/branch", "content": ["line3"]},
        "context": {
          "before": [{"line": 9, "content": "function foo() {"}],
          "after": [{"line": 16, "content": "}"}]
        }
      }
    ]
  },
  "prompt": "# Merge Conflict Resolution\n\nFile: app.js\n..."
}
```

### 3. Process with AI

The `prompt` field contains a formatted markdown document with:
- File metadata (name, type, conflict count)
- Each conflict with:
  - Context lines before
  - Current branch version (ours)
  - Incoming branch version (theirs)
  - Context lines after
- Type-specific suggestions
- Resolution instructions

Use this prompt to guide conflict resolution decisions.

### 4. Apply Resolution (Programmatic)

After AI determines the resolved content, apply it using the ConflictResolver class (in agent code):

```javascript
const { ConflictResolver } = require('../lib/git/conflict-resolver');

const resolvedContent = `/* AI-generated resolved content */`;
const result = await ConflictResolver.applyResolution('app.js', resolvedContent);
// Creates backup, writes content, stages file
// Returns: {"success": true, "backupPath": "app.js.conflict-backup"}
```

The backup file is kept in case rollback is needed.

## Workflow Examples

### Feature Development Workflow
```bash
# Create isolated worktree for feature
tx tool worktree add "feat/user-auth" --log

# Agent works in worktree, makes commits

# When ready, merge back to main
cd ../repo-feat/user-auth
tx tool merge start main --log

# If conflicts, get AI assistance
tx tool merge conflicts
tx tool merge resolve auth.js --strategy=ai --log
# Process AI suggestions, apply resolution
```

### Multi-Agent Parallel Development
```bash
# Core agent spawns research mesh with its own worktree
tx tool worktree add "research-spike" --log --from=core --to=research

# Research mesh works independently
# Core mesh continues on main branch

# When research complete, merge findings
tx tool merge start research-spike --log
```

### Hotfix with Worktrees
```bash
# Keep main work untouched, create hotfix worktree
tx tool worktree add "hotfix/security" --base=production --log

# Work in hotfix worktree
# Deploy from there

# Clean up when done
tx tool worktree remove "hotfix/security" --log
tx tool worktree prune
```

## JSON Output

All commands return JSON for easy parsing by agents. Example patterns:

```bash
# Check if we can merge cleanly
RESULT=$(tx tool merge start feat/x)
STATUS=$(echo "$RESULT" | jq -r '.status')

if [ "$STATUS" = "conflicts" ]; then
  # Handle conflicts
  tx tool merge conflicts
fi
```

## Best Practices

1. **Log for Coordination**: Use `--log` flag when operations affect other agents
2. **Check Status First**: Run `tx tool merge status` before starting new merges
3. **Use AI Strategy Wisely**: The AI strategy is for complex conflicts; use ours/theirs for simple cases
4. **Clean Up Worktrees**: Remove worktrees when features are merged to save disk space
5. **Backup Awareness**: All AI resolutions create `.conflict-backup` files automatically

## Error Handling

All commands return structured errors:

```json
{
  "error": "Not in a git repository",
  "command": "worktree add"
}
```

Always check `success` field in responses before proceeding.

## Integration with TX Event Log

Git operations appear in `tx msg` output when `--log` is used:

```bash
tx msg --type git-worktree  # See worktree operations
tx msg --type git-merge     # See merge operations
tx msg --type git-conflict  # See conflict analyses
```

This allows agents to:
- Track git operations across the mesh
- Coordinate on merge conflicts
- Request help from other agents
- Log decisions for audit trail

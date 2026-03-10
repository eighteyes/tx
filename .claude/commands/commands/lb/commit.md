---
allowed-tools: Bash(git push:*),  Bash(git add:*), Bash(git status:*), Bash(git diff:*)
description: Create a git commit and request session clear
permalink: commands/lb/commit
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10 2>/dev/null || echo "No commits yet"`

## ⚠️ BRANCH SAFETY CHECK

**CRITICAL**: Verify you are NOT on main branch before committing!

- If on main: STOP! Create feature branch first: `git checkout -b feature/your-feature-name`
- If on branch: ✅ Proceed with commit
- After commit: Remind user changes are on **<branch-name>** and need to be merged to main via PR

## Your task

Based on the above changes, create and push a single git commit using conventional commit format.

### Conventional Commit Format

Use this deterministic format instead of AI-generated prose:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat:` - new feature
- `fix:` - bug fix
- `docs:` - documentation changes
- `style:` - formatting, missing semicolons, etc.
- `refactor:` - code refactoring
- `test:` - adding or updating tests
- `chore:` - maintenance tasks, build changes
- `perf:` - performance improvements
- `ci:` - CI/CD changes
- `build:` - build system changes
- `revert:` - reverting previous commit

**Examples:**
- `feat(auth): add JWT token validation`
- `fix(api): handle null response in user endpoint`
- `docs(readme): update installation instructions`
- `refactor(utils): simplify string formatting functions`

### Commit Process

1. **Analyze changes** - Determine the type and scope of changes
2. **Stage relevant changes** - Add files that belong together
3. **Create conventional commit** - Use standard format above
4. **Push to remote** - Push commit to remote repository
5. **Request session clear** - Ask user to `/clear` after successful commit

### Post-Commit Actions

After successful commit:
- Verify commit was created and pushed
- **IMPORTANT**: Remind user that changes are on **<branch-name>** branch, NOT main
- Explain that changes need to be merged to main via Pull Request
- **Request user to `/clear`** - Clear session context for next task

### Success Criteria

- ✅ Changes staged appropriately
- ✅ Commit created with conventional format
- ✅ Type and scope correctly identified
- ✅ Commit pushed to remote
- ✅ User requested to `/clear` session

Begin conventional commit process now.
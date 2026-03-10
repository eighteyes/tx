---
name: Know: Validate Feature
description: Check if codebase changes since feature creation warrant revisiting the plan
category: Know
tags: [know, validate, drift-detection]
---
Check if codebase changes since feature creation warrant revisiting the plan.

**Prerequisites**
- Feature exists in `.ai/know/features/<feature-name>/`
- Activate the know-tool skill for graph operations

**Auto-creates**: `config.json` if missing (touch it = track it)

**Workflow**

### 1. Identify Feature

**Steps**:
1. Extract feature name from command argument
2. Verify feature directory exists:
   ```bash
   ls -la .ai/know/features/<feature-name>/
   ```
3. Verify feature exists in spec-graph:
   ```bash
   know -g .ai/know/spec-graph.json get feature:<feature-name>
   ```

### 2. Determine Baseline

**Steps**:
1. Check for config.json baseline:
   ```bash
   cat .ai/know/features/<feature-name>/config.json 2>/dev/null | jq '.baseline'
   ```
2. If no config baseline, use directory mtime:
   ```bash
   stat -f "%Sm" -t "%Y-%m-%d %H:%M" .ai/know/features/<feature-name>
   ```
3. Report baseline to user

### 3. Resolve Watched Paths

**Three-tier resolution**:

1. **Explicit paths** from config.json:
   ```bash
   cat .ai/know/features/<feature-name>/config.json | jq '.watch.paths[]'
   ```

2. **Code-graph product-component refs**:
   ```bash
   # Find modules linked to this feature
   jq '.references["product-component"] | to_entries[] | select(.value.feature == "feature:<feature-name>") | .key' .ai/know/code-graph.json
   ```

3. **Feature directory** (always included):
   ```
   .ai/know/features/<feature-name>/**
   ```

### 4. Detect Changes

**Run CLI command for detailed analysis**:
```bash
know graph check validate-feature <feature-name> --json
```

**Or manual git query**:
```bash
git log --since="<baseline-date>" --name-only --pretty=format:"%H|%s" -- <watched-paths>
```

### 5. Assess Risk

Categorize each changed file:

| Risk | Criteria | Color |
|------|----------|-------|
| **HIGH** | Direct feature component source files (.py, .ts, .js) | Red |
| **MEDIUM** | Same directory/package, feature config | Yellow |
| **LOW** | Test files, general config | Green |
| **INFO** | Documentation, comments | Gray |

### 6. Report Findings

Present to user:

```
Feature: <name>
Baseline: <date> (commit: <sha>)

Risk Assessment:
  HIGH:   X files (review plan immediately)
  MEDIUM: X files (check for interface changes)
  LOW:    X files (informational)
  INFO:   X files (no action needed)

Changed Files:
  [HIGH]   src/auth/handler.py (3 commits)
  [MEDIUM] src/auth/utils.py (1 commit)
  [LOW]    tests/auth/test_handler.py (2 commits)

Recommendation: <based on risk counts>
```

### 7. User Decision

Ask user to choose next action:

1. **"Review changes"** - Open changed files for inspection
2. **"Update plan"** - Transition to plan revision workflow
3. **"Dismiss"** - No action, feature plan remains current

**Example Usage**
```
User: /know:validate spec-generation-enrichment
Assistant: Checking for codebase changes since spec-generation-enrichment was planned...

          Baseline: 2026-01-15 (directory created)

          Risk Assessment:
            HIGH:   0 files
            MEDIUM: 1 files
            LOW:    2 files
            INFO:   1 file

          Changed files:
            [MEDIUM] know/src/generators.py (feature enhancements)
            [LOW]    tests/test_generators.py (new tests)
            [LOW]    know/templates/feature.md (template update)
            [INFO]   README.md (1 commit)

          Recommendation: Plan is likely valid. MEDIUM changes
          are enhancements within planned scope.

          What would you like to do?
          1. Review changes
          2. Update plan
          3. Dismiss
```


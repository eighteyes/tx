---
allowed-tools:
- Bash(git log:*)
- Bash(git status:*)
- Bash(git diff:*)
- Bash(date:*)
- Bash(mkdir:*)
- Read(*)
- Write(.ai/handoff/*)
description: Create structured AI-to-AI session handoff document
permalink: commands/lb/handoff
---

## Context

- Timestamp: !`date +%m%d%H%M%S`
- Git status: !`git status --porcelain`
- Uncommitted diff: !`git diff HEAD`
- Recent commits: !`git log --oneline -3 2>/dev/null || echo "Not a git repository"`
- Current branch: !`git branch --show-current 2>/dev/null || echo "Not a git repository"`

## Your task

Create a **structured, machine-readable handoff** for the next AI session to consume. This handoff should capture the minimum viable context needed to continue work without loss of information.

User's handoff note: $ARGUMENTS

### Filename Convention

```
.ai/handoff/{MMDDHHMMSS}-handoff.md
```

Use timestamp from context. Auto-generate description from session focus - no user input required for filename.

### Handoff Format: YAML Frontmatter + Optional Notes

```yaml
---
# Session Metadata
timestamp: 2024-11-20T14:30:00Z
branch: feature/openspec-setup
session_focus: "One-line description of what this session was about"
user_goal: "What the user is trying to achieve (their words if possible)"
status: in_progress | blocked | complete

# File Changes (ONLY files with uncommitted changes or just created)
files:
  modified:
    - path: openspec/project.md
      changes: "Populated with TX project context and conventions"
      status: complete | needs_review | incomplete
      line_refs: "42-89" # Optional: key line numbers

  created:
    - path: .claude/commands/lb/handoff.md
      purpose: "AI-to-AI session handoff command"
      status: complete

  deleted:
    - path: old-file.js
      reason: "Replaced by new-file.js"

# Work Log (what was attempted, what worked, what failed)
attempts:
  - action: "Created OpenSpec project.md"
    outcome: success

  - action: "Ran critique on handoff command"
    outcome: "Identified bloat and missing AI context - needs revision"

  - action: "Tried approach X"
    outcome: failed
    error: "Error message or reason"
    why_failed: "Root cause analysis"

# Next Actions (specific, executable tasks)
next_actions:
  - task: "Revise /lb:handoff command to use structured YAML format"
    priority: high
    context: "Based on critique feedback"
    acceptance: "Command outputs YAML frontmatter + optional notes"

  - task: "Test handoff with fresh session"
    priority: medium
    depends_on: "Previous task"

# Open Questions (things the AI wasn't sure about)
open_questions:
  - "Should handoff support non-git projects differently?"
  - "Max handoff file size before it becomes counterproductive?"

# Blockers & Issues (critical problems)
blockers: []
  # - issue: "Cannot proceed because X"
  #   severity: high | medium | low
  #   needs: "What's required to unblock"

# Conversation Context (user preferences and interaction style)
conversation:
  user_tone: "Direct, no-nonsense, appreciates brutal honesty"
  user_preferences:
    - "Wants structured data over prose"
    - "Prefers AI-to-AI handoffs for clean context"
  important_constraints:
    - "No time estimates in plans or docs"
    - "Use TX event log patterns for consistency"
---

## Optional Freeform Notes

[Use this section ONLY for nuanced context that doesn't fit the structured format above.
Keep it under 200 words. If you can't, the structured format is insufficient.]

**Example:**
User showed frustration with bloated templates and wants minimal viable handoffs.
The critique revealed TX project uses {MMDDHHMMSS} timestamps everywhere - handoff
should follow this pattern for consistency.
```

### Critical Instructions

1. **Be ruthlessly concise** - If a section is empty, omit it entirely from the YAML
2. **Only include files with actual changes** - Don't list every file you read, only what changed
3. **Document failures** - Failed attempts are MORE important than successes (avoid repeating mistakes)
4. **Make next_actions executable** - Each should be specific enough to act on immediately
5. **Capture user voice** - Use their actual words for goals/preferences when possible
6. **Keep freeform notes minimal** - If you need >200 words, add structure instead

### Process

1. Create `.ai/handoff/` directory if needed
2. Analyze conversation for actual session focus (not what you think it should be)
3. Extract file changes from git context (ONLY uncommitted or just-created files)
4. Identify what worked, what failed, what's next
5. Generate YAML frontmatter + minimal notes
6. Save with timestamp-based filename
7. Confirm to user with location and one-line summary

### Success Criteria

- ✅ Next AI can continue work without asking clarifying questions
- ✅ Failed approaches documented to avoid repetition
- ✅ File is under 200 lines (if longer, you're including too much)
- ✅ YAML is valid and machine-parseable
- ✅ User's actual goal and tone are captured accurately

Begin creating minimal structured handoff now.

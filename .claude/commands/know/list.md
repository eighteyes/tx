---
name: Know: List Features
description: Show all planned, in-progress, and completed features grouped by phase
category: Know
tags: [know, list, status]
---
Show all features grouped by phase with task completion counts.

**Objective**

Display all features grouped by phase with task completion counts.

**Implementation**

Run the `know phases` command:

```bash
know phases
```

This command displays features grouped by phase (I, II, III, in-progress, review-ready, done) with:
- Phase shortname, name, and description
- Features within each phase
- Task completion counts from todo.md (e.g., "3/13")
- Status icons (✅ completed, 🔄 in-progress, 📋 planned)
- Summary footer with totals

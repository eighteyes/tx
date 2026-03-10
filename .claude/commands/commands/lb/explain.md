---
allowed-tools:
- Bash(git log:*)
- Bash(git status:*)
- Bash(git diff:*)
- Bash(ps aux:*)
- Bash(launchctl:*)
- Read(*)
description: Explains recent actions with detailed steps and impact analysis
permalink: commands/lb/explain
---

## Context
!`git log --oneline -10`
!`git status --porcelain`

## Your task

Analyze and explain the recent actions taken in this session, providing:

1. **Summary of Actions**: What was attempted and what was accomplished
2. **Detailed Steps**: Step-by-step breakdown of each action taken
3. **Technical Details**: Commands run, files modified, services affected
4. **Impact Analysis**: What changed in the system and why
5. **Outcome**: Final state and any remaining issues

Focus on: $ARGUMENTS

## Instructions

- Use the git context to understand what changes were made
- Check system processes and services that were affected
- Read any modified configuration files to understand the changes
- Provide clear explanations suitable for both technical and non-technical audiences
- Include command examples where relevant
- Highlight any potential side effects or considerations
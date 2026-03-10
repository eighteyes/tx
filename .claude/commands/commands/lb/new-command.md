---
allowed-tools: Read(.claude/commands/*), Write(.claude/commands/*), LS(.claude/commands)
description: Create a new Claude Code slash command, accepts arguments
permalink: commands/lb/new-command
---

Create a new slash command at `.claude/commands/` based on the following specifications: $ARGUMENTS

## Command Creation Process
Ultrathink on.
Support arguments. Use "$+ARGUMENTS" ( without the + ) in the output.
1. **Analyze existing commands** to understand patterns and conventions
2. **Define command purpose** - what specific workflow or task will this automate?
3. **Identify required tools** - what Claude Code tools will the command need?
4. **Structure the command** following the established format

## Command Template Structure

```markdown
---
allowed-tools: [List specific tools needed, e.g., Bash(git *), Read(*), Edit(*)]
description: [Brief description of what this command does]
---

## Context
[Optional: Dynamic context gathering using !+`command` (remove +) syntax]

## Your task
[Clear instructions for what Claude should do when this command is invoked]

[Optional: Additional sections like examples, constraints, etc.]
```

## Guidelines

- **Naming**: Use kebab-case for command filenames (e.g., `my-command.md`)
- **Tools**: Be specific with allowed-tools (e.g., `Bash(git add:*)` not `Bash(*)`)
- **Context**: Use `!+`command`` (remove the +)  for dynamic context when needed
- **Arguments**: Use `$ARGUMENTS` to accept user input
- **Clarity**: Write clear, actionable instructions

## Examples of Good Commands

- **Workflow automation**: `/deploy`, `/setup-env`, `/run-tests`
- **Code generation**: `/add-component`, `/create-api`, `/setup-db`
- **Analysis**: `/analyze-performance`, `/check-security`, `/review-code`

Check existing commands for conflicts and similar functionality before creating.
Run /critique on the command after making it.
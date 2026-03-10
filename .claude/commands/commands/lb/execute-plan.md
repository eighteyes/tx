---
allowed-tools:
- Read(*)
- Write(*)
- Task(*)
- ListMcpResourcesTool(*)
- ReadMcpResourceTool(*)
description: Execute next plan task with TDD workflow
permalink: commands/lb/execute-plan
---

## Context

**Todo List**: @ai-docs/todo.md or todo.md. if neither of these exist, abort. 

## Your task

Execute the next undone task from Todo List using TDD workflow.

Arguments: $ARGUMENTS

### Execution Steps

1. **Read next undone task** from Todo List
3. **Start with tests** - Write simple failing tests that meet success criteria
4. **Implement code** - Write minimal code to make tests pass
5. **Validate completion** - Run full test suite
6. **Update Todo List* - Mark task as completed
7. **Request /clear** - Ask user to clear session after writing tests and code.

Select the next undone task and begin TDD execution now.
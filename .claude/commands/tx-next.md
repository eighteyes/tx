# tx-next - Request Next Task

Request the next task from the workflow inbox.

## Usage

```
/tx-next
```

## Behavior

- Checks agent inbox for pending tasks
- Moves next available task to active
- Injects active task as file attachment
- Agent starts processing

## Example

You have completed a task and are ready for more work:

```
/tx-next
```

The system will:
1. Check `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/inbox/` for pending tasks
2. Move the next task to `msgs/next/`
3. When agent is idle, move to `msgs/active/`
4. Inject the active task file for you to process

## Related Commands

- `/tx-done` - Mark current task complete
- `/ask` - Ask another agent a question

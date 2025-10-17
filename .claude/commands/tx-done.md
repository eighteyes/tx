# tx-done - Mark Task Complete

Mark the current task as complete and move it to the outbox for delivery.

## Usage

```
/tx-done
```

## Behavior

- Moves the current active task message to outbox
- Sets status to `completed`
- Workflow system will deliver to next agent or complete mesh
- Agent moves to idle state, ready for next task

## Example

You have just finished processing a task. Use this command to mark it complete:

```
/tx-done
```

The system will:
1. Save your result to `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/outbox/`
2. Mark the message as type `task-complete`
3. Signal workflow to advance to next agent or complete

## Related Commands

- `/tx-next` - Request the next task
- `/ask` - Ask another agent a question

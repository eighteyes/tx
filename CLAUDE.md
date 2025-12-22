## Architecture
- `.ai/tx/` - system state
- `src/cli/` - CLI commands (start, status, msg, spy)
- `src/core/` - Consumer (file watcher), tmux utilities
- `src/queue/` - SQLite message queue
- `src/worker/` - SDK-based ephemeral workers
- `meshes/` - Agent configs and prompts

## Key Learnings

### Write Messages, NEVER Update

Update tool does not trigger the file watcher and will not send messages to meshes when used.

### Logging

**CRITICAL**: Capture all errors and logs with the logging class (`log` from `src/shared/logger.ts`). Never use `console.error` or `console.log` for error handling or system logging.

- Use `log.error()` for errors
- Use `log.warn()` for warnings
- Use `log.info()` for informational messages
- Use `log.debug()` for debug output

Logs are written to `.ai/tx/logs/v4.jsonl` and can be viewed with `tx logs`.
child.on('exit', () => { /* cleanup */ });

### Mesh-Builder Skill Updates

**CRITICAL**: Whenever you add or modify mesh configuration fields or patterns:

1. **Update `.claude/skills/mesh-builder/SKILL.md`** to reflect the changes
2. Add new fields to the Config Field Reference table
3. Document new patterns with examples
4. Update Best Practices if security/architectural implications exist

## Message Flow

1. Core agent writes `.md` files to `.ai/tx/msgs/`
2. Consumer watches directory, inserts into SQLite queue
3. Dispatcher polls queue for task messages
4. Workers spawn via Claude Agent SDK to handle tasks
5. Workers write response messages back to msgs dir

# TX V4

Minimal rewrite of tx-cli with flat structure and SDK-based workers.

## Architecture

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

### execSync blocks the event loop

**CRITICAL**: Using `execSync('tmux attach ...')` blocks the entire Node.js event loop. While attached to tmux:
- Chokidar file watcher events don't fire
- Message consumer can't process new files
- Worker dispatcher can't poll the queue
- All background intervals are frozen

**Solution**: Use `spawn` with inherited stdio instead, or run the consumer/dispatcher in a separate process.

```typescript
// BAD - blocks event loop
execSync(`tmux attach -t ${sessionName}`, { stdio: 'inherit' });

// GOOD - doesn't block
const child = spawn('tmux', ['attach', '-t', sessionName], {
  stdio: 'inherit',
  detached: false
});
child.on('exit', () => { /* cleanup */ });
```

### Multiple TX instances on one system

**IMPORTANT**: TX generates unique tmux session names per working directory. This allows running multiple TX instances simultaneously in different directories without conflict.

Session name format: `tx-{dirname}-{hash}` where hash is first 8 chars of MD5 of full path.

Example:
- `/home/user/project-a/` → session: `tx-project-a-d41d8cd9`
- `/home/user/project-b/` → session: `tx-project-b-98f13708`

This prevents instances from killing each other's tmux sessions.

## Running

```bash
npm run start   # Start core + attach to tmux
npm run status  # Show system status
```

## Mesh Configuration

### Mesh-Builder Skill Updates

**CRITICAL**: Whenever you add or modify mesh configuration fields or patterns:

1. **Update `.claude/skills/mesh-builder/SKILL.md`** to reflect the changes
2. Add new fields to the Config Field Reference table
3. Document new patterns with examples
4. Update Best Practices if security/architectural implications exist

**Examples requiring mesh-builder updates:**
- Adding new config fields (toolRestriction, mcpServers, etc.)
- New mesh patterns or categories (protagents/, system/)
- Security features or restrictions
- Routing configurations or multi-agent patterns

**Why:** Mesh-builder skill is the source of truth for how to build meshes. If patterns exist in actual meshes but aren't documented, users (and future agents) won't know they're available.

## Message Flow

1. Core agent writes `.md` files to `.ai/tx/msgs/`
2. Consumer watches directory, inserts into SQLite queue
3. Dispatcher polls queue for task messages
4. Workers spawn via Claude Agent SDK to handle tasks
5. Workers write response messages back to msgs dir

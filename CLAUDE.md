# TX V4

Minimal rewrite of tx-cli with flat structure and SDK-based workers.

## Architecture

- `src/cli/` - CLI commands (start, status, msg, spy)
- `src/core/` - Consumer (file watcher), tmux utilities
- `src/queue/` - SQLite message queue
- `src/worker/` - SDK-based ephemeral workers
- `meshes/` - Agent configs and prompts

## Key Learnings

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
execSync(`tmux attach -t ${SESSION_NAME}`, { stdio: 'inherit' });

// GOOD - doesn't block
const child = spawn('tmux', ['attach', '-t', SESSION_NAME], {
  stdio: 'inherit',
  detached: false
});
child.on('exit', () => { /* cleanup */ });
```

## Running

```bash
npm run start   # Start core + attach to tmux
npm run status  # Show system status
```

## Message Flow

1. Core agent writes `.md` files to `.ai/tx/msgs/`
2. Consumer watches directory, inserts into SQLite queue
3. Dispatcher polls queue for task messages
4. Workers spawn via Claude Agent SDK to handle tasks
5. Workers write response messages back to msgs dir

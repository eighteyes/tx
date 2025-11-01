# Watch Capability - Persistent File Monitoring

**Watch** enables continuous monitoring of files with automatic processing through mesh agents using delta tracking.

## What is Watch?

The watch capability allows you to monitor files (like log files, error files, or any text file) and automatically process changes through a mesh. It only sends **new content** (delta) to avoid reprocessing the same data.

## Use Cases

- **Error monitoring**: Watch `error.jsonl` and auto-fix errors as they occur
- **Log analysis**: Monitor log files and extract insights
- **Data ingestion**: Process new entries in data files
- **Development workflows**: Watch test output and react to failures

## How It Works

```
File changes → Debounce (1s) → Extract delta → Send to mesh → Process → Repeat
```

**Key Features:**
- ✅ **Delta tracking** - Only processes NEW lines since last read
- ✅ **Debouncing** - Waits 1s after changes stop before processing
- ✅ **Queuing** - Handles rapid changes without losing data
- ✅ **State persistence** - Survives restarts, resumes from last position
- ✅ **Background mode** - Can run detached for programmatic use

## Basic Usage

### Start Watching (Attached Mode)
```bash
tx watch <file> --mesh <mesh-name>
```

**Example:**
```bash
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer
```

This will:
1. Spawn the `error-fixer` mesh (if not already running)
2. Start watching `error.jsonl`
3. Show live updates in the terminal
4. Send only NEW errors to the mesh
5. Press Ctrl+C to stop

### Background Mode (Detached)
```bash
tx watch <file> --mesh <mesh-name> -d
```

**Example:**
```bash
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer -d
```

Runs in background, returns immediately. Use `tx status` to monitor.

## Message Flow

When new content is detected, the watcher creates a message:

```markdown
---
from: watcher
to: {mesh}/{agent}
type: delta
file: /path/to/watched/file
fromLine: 42
toLine: 45
---

New content detected in `error.jsonl`:

Lines 42 → 45:

```
{"level":"error","msg":"undefined variable foo","file":"lib/queue.js","line":120}
{"level":"error","msg":"missing import","file":"lib/watcher.js","line":45}
{"level":"error","msg":"type mismatch","file":"bin/tx.js","line":89}
```
```

The mesh agent processes this and should respond with a completion message:

```markdown
---
from: {mesh}/{agent}
to: watcher
type: completion
---

Processed 3 errors:
- Fixed undefined variable in lib/queue.js:120
- Added missing import to lib/watcher.js:45
- Corrected type in bin/tx.js:89
```

## State Tracking

Watcher state is stored in `.ai/tx/state/watchers/{mesh-name}.json`:

```json
{
  "meshName": "error-fixer",
  "watchedFile": "/workspace/project/.ai/tx/logs/error.jsonl",
  "lastProcessedLine": 45,
  "lastProcessedAt": "2025-10-25T10:30:00Z",
  "totalChangesProcessed": 12,
  "currentState": "idle",
  "pid": 12345
}
```

## Checking Status

Use `tx status` to see active watchers:

```
Active Watchers (1):
  🟢 error-fixer
     File: error.jsonl
     State: idle
     Processed: 12 changes
     Last activity: 2m ago
```

## Programmatic Use from Core

When you need to monitor a file and react to changes:

```bash
# Spawn watcher in background
tx watch <file> --mesh <mesh-name> -d

# The mesh will receive delta messages
# You'll get completion messages back
# Continue with your work while watcher runs
```

## Important Notes

1. **Delta tracking**: Watchers only send NEW content, not the entire file
2. **Debounce**: Changes are batched with 1s delay to avoid spam
3. **Queue**: Rapid changes are queued, not dropped
4. **Persistence**: Watcher state survives restarts
5. **File rotation**: Automatically detects and handles file truncation

## Best Practices

- **Mesh design**: Create meshes specifically for watching (e.g., `error-fixer`, `log-analyzer`)
- **Agent naming**: Use descriptive agent names (e.g., `coordinator`, `analyzer`)
- **Completion messages**: Always send completion/task-complete messages back
- **Background mode**: Use `-d` when calling from core or other agents

## Example Workflow

```bash
# 1. Create an error-fixer mesh (if it doesn't exist)
# 2. Start watching
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer -d

# 3. Errors appear in error.jsonl
# 4. Watcher extracts NEW errors
# 5. Sends delta to error-fixer mesh
# 6. error-fixer analyzes and fixes
# 7. Sends completion message
# 8. Watcher updates state
# 9. Repeat...
```

## Synonyms

When the user asks to:
- "monitor a file"
- "watch for changes"
- "track errors"
- "listen to logs"
- "observe file updates"

→ Use the **watch** capability!

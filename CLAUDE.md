TX Is an Agentic System indended to Augment a users thinking with LLM superpowers. Users hold the common thread between discrete ideas while you provide knowledge work which is:
 PACE: Parallelizable, Adaptable, Comprehensive, Extensible

## Quick Reference

- use `tx prompt <mesh> <agent>` to render prompts for testing
- Reset agent(s):
  - `tx reset <mesh>` - resets all agents in mesh
  - `tx reset <mesh> <agent>` - resets specific agent
  - Clears session and re-injects original prompt
- Read .ai/tx/logs/evidence.jsonl for agentic insights
- View event log: `tx msg` or `tx msg --follow`
- View session output: `tx session <mesh> <agent>`
- System stats: `tx stats`
- Health check: `tx health`

## Event Log Architecture

**Centralized event log**: All messages in `.ai/tx/msgs/`

- Filename format: `{mmddhhmmss}-{type}-{from-agent}>{to-agent}-{msg-id}.md`
- Example: `1102083000-task-core>interviewer-abc123.md`
- Use ONLY agent names in filenames (not full mesh/instance paths)
- Messages are immutable events in chronological log
- System delivers messages via EventLogConsumer
- Filenames are timestamped and self-describing

### Message Rules

- ✅ Write ONLY to: `.ai/tx/msgs/`
- ✅ Use MessageWriter class for all message creation
- ✅ Messages are append-only (never delete or modify)
- ❌ NO copying, NO moving - write to `.ai/tx/msgs/` only

### Documentation Rules
- Never put `tx spawn` in user-facing documentation. Use prompt language indented for core mesh instead. 
- Documentation should reflect the agent/prompt experience, not system internals

### Watcher Behavior

- Watcher injects file references via `@filepath` to destination agents
- Only file injection should happen via watcher
- Watcher writes delta messages to event log

### Session Capture

- Sessions automatically captured on shutdown: `.ai/tx/session/`
- Format: `{MMDDHHMMSS}-{mesh}-{agent}-{seq}.md`
- Captures full tmux pane history for debugging
- View with: `tx session <mesh> <agent>`

## CLI Tools

### Event Log Tools

```bash
# Interactive viewer (default)
tx msg
# Controls:
#   ↑↓ or j/k  - Navigate messages
#   Enter or → - View message detail
#   ← or Esc   - Back to list
#   a          - Attach to target agent (from message's "to" field)
#   f          - Toggle follow mode
#   q          - Quit
# In detail view:
#   ↑↓ or j/k  - Scroll by half page
#   a          - Attach to target agent

# Start with follow mode enabled
tx msg --follow

# Filter by type
tx msg --type task

# Filter by agent
tx msg --agent core

# Filter by time
tx msg --since 1h

# Simple list mode (no interactivity)
tx msg --no-interactive -v

# JSON output
tx msg --json
```

### Session Tools

```bash
# List all sessions
tx session list

# View latest session for mesh/agent
tx session <mesh> <agent>

# View today's sessions
tx session list --today

# Filter by mesh
tx session --mesh research
```

### Statistics

```bash
# Overall stats
tx stats

# Filter by mesh
tx stats --mesh research

# Filter by agent
tx stats --agent core

# JSON output
tx stats --json
```

### Health Monitoring

```bash
# Check system health
tx health

# Watch mode (auto-refresh)
tx health --watch

# JSON output
tx health --json
```

# Misc
- Do not offer to attach to sessions, you cannot. 
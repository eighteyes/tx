# Deprecated Commands

This document tracks commands and patterns that have been deprecated in favor of better approaches.

## tx ask <target> <question> - DEPRECATED

**Status:** Deprecated as of 2025-10-10
**Replaced by:** `tx route` with file-based outbox pattern

### Why Deprecated

The inline `tx ask` command encouraged writing messages as command arguments, which:
- Violated the file-based design philosophy
- Made long messages impractical
- Didn't generalize to other message types
- Was hard to audit and inspect

### Old Pattern (Deprecated)

```bash
# DON'T DO THIS
tx ask brain "What is the current architecture?"
```

### New Pattern (Use This)

```bash
# 1. Write message to YOUR outbox (file-based)
cat > .ai/tx/mesh/research/agents/researcher/msgs/outbox/ask-brain.md << 'EOF'
---
from: research/researcher
to: brain
type: ask
id: q001
---

## Question
What is the current architecture?
EOF

# 2. Route it
tx route
```

### Benefits of New Pattern

- ✅ File-based (inspectable, auditable)
- ✅ Works for any message type (ask, response, update, etc.)
- ✅ Supports long, complex messages
- ✅ Prevents inline message writing anti-pattern
- ✅ Generic and extensible

## Message.ask() API - DEPRECATED for CLI use

**Status:** Still exists for programmatic use, but CLI should use `tx route`
**CLI Alternative:** Write to outbox + `tx route`

The `Message.ask()` programmatic API still exists for internal system use, but agents should use the file-based outbox pattern instead.

## Direct Inbox Writes - DEPRECATED

**Status:** Deprecated in favor of outbox pattern
**Replaced by:** Write to your own outbox, let system route

### Old Pattern (Deprecated)

```bash
# DON'T DO THIS - writing to other agent's inbox directly
cat > .ai/tx/mesh/brain/msgs/inbox/message.md << 'EOF'
...
EOF
```

### New Pattern (Use This)

```bash
# Write to YOUR outbox, system routes based on 'to:' field
cat > .ai/tx/mesh/research/agents/researcher/msgs/outbox/message.md << 'EOF'
---
to: brain
---
...
EOF

tx route
```

## See Also

- [tx route Documentation](docs/tx-route-command.md)
- [Outbox Pattern](docs/outbox-pattern.md)
- [Ask Capability](meshes/prompts/capabilities/ask.md)
- [Respond Capability](meshes/prompts/capabilities/respond.md)

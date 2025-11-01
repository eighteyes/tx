# Hello World Example

The simplest TX mesh - a basic echo agent that receives a message and responds.

---

## What You'll Learn

- How to create a minimal mesh
- How to write an agent prompt
- How to test message routing
- How to read agent responses

---

## Files Included

```
hello-world/
├── README.md              # This file
├── mesh-config.json       # Mesh configuration
└── agent-prompt.md        # Agent prompt template
```

---

## Step 1: Create Mesh Config

Create `meshes/mesh-configs/hello-world.json`:

```json
{
  "mesh": "hello-world",
  "type": "sequential",
  "description": "Simple echo mesh for testing basic TX functionality",
  "agents": ["greeter"],
  "entry_point": "greeter",
  "completion_agent": "greeter",
  "capabilities": [],
  "routing": {
    "greeter": {
      "complete": {
        "core": "Greeting complete"
      }
    }
  }
}
```

**Key fields:**
- `mesh`: Unique identifier
- `agents`: List of agents in this mesh
- `entry_point`: First agent to receive messages
- `routing`: Defines message flow

---

## Step 2: Create Agent Prompt

Create `meshes/agents/hello-world/greeter/prompt.md`:

```markdown
# Greeter Agent

You are the greeter agent in the hello-world mesh.

## Your Role

When you receive a message, respond with a friendly greeting.

## Response Format

Always respond with:

1. A friendly greeting
2. Acknowledgment of the user's message
3. A task-complete message back to core

## Example

If you receive:
> "Hello, TX!"

Respond with a task-complete message:

---
to: core/core
from: hello-world/greeter
type: task-complete
status: complete
msg-id: [generate-unique-id]
headline: Greeting sent
---

# Hello!

Thank you for your message: "Hello, TX!"

I'm the greeter agent, and I'm here to demonstrate basic TX functionality.

**Your message has been received and acknowledged.**
```

---

## Step 3: Test the Mesh

### 1. Start TX

```bash
tx start
```

### 2. Spawn Hello World Mesh

Inside core:
```
spawn hello-world mesh with message "Hello from the user!"
```

### 3. Observe the Output

You'll see:
```
🚀 Spawning hello-world/greeter...
✅ Agent validated: greeter
📦 Creating tmux session...
✅ Session hello-world created
📝 Building agent prompt...
✅ Prompt injected
✅ hello-world/greeter spawned!
```

### 4. Wait for Response

The greeter agent will process the message and respond to core:

```
📬 New message from hello-world/greeter:

---
from: hello-world/greeter
to: core/core
type: task-complete
status: complete
---

# Hello!

Thank you for your message: "Hello from the user!"

I'm the greeter agent, and I'm here to demonstrate basic TX functionality.

**Your message has been received and acknowledged.**
```

---

## Step 4: Inspect the Messages

### View Core's Outgoing Message

```bash
ls -lt .ai/tx/mesh/core/agents/core/msgs/ | head -5
cat .ai/tx/mesh/core/agents/core/msgs/task-hello-world-001.md
```

### View Greeter's Response

```bash
ls -lt .ai/tx/mesh/hello-world/agents/greeter/msgs/ | head -5
cat .ai/tx/mesh/hello-world/agents/greeter/msgs/response-001.md
```

---

## Step 5: Attach to Observe (Optional)

```bash
# In another terminal
tx attach hello-world

# Watch the agent work in real-time
# Press Ctrl+B, D to detach
```

---

## What Happened?

1. **Core wrote message** → `.ai/tx/mesh/core/agents/core/msgs/task-hello-world-001.md`
2. **Watcher detected** new file
3. **Validator checked** frontmatter
4. **Router determined** target: `hello-world/greeter`
5. **System injected** `@filepath` reference to greeter session
6. **Greeter read** and processed message
7. **Greeter wrote response** → `.ai/tx/mesh/hello-world/agents/greeter/msgs/response-001.md`
8. **System routed** response back to core
9. **Core displayed** response

**No files moved, no copies created, perfect audit trail.**

---

## Variations to Try

### 1. Multiple Messages

```
send another message to hello-world: "How are you?"
```

### 2. Attach and Watch

```bash
tx attach hello-world
# Send message from core
# Watch greeter process in real-time
```

### 3. Modify Agent Behavior

Edit `meshes/agents/hello-world/greeter/prompt.md` to change greeting style, then:

```bash
tx stop hello-world
tx spawn hello-world
```

---

## Cleanup

```bash
# Stop the mesh
tx stop hello-world

# Or stop all meshes
tx stop
```

---

## Next Steps

- **[Error Monitoring Example](../error-monitoring/)** - Watch files and auto-fix errors
- **[Code Review Example](../code-review/)** - Parallel agent workflows
- **[Custom Mesh Example](../custom-mesh/)** - Build your own mesh

---

## Troubleshooting

### Issue: Mesh doesn't spawn

**Solution:**
```bash
# Verify config exists
cat meshes/mesh-configs/hello-world.json

# Check for JSON errors
cat meshes/mesh-configs/hello-world.json | jq .
```

### Issue: No response from greeter

**Solution:**
```bash
# Attach to see what's happening
tx attach hello-world

# Check error logs
tx logs error
```

---

**Questions?** See [Troubleshooting Guide](../../new/troubleshooting.md)

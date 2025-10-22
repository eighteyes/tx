# Message Processing Workflow

1. Wait for messages to arrive via file system injection (@filepath)
2. Read and process incoming messages from your inbox
3. Use `.ai/tx/mesh/{{mesh}}/workspace/` for work artifacts
4. Write response messages with proper frontmatter (type, status, to, from)
5. Save output messages to `.ai/tx/mesh/{{mesh}}/agents/{{agent}}/msgs/outbox/`

**IMPORTANT**: You are a reactive agent. Do NOT ask for tasks or interact with users directly. Wait for messages to be injected via the system.

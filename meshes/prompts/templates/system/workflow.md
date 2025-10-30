# Message Processing Workflow

1. Wait for messages to arrive via file system injection (@filepath)
2. Read and process incoming messages from their original locations
3. Use `.ai/tx/mesh/{{mesh}}/workspace/` for work artifacts
4. Write response messages with proper frontmatter (type, status, to, from)
5. Save output messages to `.ai/tx/mesh/{{mesh}}/agents/{{agent}}/msgs/`

**CRITICAL CONSTRAINTS**:
- ❌ NEVER move or copy message files between agents
- ❌ NEVER write to other agents' msgs/ directories
- ✅ Messages stay where created - system injects references only
- ✅ You are reactive - wait for @filepath injections, don't ask for tasks

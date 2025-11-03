# Message Processing Workflow

1. Wait for messages to arrive via file system injection (@filepath)
2. Read and process incoming messages from their original locations
3. Use `.ai/tx/mesh/{{mesh}}/workspace/` for work artifacts
4. Write response messages with proper frontmatter (type, status, to, from)
5. Save output messages to `.ai/tx/msgs/` using centralized filename format:
   - Format: `{MMDDHHMMSS}-{from-mesh}-{from-agent}-{to-mesh}-{to-agent}-{type}-{msg-id}.md`
   - Example: `1102083000-core-core-research-interviewer-task-abc123.md`
   - Timestamp: MMDDHHMMSS (Month Day Hour Minute Second)
   - Replace slashes with hyphens in agent names

**CRITICAL CONSTRAINTS**:
- ❌ NEVER move or copy message files between agents
- ✅ Write to centralized log: `.ai/tx/msgs/`
- ✅ Use proper filename format for message routing
- ✅ Messages routed automatically by centralized event log system
- ✅ You are reactive - wait for @filepath injections, don't ask for tasks

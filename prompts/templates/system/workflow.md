# Workflow Instructions

## Single-Agent Workflow
1. Receive task in `.ai/tx/mesh/{{mesh}}/agents/{{agent}}/msgs/active/`
2. Read and process the message
3. Save output to `.ai/tx/mesh/{{mesh}}/shared/output/`
4. Mark complete with frontmatter message
5. Task transitions to core

## Multi-Agent Workflow (Sequential)
For workflows like: researcher → analyzer → reporter

1. **Agent receives task**
   - Check `msgs/active/` for incoming message
   - Parse YAML frontmatter
   - Extract task requirements

2. **Agent processes task**
   - Do your work
   - Save intermediate results to shared output
   - Follow the specific instructions in your agent prompt

3. **Mark task complete**
   - Create message with frontmatter
   - Set `type: task-complete`
   - Save to `msgs/outbox/`
   - Include any context for next agent

4. **Handoff to next agent**
   - System automatically creates handoff message
   - Advances workflow to next agent
   - Next agent finds task in their `msgs/active/`

## Error Handling
- If task is malformed, save error details and mark failed
- Include specific error messages in response
- For retriable errors, include suggestions for retry

## Available Tools
- **Search**: Use `/search "query"` to search web via SearXNG
- **Ask**: Use `/ask agent-name "question"` to consult other agents
- **File paths**: Always use absolute paths starting with `.ai/tx/`

## Tips
- Save frequently to avoid losing work
- Use clear, structured output format
- Include reasoning in your responses
- Update state.json if workflow-specific

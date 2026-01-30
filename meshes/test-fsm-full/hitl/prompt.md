# HITL Agent
# Tests human-in-the-loop self-loop pattern
# Responsibilities: message core, write hitl-complete.yaml on response

<role>
You are the HITL test agent. Send a question to core, wait for response, then write your completion file.
</role>

## Workflow

1. Send a message to `core/core`:
```
HITL test: Please respond to confirm the loop works.
```

2. When you receive a response from core, write `hitl-complete.yaml` to workspace:
```yaml
hitl: complete
response_received: true
```

3. FSM gates on `hitl-complete.yaml` to exit the HITL state.

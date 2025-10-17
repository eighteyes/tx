# Ask Workflow - Inter-Agent Communication

## Overview

The **Ask Workflow** enables agents to query other agents during task execution. Ask messages bypass the normal queue and use **fast-track** processing for immediate response.

## Workflow Steps

### Agent A asks Agent B

```
1. Agent A is working on a task
   ↓
2. Agent A needs information from Agent B
   ↓
3. Agent A writes ask message to its outbox:
   type: ask
   to: mesh/agent-b
   msg-id: unique-id
   ↓
4. Watcher detects ask message
   ↓
5. EventBus emits file:ask:new event (FAST-TRACK)
   ↓
6. Ask message bypasses next queue
   ↓
7. Ask message goes directly to Agent B's inbox
   ↓
8. (Optional) Wait for Agent B to be idle (~1 min check)
   ↓
9. Inject ask file to Agent B's tmux session
   ↓
10. Agent B processes question
    ↓
11. Agent B writes ask-response to its outbox:
    type: ask-response
    to: mesh/agent-a
    msg-id: same-unique-id
    ↓
12. Watcher detects ask-response
    ↓
13. Ask-response goes to Agent A's inbox (FAST-TRACK)
    ↓
14. Agent A receives response and continues working
```

## Message Format

### Ask Message
Agent A asks Agent B:

```markdown
---
from: mesh/agent-a
to: mesh/agent-b
type: ask
msg-id: q-12345
status: pending
timestamp: 2025-10-17T06:00:00Z
---

# Question from agent-a

I need help with: [specific question]

Can you provide: [what information is needed]?
```

### Ask Response
Agent B responds:

```markdown
---
from: mesh/agent-b
to: mesh/agent-a
type: ask-response
msg-id: q-12345
status: completed
timestamp: 2025-10-17T06:01:00Z
---

# Response

Here's the information you requested:

[answer]
```

## Implementation

### Creating Ask Messages (in lib/queue.js)

```javascript
// Route ask message from one agent to another
Queue.handleAskMessage(
  mesh,           // 'researcher'
  fromAgent,      // 'analyzer'
  toAgent,        // 'searcher'
  msgId,          // 'q-12345'
  question        // "What were the search results?"
);

// Route ask response back
Queue.handleAskResponse(
  mesh,           // 'researcher'
  toAgent,        // 'analyzer'
  msgId,          // 'q-12345'
  response        // "Found 10 articles on..."
);
```

### Watcher Detection (in lib/watcher.js)

Ask messages are detected by filename pattern:
- Ask: `*-ask-{msgId}.md` in inbox
- Response: `*-ask-response-{msgId}.md` in inbox

Special events emitted:
- `file:ask:new` - Ask message received (fast-track)
- `file:ask-response:new` - Response received (fast-track)

### Event Handling (in lib/queue.js)

```javascript
// Fast-track ask messages
EventBus.on('file:ask:new', ({ mesh, agent, file }) => {
  // Ask message bypasses normal queue
  // Goes directly to agent for fast processing
});

// Fast-track ask responses
EventBus.on('file:ask-response:new', ({ mesh, agent, file }) => {
  // Response delivered to requesting agent
});
```

## Use Cases

### 1. Collaboration Search
```
Reporter needs context from Searcher
→ Reporter: "What sources mentioned climate change?"
← Searcher: "Found 5 sources in economics section"
→ Reporter continues writing report with context
```

### 2. Validation Query
```
Analyst needs verification from Checker
→ Analyst: "Is this data consistent?"
← Checker: "Data is consistent, confidence 95%"
→ Analyst includes verification in findings
```

### 3. Cross-Reference Check
```
Writer needs confirmation from Researcher
→ Writer: "Can you confirm the date of X?"
← Researcher: "Date is 2025-10-15, verified in sources"
→ Writer updates document with confirmed date
```

## Benefits

✅ **Non-blocking**: Doesn't require handoff to next agent
✅ **Fast-track**: Bypasses normal queue delays
✅ **Context Preservation**: Asking agent continues in same session
✅ **Asynchronous**: Asked agent doesn't pause current work
✅ **Trackable**: msg-id ensures proper response matching

## Timing Constraints

- **Check Interval**: ~1 minute to verify agent B is idle before injection
- **Timeout**: No hard timeout (agents can take time to respond)
- **Response Expected**: Ask responses are expected but not required
- **Non-blocking**: Asking agent won't block on response

## Files & Directories

### Message Storage
```
.ai/tx/mesh/{mesh}/agents/{agent}/msgs/inbox/
├── {timestamp}-ask-{msgId}.md          # Incoming questions
├── {timestamp}-ask-response-{msgId}.md # Incoming responses
└── ...
```

### Ask Message Lifecycle
```
1. Created by asking agent in outbox
2. Detected by watcher (file:ask:new event)
3. Routed to answering agent's inbox (fast-track)
4. Answering agent processes
5. Answering agent writes response to outbox
6. Response detected by watcher (file:ask-response:new event)
7. Response routed to asking agent's inbox (fast-track)
8. Complete - asking agent receives response
```

## Example: Multi-Agent Collaboration

### Setup
```
Mesh: research-project
Agents: searcher, analyzer, writer
```

### Workflow
```
1. Searcher completes search → sends results to Analyzer
2. Analyzer starts analyzing
3. Analyzer needs clarification:
   → ask: "Was page 5 about climate policy?"
   ← Searcher: "Yes, climate policy section"
4. Analyzer continues analysis
5. Analyzer sends to Writer
6. Writer is writing report
7. Writer needs quote:
   → ask: "What was the exact quote about emissions?"
   ← Analyzer: "The exact quote is: '...emissions...'"
8. Writer includes quote
9. Writer completes report
```

## Error Handling

### Ask Message Not Delivered
- Message saved to agent inbox
- Agent will process when available
- No error thrown (eventually consistent)

### Response Not Received
- Asking agent continues after timeout
- Ask message remains in history
- Can resend ask if needed

### Invalid Message ID
- msg-id mismatch between ask and response
- Response treated as separate ask
- Original response lost

## Best Practices

1. **Use meaningful msg-ids**: `q-search-urls`, `q-verify-date`
2. **Keep questions concise**: Single question per ask
3. **Include context**: Asking agent should explain why question is asked
4. **Graceful degradation**: Asking agent should work without response
5. **Timeout handling**: Agent should continue after ~1 min if no response

## API Reference

### Queue.handleAskMessage()
```javascript
Queue.handleAskMessage(mesh, fromAgent, toAgent, msgId, question)
// Returns: filename
// Emits: file:ask:new event
```

### Queue.handleAskResponse()
```javascript
Queue.handleAskResponse(mesh, toAgent, msgId, response)
// Returns: filename
// Emits: file:ask-response:new event
```

### Watcher Detection
```javascript
// Watcher automatically detects:
// - file:ask:new when *-ask-{msgId}.md added to inbox
// - file:ask-response:new when *-ask-response-{msgId}.md added
```

### Queue Event Listeners
```javascript
// Registered in Queue.init()
EventBus.on('file:ask:new', handler)
EventBus.on('file:ask-response:new', handler)
```

## Testing Ask Workflow

### Test: Ask Message Routing
```bash
# Create two agents
tx spawn research searcher --init "Search for X"
tx spawn research analyzer

# In Analyzer:
# 1. Call Queue.handleAskMessage('research', 'analyzer', 'searcher', 'q-1', 'Were results found?')
# 2. Verify message appears in Searcher's inbox
# 3. Message filename contains "-ask-q-1"
```

### Test: Response Routing
```bash
# In Searcher:
# 1. Write ask-response to outbox
# 2. Verify response appears in Analyzer's inbox
# 3. Response filename contains "-ask-response-q-1"
```

## Troubleshooting

### Ask Message Not Appearing
```
Check: .ai/tx/mesh/{mesh}/agents/{toAgent}/msgs/inbox/
Look for: *-ask-*.md files
Debug: tail -f .ai/tx/logs/debug.jsonl | grep ask
```

### Response Not Received
```
Check: Was response written to outbox?
Check: Does response msg-id match ask msg-id?
Check: Is response in asker's inbox?
```

### Event Not Fired
```
Check: Watcher running? (tx status)
Check: Ask message filename pattern?
Check: EventBus listeners registered? (Queue.init() called?)
```

## Future Enhancements

- [ ] Ask timeout handling
- [ ] Response expiry tracking
- [ ] Ask/response history
- [ ] Batch ask support
- [ ] Ask priority levels
- [ ] Ask response caching

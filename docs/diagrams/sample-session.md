# Sample Session Flow

Step-by-step sequence diagram showing a typical workflow from user request to task completion.

```mermaid
sequenceDiagram
    participant User
    participant Core as Core Agent
    participant EventLog as Event Log
    participant Consumer as Event Consumer
    participant Tmux as Tmux Session
    participant Agent as Research Agent

    User->>Core: "Research topic X"
    Note over Core: Analyzes request<br/>Decides to delegate

    Core->>EventLog: Write task message<br/>to: research-abc123/searcher<br/>type: task
    Note over EventLog: Message stays in<br/>.ai/tx/msgs/

    Consumer->>EventLog: Watching for messages
    EventLog-->>Consumer: New message detected
    Note over Consumer: Filters: Is this for me?<br/>Checks offset

    Consumer->>Consumer: Load offset<br/>Check not processed
    Consumer->>Tmux: Inject @filepath
    Note over Tmux: File reference injected<br/>to agent's session

    Tmux->>Agent: Delivers message
    Note over Agent: Reads message<br/>Processes task

    Agent->>Agent: Executes web search
    Agent->>Agent: Analyzes results

    Agent->>EventLog: Write task-complete message<br/>to: core<br/>status: complete
    Note over EventLog: Response added to log

    Consumer->>Consumer: Update offset<br/>timestamp of last processed

    Core->>EventLog: Watching for responses
    EventLog-->>Core: New task-complete detected
    Core->>Core: Process completion

    Core->>User: "Here are the results..."
    Note over User: Task complete!
```

## Description

This diagram shows the complete flow of a typical task in TX:

1. **User Request** - User asks core agent to research a topic
2. **Task Delegation** - Core creates a task message for research agent
3. **Message Writing** - Task written to event log (`.ai/tx/msgs/`)
4. **Consumer Detection** - Research agent's consumer detects new message
5. **Offset Check** - Consumer verifies message hasn't been processed yet
6. **Message Injection** - Consumer injects file reference into tmux session
7. **Agent Processing** - Agent reads message, executes task
8. **Response Writing** - Agent writes task-complete message to event log
9. **Offset Update** - Consumer updates its offset (last processed timestamp)
10. **Core Notification** - Core's consumer detects task-complete message
11. **User Response** - Core delivers results back to user

**Key Concepts**:
- **Stay-in-place**: Messages never move, only file references (`@filepath`) injected
- **Asynchronous**: Agent processing happens independently
- **Event-driven**: Event log is central communication hub
- **Stateless consumers**: Offset tracking enables restart without reprocessing

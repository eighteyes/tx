# Event Log Consumer Architecture

Detailed view of how event log consumers work to deliver messages to agents.

```mermaid
flowchart TD
    Start([Consumer Starts]) --> LoadOffset[Load Offset from Disk<br/>.ai/tx/state/offsets/]
    LoadOffset --> ScanExisting[Scan Existing Messages<br/>in .ai/tx/msgs/]

    ScanExisting --> FilterExisting{Filter:<br/>For me?<br/>Not processed?}
    FilterExisting -->|Yes| ProcessExisting[Process Existing<br/>Messages]
    FilterExisting -->|No| StartWatch[Start Watching<br/>.ai/tx/msgs/]

    ProcessExisting --> StartWatch

    StartWatch --> WatchLoop{New file<br/>detected?}
    WatchLoop -->|Yes| ParseMessage[Parse Message<br/>Frontmatter]

    ParseMessage --> FilterNew{Filter:<br/>to: this-agent?}
    FilterNew -->|Yes| CheckOffset{Check Offset:<br/>Already processed?}
    FilterNew -->|No| WatchLoop

    CheckOffset -->|Already processed| WatchLoop
    CheckOffset -->|New message| SpecialHandling{Special<br/>handling?}

    SpecialHandling -->|self-modify| ClearAndModify[Clear context<br/>Apply modifications]
    SpecialHandling -->|clear-context| ClearContext[Clear context<br/>/clear command]
    SpecialHandling -->|lens| ApplyLens[Apply lens<br/>perspective]
    SpecialHandling -->|clear-before task| ResetCheck[Check mesh config<br/>clear-before: true?]
    SpecialHandling -->|Normal message| InjectFile[Inject file reference<br/>@filepath into tmux]

    ClearAndModify --> InjectFile
    ClearContext --> InjectFile
    ApplyLens --> InjectFile

    ResetCheck -->|Yes| ResetSession[Reset Session<br/>/clear + re-inject prompt]
    ResetCheck -->|No| InjectFile
    ResetSession --> InjectFile

    InjectFile --> UpdateOffset[Update Offset<br/>timestamp = msg.timestamp]
    UpdateOffset --> SaveOffset[Save Offset to Disk]
    SaveOffset --> WatchLoop

    style Start fill:#e1ffe1
    style InjectFile fill:#e1f5ff
    style UpdateOffset fill:#ffe1e1
    style WatchLoop fill:#fff4e1
```

## Description

Event log consumers are the core delivery mechanism in TX. Each agent has one consumer that:

**Initialization Phase**:
1. **Load Offset** - Read last processed timestamp from `.ai/tx/state/offsets/`
2. **Scan Existing** - Process any messages written while consumer was offline
3. **Start Watching** - Begin watching `.ai/tx/msgs/` for new files

**Processing Loop**:
1. **Detect New File** - Chokidar file watcher triggers on new `.md` files
2. **Parse Message** - Extract frontmatter (to, from, type, status, msg-id)
3. **Filter** - Check if message is addressed to this agent
4. **Check Offset** - Verify message timestamp > last processed timestamp
5. **Special Handling** - Apply any special directives:
   - `self-modify: true` - Clear context and apply prompt modifications
   - `clear-context: true` - Run `/clear` command before injection
   - `lens: <lens-name>` - Apply cognitive lens perspective
   - `clear-before` + `task` - Reset session if mesh config has `clear-before: true`
6. **Inject File** - Inject file reference (`@filepath`) into tmux session
7. **Update Offset** - Record message timestamp as last processed
8. **Save Offset** - Persist offset to disk for restart safety

**Key Features**:
- **Restart Safe** - Offset tracking prevents duplicate message delivery
- **Chronological** - Messages processed in timestamp order
- **Idempotent** - Can restart consumer without side effects
- **Isolated** - Each agent's consumer runs independently
- **Efficient** - File watching prevents polling

**Consumer State**:
- Offset file: `.ai/tx/state/offsets/{mesh}-{agent}.json`
- Contains: `{ agentId, lastProcessedTimestamp, updatedAt }`
- Atomic writes ensure consistency

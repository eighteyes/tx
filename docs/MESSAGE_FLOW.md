# Message Flow

## Incoming Messages (Mesh Level)
```
inbox (wait) > next (queue) > active (process) > complete (done)
```

## Incoming Messages (Agent Level)
```
inbox (wait) > next (queue) > active (process) > complete (done)
```

## Outgoing Messages (Response Routing)
```
outbox (send) > destination_inbox / complete (done)
```

---

## Full Example: Agent-to-Agent Communication

### Step 1: MeshA sends task to AgentB
```
MeshA:
  inbox > next > active > complete

AgentB:
  inbox (receives task from MeshA)
```

### Step 2: AgentB processes
```
AgentB:
  inbox > next > active
```

### Step 3: AgentB creates response
```
AgentB outbox > destination_inbox (goes to reply-to agent)
```

### Step 4: Response is routed to AgentA
```
AgentA:
  inbox (receives response from AgentB) > next > active > complete
```

---

## Complete 2-Agent Workflow

```
AGENT-A                          AGENT-B
inbox > next > active > outbox   inbox > next > active > outbox
        ↓                                ↓
    (processes)                     (processes)
        ↓                                ↓
    complete <-- routed from B    complete <-- routed from A
```

---

## 3-Agent Chain

```
AGENT-1
inbox > next > active > outbox
                           ↓
                    AGENT-2 inbox
                           ↓
                    inbox > next > active > outbox
                                              ↓
                                       AGENT-3 inbox
                                              ↓
                                       inbox > next > active > complete
```

---

## With Task UID Suffix

```
tx spawn core core -i "analyze codebase"
                           ↓
                    generateUID("ac01")
                           ↓
FOLDER: core-ac01/msgs/
  inbox (ac01 task) > next > active > complete
```

---

## Message States

| State | Location | Status |
|-------|----------|--------|
| inbox | .../msgs/inbox/ | Waiting to be queued |
| next | .../msgs/next/ | Queued, not started |
| active | .../msgs/active/ | Processing now |
| complete | .../msgs/complete/ | Done |
| outbox | .../msgs/outbox/ | Response waiting to route |

---

## Quick Reference

**Incoming** (receive & process):
```
inbox > next > active > complete
```

**Outgoing** (send response):
```
outbox > recipient_inbox
```

**Multi-agent**:
```
Agent-1 outbox > Agent-2 inbox > Agent-2 next > Agent-2 active > Agent-2 outbox > response
```

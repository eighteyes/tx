# Prespawn: Haiku Agent Task Interpretation

## Concept Overview

A **prespawn** agent is a lightweight (Haiku) agent that interprets/refines user tasks before they reach the main agent. This acts as a "task router" or "clarifier" that:

1. Receives raw user input/tasks
2. Interprets intent, clarifies ambiguities, and normalizes formatting
3. Produces a structured, actionable task description
4. Routes the refined task to the appropriate main agent

## Problem It Solves

**Current Flow:**
```
User Task → Queue → Main Agent (Claude Opus)
```

**Issues:**
- Main agent (Opus) uses expensive tokens on task interpretation
- Poorly formatted or ambiguous tasks waste main agent capacity
- No task validation or intent detection before expensive processing
- Task normalization happens inside expensive agent loop

**Proposed Flow:**
```
User Task → Haiku Prespawn → Queue → Main Agent (Opus)
```

**Benefits:**
- Cost optimization: Haiku processes trivial interpretation
- Faster turnaround: Haiku is quicker for simple operations
- Better quality: Tasks arrive structured and validated
- Reduced main agent hallucination from unclear inputs
- Single source of truth for task format/structure

## Architecture Options

### Option A: Separate Prespawn Mesh
```
tx spawn prespawn my-task --target core
  ↓
Prespawn Haiku interprets
  ↓
Routes to `core` mesh
  ↓
Core Opus processes refined task
```

**Pros:**
- Completely independent
- Can scale prespawn separately
- Clear separation of concerns
- Can be enabled/disabled per mesh

**Cons:**
- Extra spawning step for users
- More complexity in routing logic
- Additional queue management

### Option B: Built-in Prespawn in Spawn Command
```
tx spawn core --prespawn
  ↓
1. Spawns Haiku prespawn session
2. Sends task to prespawn
3. Waits for interpretation
4. Routes refined task to main agent
5. Cleans up prespawn session
```

**Pros:**
- Single command for user
- Automatic cleanup
- Seamless integration
- Optional flag for existing workflows

**Cons:**
- More logic in spawn.js
- Blocking operation (slower)
- Prespawn must be fast or defeats purpose

### Option C: Message Queue Preprocessing Hook
```
Core System
├── Queue Listener
├── Prespawn Router (middleware)
├── Main Agent Router
```

When a message enters inbox:
1. Check if mesh/agent has prespawn enabled
2. Route to prespawn if configured
3. Wait for prespawn completion
4. Route refined message to main agent

**Pros:**
- Completely transparent to user
- Can be toggled per mesh/agent
- Automatic cleanup
- Scales naturally

**Cons:**
- Most architectural change
- Hidden behavior (could confuse users)
- Hardest to debug

## Implementation Details

### Prespawn Agent Prompt Structure

```markdown
## Role
You are a task interpreter. Your job is to clarify, structure, and refine user tasks.

## Task Format
Input: Raw user request
Output: Structured task JSON

## Output Structure
{
  "original": "user's raw input",
  "interpreted": "what they actually want",
  "confidence": 0.95,
  "target_agent": "which agent should handle this",
  "priority": "high|medium|low",
  "tags": ["tag1", "tag2"],
  "questions": ["clarifications needed"],
  "suggested_approach": "how to execute this"
}

## Guidelines
1. Be concise - use Haiku efficiently
2. Flag ambiguities with questions field
3. Suggest the best execution path
4. Preserve user intent exactly
```

### Config Structure (in mesh config)

```json
{
  "mesh": "core",
  "prespawn_enabled": true,
  "prespawn_config": {
    "model": "claude-haiku-4-5",
    "timeout": 10,
    "cache_results": true
  }
}
```

### Message Flow with Prespawn

```javascript
// Before spawn
Message.send('core', 'Build me a thing', 'User task');

// Queue inbox receives task
// Prespawn router intercepts
// 1. Spawns Haiku prespawn session
// 2. Sends task: "Build me a thing"
// 3. Gets structured response
// 4. Archives prespawn message
// 5. Queues refined task for main agent
// 6. Kills prespawn session

// Main agent receives already-interpreted task
```

## Data Structures

### In `.ai/tx/mesh/{mesh}/config.json`

```json
{
  "mesh": "core",
  "prespawn": {
    "enabled": true,
    "model": "claude-haiku-4-5",
    "timeout_seconds": 10,
    "cache": true
  }
}
```

### Prespawn Agent Config

```json
{
  "name": "prespawn",
  "description": "Task interpreter and router",
  "role": "prespawn",
  "model": "claude-haiku-4-5",
  "capabilities": [],
  "no_queue": true
}
```

### Prespawn Message Format

Message sent to prespawn:
```markdown
# Original Task
[User's raw task]

---

# Instructions
Interpret this task and provide structured guidance.
```

Response from prespawn (parsed JSON):
```json
{
  "status": "ready",
  "task": "interpreted task",
  "priority": "high",
  "target": "core",
  "notes": "any clarifications or concerns"
}
```

## Implementation Path

### Phase 1: Basic Prespawn (Option A - Separate Mesh)
1. Create `meshes/mesh-configs/prespawn.json`
2. Create `meshes/agents/prespawn/prespawn/` structure
3. Write prespawn prompt template
4. Test manual flow: `tx spawn prespawn "task" --output json`

### Phase 2: Integrated Spawn Option (Option B)
1. Add `--prespawn` flag to `tx spawn`
2. Implement prespawn + main agent sequential spawn
3. Handle message routing between them
4. Auto-cleanup prespawn session

### Phase 3: Queue Middleware (Option C)
1. Create `PrespawnRouter` middleware
2. Integrate into queue listener
3. Make configurable per mesh
4. Add logging and metrics

## Use Cases

### 1. Task Clarification
```
User: "Make the thing faster"
Prespawn: "Target: performance optimization. Needs: code location, metrics baseline, constraints"
```

### 2. Intent Routing
```
User: "Write a test for that feature"
Prespawn: "Route to: test-agent. Type: unit test. File: src/feature.test.js"
```

### 3. Format Normalization
```
User: "CONVERT THIS JSON to yaml format --pretty"
Prespawn: "Task: Format conversion. Source: JSON. Target: YAML. Style: pretty-print"
```

### 4. Multi-Step Decomposition
```
User: "Set up a new project with auth and database"
Prespawn: "Sequence: 1) scaffold 2) add-auth 3) add-db 4) test-integration"
```

## Tradeoffs

| Aspect | Option A (Separate) | Option B (Flag) | Option C (Middleware) |
|--------|-------------------|-----------------|----------------------|
| User Complexity | High (2 commands) | Low (1 flag) | None (transparent) |
| Dev Complexity | Low | Medium | High |
| Performance | Best (parallel) | Worst (sequential) | Good (cached) |
| Discoverability | Poor | Good | None (hidden) |
| Controllability | Full | Full | Limited |
| Flexibility | High | Medium | Low |
| Cost Savings | Yes (explicit) | Yes (automatic) | Yes (automatic) |

## Recommended Path

**Start with Option A (Separate Prespawn Mesh):**
- Lowest implementation risk
- Easiest to test and validate concept
- Full user control
- Can migrate to B or C later
- Data for ROI analysis (token savings)

**Experiment with these patterns:**
1. Manual prespawn for specific high-value tasks
2. Track token savings vs baseline
3. Measure quality improvements
4. Build usage data
5. Then decide on Option B or C

## Questions to Answer

1. **How fast must prespawn complete?** (latency budget)
2. **What's the ROI threshold?** (savings vs complexity)
3. **Should output be JSON or markdown?** (for routing logic)
4. **Cache strategy?** (deduplicate identical tasks)
5. **Error handling?** (if prespawn fails, what happens?)
6. **User feedback loop?** (learn from main agent corrections?)
7. **Multi-turn with prespawn?** (clarifying questions to user?)

## Example Configuration

```javascript
// meshes/mesh-configs/core.json
{
  "mesh": "core",
  "prespawn": {
    "enabled": false,  // toggle on/off
    "model": "claude-haiku-4-5-20251001",
    "timeout": 10,
    "cache_ttl": 3600
  },
  "agents": ["core/core"]
}

// Usage
tx spawn core --prespawn  // Enable for this run
tx spawn core             // Use default (disabled)
```

## Next Steps

1. **Prototype Option A** - Create prespawn mesh and test with sample tasks
2. **Measure baseline** - Track current main agent task interpretation time/tokens
3. **Compare results** - Run same tasks through prespawn + main vs main alone
4. **Build routing logic** - How does prespawn output feed to main agent?
5. **User testing** - Is the pattern intuitive?
6. **Scale decision** - Based on results, choose Option B or C for broader adoption

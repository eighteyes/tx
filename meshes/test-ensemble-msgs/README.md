# test-ensemble-msgs

Test mesh demonstrating message-based ensemble pattern with parallel task execution.

## Purpose

Validate that the FSM ensemble pattern correctly:
- Spawns multiple workers in parallel
- Collects results from message bodies (not workspace files)
- Aggregates results into unified output
- Routes back to core upon completion

## Architecture

```
User Task
    ↓
  entry (haiku)
    ↓
  [FSM spawns parallel ensemble]
    ↓
    ├─→ worker-1 (haiku) → Feasibility Analysis
    ├─→ worker-2 (haiku) → User Value Analysis
    └─→ worker-3 (haiku) → Architecture Analysis
         ↓ (all complete)
    aggregator (sonnet)
         ↓
    core/core
```

## Workflow

1. **Entry State**: Entry agent receives task, writes to `{workspace}/task.md`
2. **Parallel Analysis State** (FSM ensemble):
   - Three workers spawn simultaneously
   - Each reads task from workspace
   - Each writes analysis in their completion message body
3. **Aggregate State**: Aggregator reads all three message bodies, synthesizes
4. **Complete State**: Routes final summary to core

## Agents

| Agent | Model | Role |
|-------|-------|------|
| entry | haiku | Receive task, prepare for parallel analysis |
| worker-1 | haiku | Feasibility & practicality analysis |
| worker-2 | haiku | User value & impact analysis |
| worker-3 | haiku | Architecture & design analysis |
| aggregator | sonnet | Synthesize all analyses into recommendation |

## FSM States

1. **entry_state**: Single agent (entry) prepares task
2. **parallel_analysis**: Ensemble state with 3 parallel workers
3. **aggregate**: Single agent (aggregator) synthesizes results
4. **complete**: Routes to core

## Key Features

- **Message-based**: All work products in message bodies, not files
- **Parallel execution**: Workers run simultaneously via FSM ensemble
- **Automatic aggregation**: FSM collects results, passes to aggregator
- **Simple test case**: Easy to verify parallel coordination works

## Test Usage

```bash
tx msg test-ensemble-msgs "Analyze the feasibility of adding real-time collaborative editing to our application"
```

Expected behavior:
1. Entry agent writes task to workspace
2. Three workers spawn in parallel (check logs for simultaneity)
3. Each worker writes their analysis in message body
4. Aggregator receives all three messages, synthesizes
5. Core receives unified recommendation

## Success Criteria

- ✅ All three workers spawn at the same time
- ✅ Workers complete independently (no blocking)
- ✅ Aggregator receives all three message bodies
- ✅ Final synthesis includes insights from all perspectives
- ✅ Clean routing back to core

## Comparison with Other Patterns

| Pattern | Coordination | State | Use Case |
|---------|--------------|-------|----------|
| Sequential | Message routing | Stateless | Simple pipelines |
| FSM Ensemble (this) | FSM manages parallel | Tracked in FSM | Parallel analysis with aggregation |
| Manual Parallel | Entry fans out | None | Ad-hoc parallel tasks |

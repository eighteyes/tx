# test-ensemble-n-diff

Test mesh demonstrating dynamic ensemble with task decomposition - N parallel agents receiving DIFFERENT messages with concat aggregation.

## Overview

This mesh demonstrates the **dynamic ensemble pattern** where:
1. Entry agent decomposes a complex task into N subtasks
2. FSM spawns N worker instances in parallel (dynamic count)
3. Each worker receives a DIFFERENT subtask
4. Aggregator combines all results into final report

## Architecture

```
User Task → Entry (decompose) → N Workers (parallel, different subtasks) → Aggregator (synthesize) → Final Report
```

### Agents

| Agent | Model | Role |
|-------|-------|------|
| **entry** | sonnet | Analyzes task complexity and decomposes into N subtasks |
| **worker** | sonnet | Executes assigned subtask (N instances spawn) |
| **aggregator** | sonnet | Synthesizes all worker results into final report |

### FSM States

1. **entry_state**: Entry agent decomposes task
   - Outputs: `subtask_count`, `subtasks` (via rearmatter)
   - Transition: → parallel_execution

2. **parallel_execution**: Ensemble state
   - Spawns N worker instances (dynamic count from `$subtask_count`)
   - Each worker gets different subtask
   - Aggregation: concat (combine all outputs)
   - Transition: → aggregate

3. **aggregate**: Aggregator synthesizes results
   - Receives: `$worker_results` (all worker outputs concatenated)
   - Creates comprehensive final report
   - Transition: → complete

4. **complete**: Terminal state

## Key Features

### Dynamic Count Pattern

```yaml
ensemble:
  type: parallel
  agent: worker              # Single agent type
  count: $subtask_count      # Dynamic - set by entry agent
  aggregation: concat
```

The entry agent decides how many workers are needed based on task complexity.

### Different Messages

Unlike `test-ensemble-n-same` where all workers get the SAME message, this mesh gives each worker a DIFFERENT subtask:

- Worker 1: Subtask 1
- Worker 2: Subtask 2
- Worker 3: Subtask 3
- Worker N: Subtask N

### Concat Aggregation

All worker outputs are concatenated (not voted on), then the aggregator synthesizes them into a coherent final report.

## Example Usage

**Input Task**: "Research the history of programming languages"

**Entry Decomposition**:
```yaml
subtask_count: 4
subtasks: |
  1. Research assembly and machine languages (1950s-1960s)
  2. Research high-level procedural languages (1970s-1980s)
  3. Research object-oriented programming languages (1990s-2000s)
  4. Research functional programming languages (2000s-present)
```

**Parallel Execution**:
- 4 workers spawn simultaneously
- Each researches their assigned era/paradigm
- All complete independently

**Aggregation**:
- Aggregator receives all 4 research reports
- Synthesizes into comprehensive history
- Returns unified final report

## Comparison: n-same vs n-diff

| Feature | test-ensemble-n-same | test-ensemble-n-diff |
|---------|---------------------|---------------------|
| **Worker Messages** | All receive SAME message | Each receives DIFFERENT subtask |
| **Aggregation** | Voting (pick best answer) | Concat (combine all answers) |
| **Use Case** | Monte Carlo, variance, best-of-N | Task decomposition, parallel research |
| **Entry Role** | Minimal (pass through) | Critical (decomposes task) |
| **Worker Independence** | All solve same problem | Each solves different piece |
| **Result Type** | Single best answer | Comprehensive combined report |

## Testing

Test with tasks that benefit from decomposition:

```bash
# Example 1: Research task
tx msg test-ensemble-n-diff "Research the history of programming languages"

# Example 2: Analysis task
tx msg test-ensemble-n-diff "Analyze the pros and cons of microservices vs monoliths"

# Example 3: Comparison task
tx msg test-ensemble-n-diff "Compare different database types: SQL, NoSQL, graph, and time-series"
```

## Technical Details

### Rearmatter Output (Entry Agent)

```yaml
---
subtask_count: 4
subtasks: |
  1. [Subtask description]
  2. [Subtask description]
  3. [Subtask description]
  4. [Subtask description]
---
```

### FSM Context Capture

```yaml
exit:
  set:
    subtask_count: "$(echo '$rearmatter' | yq '.subtask_count')"
    subtasks: "$(echo '$rearmatter' | yq '.subtasks')"
```

### Worker Distribution

The system automatically:
1. Reads `$subtask_count` from FSM context
2. Spawns that many worker instances
3. Assigns subtask 1 to worker 1, subtask 2 to worker 2, etc.
4. Collects outputs as they complete

### Aggregator Input

The aggregator receives:
- `worker_results`: Concatenated outputs from all workers
- `subtask_count`: Number of workers that ran
- `subtasks`: Original subtask descriptions

## Pattern Applications

This pattern is ideal for:

- **Research tasks**: Divide topic into parallel research tracks
- **Analysis tasks**: Analyze different aspects simultaneously
- **Comparison tasks**: Compare multiple options in parallel
- **Survey tasks**: Survey multiple areas concurrently
- **Multi-perspective analysis**: Analyze from different viewpoints

## Related Meshes

- **test-ensemble-n-same**: Same agent N times with voting (Monte Carlo)
- **code-review-ensemble**: Fixed 3 different agents (logic, architecture, robustness)
- **test-ensemble-msgs**: Fixed N agents with explicit routing

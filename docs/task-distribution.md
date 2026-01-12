# Task Distribution Pattern

The task distribution pattern enables a task to be split into multiple subtasks, processed in parallel by specialized agents, and synthesized into a final result by a reviewer agent.

## Pattern Overview

```
User Task → Spawner Agent → Subtasks → Subagents (parallel) → Results → Reviewer → Final Output
```

**Key Components:**

1. **Spawner Agent**: Analyzes the task and decomposes it into N subtasks
2. **Subagents**: Process subtasks in parallel (can be the same agent or different agents)
3. **Reviewer Agent**: Aggregates results and produces final synthesized output

## Configuration

Add `task_distribution` to your mesh config:

```yaml
mesh: analysis-mesh
description: "Parallel analysis with result synthesis"

agents:
  - name: analyst
    model: sonnet
    prompt: prompts/analyst.md

  - name: domain-expert-1
    model: sonnet
    prompt: prompts/domain-expert.md

  - name: domain-expert-2
    model: sonnet
    prompt: prompts/domain-expert.md

  - name: synthesizer
    model: opus
    prompt: prompts/synthesizer.md

entry_point: analyst

task_distribution:
  spawner: analyst
  subagents: [domain-expert-1, domain-expert-2]
  reviewer: synthesizer
  distribution_strategy: equal
  subtask_count: 4  # Optional: defaults to subagents.length
  timeout_ms: 180000  # Optional: 3 minutes
  allow_partial_failure: false  # Optional: defaults to false
```

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `spawner` | string | Yes | Agent that decomposes the task |
| `subagents` | string[] | Yes | Agents that process subtasks (round-robin assignment) |
| `reviewer` | string | Yes | Agent that synthesizes results |
| `distribution_strategy` | string | Yes | Strategy for task splitting: `equal`, `weighted`, `adaptive`, `custom` |
| `subtask_count` | number | No | Number of subtasks to create (default: subagents.length) |
| `timeout_ms` | number | No | Timeout per subtask in milliseconds (default: 120000) |
| `allow_partial_failure` | boolean | No | Continue if some subtasks fail (default: false) |
| `distribution_prompt` | string | No | Path to custom distribution prompt (for `custom` strategy) |
| `review_prompt` | string | No | Path to custom review prompt |

## Distribution Strategies

### Equal (Phase 2 - Implemented)

Splits task into N equal parts and assigns to subagents in round-robin fashion.

```yaml
task_distribution:
  spawner: analyst
  subagents: [worker-1, worker-2, worker-3]
  reviewer: synthesizer
  distribution_strategy: equal
  subtask_count: 6  # Creates 6 subtasks, 2 per agent (round-robin)
```

### Weighted (Phase 3 - Planned)

Distributes based on agent capabilities and performance history.

```yaml
task_distribution:
  spawner: analyst
  subagents: [expert-a, expert-b, expert-c]
  reviewer: synthesizer
  distribution_strategy: weighted
  # Automatically weights distribution based on agent capabilities
```

### Adaptive (Phase 3 - Planned)

Uses spawner agent to suggest optimal task split based on complexity analysis.

```yaml
task_distribution:
  spawner: analyst
  subagents: [specialist-1, specialist-2, specialist-3]
  reviewer: synthesizer
  distribution_strategy: adaptive
  # Spawner analyzes task and determines optimal split
```

### Custom (Phase 3 - Planned)

Uses provided prompt to guide task decomposition via Claude.

```yaml
task_distribution:
  spawner: analyst
  subagents: [worker-1, worker-2]
  reviewer: synthesizer
  distribution_strategy: custom
  distribution_prompt: prompts/custom-distribution.md
```

## Spawner Output Format

The spawner agent must output subtasks in a structured format:

```
SUBTASK 1: Analyze US market trends
Focus on analyzing market trends in the United States region.
Include both consumer and enterprise segments.

SUBTASK 2: Analyze EU market trends
Focus on analyzing market trends in the European Union region.
Include regulatory considerations.

SUBTASK 3: Analyze APAC market trends
Focus on analyzing market trends in the Asia-Pacific region.
Include emerging market dynamics.
```

Alternative markdown format:

```markdown
## SUBTASK 1: Analyze US market trends
Focus on analyzing market trends in the United States region.

## SUBTASK 2: Analyze EU market trends
Focus on analyzing market trends in the European Union region.
```

**Requirements:**
- Use `SUBTASK N:` format where N is sequential (1, 2, 3, ...)
- Include description content after each SUBTASK header
- Consecutive numbering (warnings emitted for gaps)

## Execution Flow

1. **User sends task** to entry point (spawner agent)

2. **Spawner agent processes** the task and outputs subtasks in structured format

3. **Dispatcher detects** spawner completion and:
   - Parses spawner output to extract subtasks
   - Registers batch with TaskDistributionCoordinator
   - Creates subtask messages with metadata:
     - `subtask_id`: e.g., "subtask-1"
     - `parent_task_id`: Original task ID for tracking
     - `assigned_agent`: Agent to process this subtask
   - Enqueues subtask messages

4. **Subagents execute** in parallel:
   - Each subagent receives its subtask via message queue
   - Processes independently
   - Writes task-complete with results

5. **Coordinator tracks** completion:
   - Records each subtask result
   - Monitors for timeout
   - Emits batch-complete when all done

6. **Dispatcher routes** to reviewer:
   - Formats all subtask results
   - Creates review task message
   - Enqueues for reviewer agent

7. **Reviewer synthesizes** final output:
   - Receives formatted subtask results
   - Produces final synthesized report
   - Writes task-complete to completion agent or core

## Subtask Message Structure

When subtasks are enqueued, they include special metadata:

```typescript
{
  from_agent: "analysis-mesh/analyst",
  to_agent: "analysis-mesh/domain-expert-1",
  type: "task",
  payload: {
    headline: "Subtask: subtask-1",
    body: "Focus on analyzing market trends in the US region...",
    "msg-id": "task-123-subtask-1",
    subtask_id: "subtask-1",
    parent_task_id: "task-123"
  }
}
```

## Reviewer Input Format

The reviewer receives all subtask results in a structured format:

```markdown
# Subtask Results

Total subtasks: 3
Successful: 3
Failed: 0

---

## SUBTASK 1 RESULT
**Agent**: domain-expert-1
**Status**: ✓ Success

### Output

US market analysis shows strong growth in enterprise segment...

---

## SUBTASK 2 RESULT
**Agent**: domain-expert-2
**Status**: ✓ Success

### Output

EU market analysis reveals regulatory challenges...

---

## SUBTASK 3 RESULT
**Agent**: domain-expert-3
**Status**: ✗ Failed
**Error**: Timeout

### Output

(no output)

---
```

## Error Handling

### Subtask Failure

By default, if any subtask fails, the entire batch fails:

```yaml
task_distribution:
  # ...
  allow_partial_failure: false  # Default
```

With partial failure enabled, the reviewer receives whatever results are available:

```yaml
task_distribution:
  # ...
  allow_partial_failure: true  # Continue with partial results
```

### Timeout

If subtasks don't complete within `timeout_ms`, a timeout event is emitted:

```typescript
dispatcher.on('task-distribution:timeout', (event) => {
  console.log(`Batch ${event.parent_task_id} timed out`);
  console.log(`Completed: ${event.completed_count}/${event.subtask_count}`);
  console.log(`Pending: ${event.pending_subtasks.join(', ')}`);
});
```

## Events

The dispatcher emits several events for monitoring:

```typescript
// Subtask enqueued
dispatcher.on('task-distribution:subtask-enqueued', (event) => {
  // { parentTaskId, subtaskId, subagent, msgId }
});

// Batch complete (all subtasks done)
dispatcher.on('task-distribution:batch-complete', (event) => {
  // { parent_task_id, subtask_count, successful_count, failed_count, results, reviewer_msg_id }
});

// Batch timeout
dispatcher.on('task-distribution:timeout', (event) => {
  // { parent_task_id, completed_count, pending_subtasks }
});

// Parse error
dispatcher.on('task-distribution:error', (event) => {
  // { spawner, parentTaskId, error }
});
```

## Performance Characteristics

**Parallelization:**
- Subtasks execute concurrently (limited by available system resources)
- Round-robin agent assignment distributes load evenly
- No coordination overhead between subagents

**Latency:**
- Total time ≈ max(subtask durations) + spawner time + reviewer time
- Significantly faster than sequential processing for independent subtasks

**Cost:**
- Spawner: 1 invocation (typically Sonnet/Opus for decomposition)
- Subagents: N invocations (can use Haiku for cost efficiency)
- Reviewer: 1 invocation (typically Opus for synthesis)

## Best Practices

### Spawner Agent Design

- Use higher-capability model (Sonnet/Opus) for task decomposition
- Ensure spawner understands the domain and can split tasks logically
- Test spawner output format with sample tasks

### Subagent Selection

- Use specialized agents for different subtask types
- Consider cost/quality tradeoffs (Haiku for simple tasks, Sonnet for complex)
- Ensure subagents can work independently (no inter-subtask dependencies)

### Reviewer Agent Design

- Use highest-capability model (Opus) for synthesis
- Provide reviewer with context about the original task
- Handle partial results gracefully when `allow_partial_failure: true`

### Subtask Count

- Balance between parallelization and overhead
- Too few: underutilizes parallel processing
- Too many: overhead from coordination and reviewer synthesis
- Typical range: 2-10 subtasks

### Timeout Configuration

- Set generous timeout to account for parallel execution
- Consider: `timeout_ms = (average_subtask_time * 2) + buffer`
- Monitor timeout events to tune configuration

## Example Use Cases

### Market Analysis

Split market research across regions:
- Spawner: Identifies regions to analyze
- Subagents: Research experts for each region
- Reviewer: Synthesizes global market report

### Code Review

Distribute code review across modules:
- Spawner: Identifies modules/components
- Subagents: Specialized reviewers (security, performance, style)
- Reviewer: Aggregates findings and prioritizes issues

### Data Processing

Parallel data analysis:
- Spawner: Chunks large dataset
- Subagents: Process each chunk independently
- Reviewer: Combines results and identifies patterns

### Content Generation

Multi-section document creation:
- Spawner: Creates outline with sections
- Subagents: Write each section
- Reviewer: Ensures consistency and flow

## Comparison with Ensemble Pattern

| Feature | Task Distribution | Ensemble |
|---------|------------------|----------|
| **Input** | Single task → spawner decomposes | Same task → all agents |
| **Agents** | Different subtasks | Same task |
| **Coordination** | Spawner creates subtasks | No decomposition |
| **Synthesis** | Reviewer aggregates results | Aggregation engine |
| **Use Case** | Decomposable tasks | Diverse perspectives |

## Troubleshooting

### Spawner Output Not Parsed

**Symptom:** `task-distribution:error` event with "No subtasks found"

**Solution:**
- Check spawner output format matches `SUBTASK N:` pattern
- Review spawner logs to see actual output
- Test spawner prompt with sample inputs

### Subtasks Not Completing

**Symptom:** `task-distribution:timeout` event

**Solutions:**
- Increase `timeout_ms` in config
- Check subagent logs for errors
- Verify subagents can access required resources
- Enable `allow_partial_failure` if some failures are acceptable

### Reviewer Not Invoked

**Symptom:** No reviewer task message after subtasks complete

**Solution:**
- Check all subtasks completed successfully (if `allow_partial_failure: false`)
- Verify coordinator batch is registered (check logs for "Registered subtask batch")
- Look for `batch-complete` event in dispatcher logs

## Implementation Details

**Core Components:**

- `TaskDistributionCoordinator`: Manages batch lifecycle and result collection
- `SubtaskParser`: Parses spawner output to extract subtask definitions
- `WorkerDispatcher`: Orchestrates spawner → subagents → reviewer flow

**State Management:**

- Coordinator tracks active batches in memory
- Each batch has timeout timer
- Results accumulated as subtasks complete
- Batch cleanup after reviewer routing

**Message Flow:**

1. Entry point task → Spawner
2. Spawner output → Parser → Subtask definitions
3. Subtask messages → Queue
4. Queue → Subagent workers (parallel)
5. Subagent results → Coordinator
6. All results → Format → Reviewer task
7. Reviewer task → Queue
8. Queue → Reviewer worker

## Future Enhancements (Phase 3)

- **Weighted distribution**: Agent capability matching
- **Adaptive distribution**: Dynamic task splitting based on complexity
- **Custom distribution prompts**: User-defined decomposition strategies
- **Result caching**: Avoid re-running identical subtasks
- **Progress tracking**: Real-time subtask completion status
- **Retry policies**: Automatic retry of failed subtasks
- **Resource limits**: Max concurrent subagents per batch

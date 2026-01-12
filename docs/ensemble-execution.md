# Ensemble Execution

Ensemble execution enables parallel processing of a single task by multiple agents, with results aggregated according to a configured strategy.

## How It Works

1. **Detection**: Dispatcher detects `ensemble` field in mesh config
2. **Spawn**: All ensemble agents spawned in parallel (not sequentially)
3. **Execution**: Agents run with timeout (default 2 minutes)
4. **Aggregation**: Results collected and aggregated per strategy
5. **Return**: Single aggregated result written back to requester

## Architecture

```
┌─────────────┐
│   Requester │
│ (core/core) │
└──────┬──────┘
       │ task
       ▼
┌─────────────────┐
│   Dispatcher    │
│  (detects       │
│   ensemble)     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼         ▼
┌────────┐ ┌────────┐ ┌────────┐
│Agent 1 │ │Agent 2 │ │Agent 3 │
│(haiku) │ │(sonnet)│ │(haiku) │
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
    └────┬─────┴─────┬────┘
         ▼           │
    ┌─────────────────────┐
    │ EnsembleCoordinator │
    │   (aggregates)      │
    └──────────┬──────────┘
               │
               ▼
         ┌──────────┐
         │  Result  │
         │ Message  │
         └──────────┘
```

## Configuration

Add an `ensemble` field to your mesh config:

```yaml
mesh: code-review
description: Parallel code review by multiple specialized agents
agents:
  - name: security
    model: sonnet
    prompt: security-reviewer.md
  - name: style
    model: haiku
    prompt: style-checker.md
  - name: logic
    model: sonnet
    prompt: logic-analyzer.md

entry_point: security  # Entry point triggers ensemble

ensemble:
  agents:
    - security
    - style
    - logic
  aggregation_strategy: concat      # concat, deduplicate, voting, consensus, custom
  timeout_ms: 120000                 # Per-agent timeout (default: 120000 = 2 minutes)
  fault_tolerance:
    min_success_count: 2             # Minimum agents that must succeed (default: all)
```

## Aggregation Strategies

### concat (Available)
Concatenates all results with agent labels:

```
## Agent: security
[Security findings...]

---

## Agent: style
[Style findings...]

---

## Agent: logic
[Logic findings...]
```

### deduplicate (Available)
Removes duplicate findings across agents:

```
Finding A (from security, logic)
Finding B (from style)
Finding C (from security)
```

### voting, consensus, custom (Phase 3)
Advanced strategies requiring Claude-powered aggregation. Coming in Phase 3.

## Custom Aggregation

Pass custom aggregation prompts via message frontmatter:

```yaml
---
to: code-review/security
from: core/core
type: task
msg-id: review-123
custom_aggregation_prompt: |
  Synthesize these code review findings into a structured report
  covering: security, performance, maintainability, testing.

  Prioritize critical issues and provide actionable recommendations.
---

Please review this pull request: [PR details...]
```

The custom prompt is passed to the aggregation engine and will be used when custom aggregation is implemented in Phase 3.

## Fault Tolerance

Ensemble execution can tolerate partial failures:

```yaml
ensemble:
  agents: [agent-1, agent-2, agent-3, agent-4, agent-5]
  aggregation_strategy: concat
  fault_tolerance:
    min_success_count: 3  # Need 3/5 to succeed
```

If 3 or more agents succeed, the ensemble succeeds and aggregates successful results.
If fewer than 3 succeed, the ensemble fails with error details.

## Message Flow

### 1. Task Message (Requester → Ensemble Entry Point)
```yaml
---
to: code-review/security
from: core/core
type: task
msg-id: task-001
---

Review this PR for security issues: [PR details]
```

### 2. Ensemble Execution (Dispatcher)
- Dispatcher detects `ensemble` field in mesh config
- Spawns all agents in parallel
- Waits for results with timeout
- Aggregates successful results

### 3. Result Message (Ensemble → Requester)
```yaml
---
to: core/core
from: code-review/ensemble
type: task-complete
msg-id: ensemble-1234567890
ensemble_id: code-review-1234567890-abc123
headline: Ensemble execution complete: code-review
---

## Agent: security
[Security findings...]

---

## Agent: style
[Style findings...]

---

## Agent: logic
[Logic findings...]
```

## Performance

- **Latency**: ~1x single agent (parallel execution)
- **Cost**: Nx single agent cost (N agents run)
- **Memory**: Linear with agent count
- **Timeout**: Per-agent timeout, not total timeout

Example: 3 agents with 2-minute timeout
- Best case: 2 minutes (all agents complete on time)
- Worst case: 2 minutes (timeouts enforced per agent)
- Cost: 3x single agent

## Error Handling

### Agent Timeout
If an agent exceeds `timeout_ms`, it's marked as failed:
```
Agent 'style' failed: Timeout after 120000ms
```

### Agent Crash
If an agent crashes, error is recorded:
```
Agent 'logic' failed: Runtime error in analysis
```

### Insufficient Success
If fewer agents succeed than `min_success_count`:
```
Ensemble failed: 1/3 agents succeeded, need 2
```

## Best Practices

### 1. Choose Appropriate Agents
- Use different perspectives (security, style, logic)
- Balance cost vs. coverage (haiku for simple tasks, sonnet for complex)

### 2. Set Reasonable Timeouts
- Default 2 minutes is good for most tasks
- Increase for complex analysis tasks
- Decrease for simple validation tasks

### 3. Configure Fault Tolerance
- For critical tasks: `min_success_count = agents.length` (all must succeed)
- For exploratory tasks: `min_success_count = ceil(agents.length * 0.6)` (60% threshold)
- For high-availability: `min_success_count = ceil(agents.length / 2)` (majority)

### 4. Use Appropriate Aggregation
- `concat`: When you want all perspectives (code review, brainstorming)
- `deduplicate`: When agents may find overlapping issues (bug hunting, security scan)
- `voting`: When you want the best single answer (coming in Phase 3)
- `consensus`: When you need agreement (coming in Phase 3)

## Limitations (Phase 2)

- **Sequential/race modes**: Not yet implemented (Phase 3)
- **Custom aggregation**: Prompt accepted but not executed (Phase 3)
- **Task distribution**: Single task to all agents (Sprint 2 adds dynamic distribution)
- **FSM integration**: Ensemble doesn't integrate with FSM workflows yet
- **Agent communication**: Agents can't communicate during ensemble execution

## Examples

### Code Review Ensemble
```yaml
mesh: code-review
agents:
  - name: security
    model: sonnet
    prompt: security-reviewer.md
  - name: performance
    model: haiku
    prompt: performance-checker.md
  - name: style
    model: haiku
    prompt: style-guide.md

ensemble:
  agents: [security, performance, style]
  aggregation_strategy: concat
  fault_tolerance:
    min_success_count: 2  # At least 2 reviewers must complete
```

### Research Synthesis
```yaml
mesh: research
agents:
  - name: academic
    model: sonnet
    prompt: academic-researcher.md
  - name: industry
    model: sonnet
    prompt: industry-analyst.md
  - name: technical
    model: haiku
    prompt: technical-reviewer.md

ensemble:
  agents: [academic, industry, technical]
  aggregation_strategy: deduplicate  # Remove duplicate findings
  timeout_ms: 180000  # 3 minutes for research tasks
```

### Bug Detection
```yaml
mesh: bug-hunter
agents:
  - name: static-analysis
    model: haiku
    prompt: static-analyzer.md
  - name: logic-bugs
    model: sonnet
    prompt: logic-checker.md
  - name: edge-cases
    model: haiku
    prompt: edge-case-finder.md
  - name: security-bugs
    model: sonnet
    prompt: security-scanner.md

ensemble:
  agents: [static-analysis, logic-bugs, edge-cases, security-bugs]
  aggregation_strategy: deduplicate  # Combine unique bugs
  fault_tolerance:
    min_success_count: 3  # Need 3/4 bug detectors
```

## Monitoring

Dispatcher emits events for ensemble execution:

```typescript
dispatcher.on('ensemble:complete', (data) => {
  console.log(`Ensemble ${data.ensembleId} complete`);
  console.log(`Success: ${data.success}`);
  console.log(`Mesh: ${data.meshName}`);
});
```

## Future Enhancements (Phase 3)

- **Sequential execution**: Run agents one after another, passing results
- **Race execution**: First agent to complete wins
- **Voting aggregation**: Claude votes on best result
- **Consensus aggregation**: Claude finds common themes
- **Custom aggregation**: Full Claude-powered synthesis
- **Dynamic agent selection**: Choose agents based on task complexity
- **Inter-agent communication**: Agents collaborate during execution
- **Cost optimization**: Skip redundant agents if early consensus

## References

- Implementation: `src/worker/ensemble-coordinator.ts`
- Dispatcher integration: `src/worker/dispatcher.ts`
- Aggregation engine: `src/mesh/aggregation.ts`
- Type definitions: `src/shared/types.ts`
- Unit tests: `test/unit/ensemble-execution.test.ts`
- Integration tests: `test/e2e/12-ensemble-dispatcher.test.ts`

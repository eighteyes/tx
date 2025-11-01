# Risk Experiment Mesh

A specialized mesh for designing and executing proactive risk-reduction experiments before committing to major implementation work.

## Purpose

Converts risky assumptions into validated knowledge through time-boxed experiments, enabling data-driven go/no-go decisions.

## Architecture

```
core/core → coordinator → designer → coordinator → executor → coordinator → analyzer → coordinator → validator → coordinator → core/core
```

### Agents

1. **Coordinator** (orchestrator)
   - Receives project plans from core
   - Routes work through the mesh
   - Synthesizes final recommendations
   - Reports back to core

2. **Designer**
   - Analyzes plans to identify risky assumptions
   - Designs minimal, time-boxed experiments
   - Defines success criteria and decision frameworks
   - Prioritizes by risk (impact × uncertainty)

3. **Executor**
   - Executes experiments within time boxes
   - Collects data and measurements
   - Documents findings with evidence
   - Reports results objectively

4. **Analyzer**
   - Interprets experiment results
   - Assesses confidence levels
   - Quantifies impact on risk and timeline
   - Recommends GO/ADJUST/STOP decisions

5. **Validator**
   - Validates analysis quality
   - Checks for biases and blindspots
   - Challenges confidence levels
   - Approves or requests revision

## Workflow

### Input
```markdown
---
from: core/core
to: risk-experiment/coordinator
type: task
---

Design risk experiments for multi-provider integration:
@.ai/plans/multi-provider/plan.md
```

### Process
1. Coordinator routes plan to Designer
2. Designer identifies assumptions, creates experiment specs
3. Coordinator routes specs to Executor (may run multiple in parallel)
4. Executor runs experiments, collects data
5. Coordinator routes results to Analyzer
6. Analyzer interprets data, recommends decision
7. Coordinator routes analysis to Validator
8. Validator checks quality, approves or challenges
9. Coordinator synthesizes final report to core

### Output
```markdown
---
from: risk-experiment/coordinator
to: core/core
type: task-complete
status: complete
---

# Risk Experiment Results

## Executive Summary
Ran 3 experiments, validated critical assumptions.

**Experiment 1: CODEX API**
- Result: ✅ Success → GO
- Confidence: 85%

**Experiment 2: Performance**
- Result: ✅ Success → GO (tighten budget)
- Confidence: 90%

**Experiment 3: Refactor Complexity**
- Result: ⚠️ Partial → ADJUST (+0.5 days)
- Confidence: 75%

## Recommendations
Proceed with project, adjust Phase 1 timeline by 0.5 days.

## Impact
- Risk reduced: 12 days expected loss → 1 day
- Confidence: 60% → 85%
- ROI: 15:1
```

## Example Usage

### Spawn the mesh
```bash
tx spawn risk-experiment
```

### Send task to core
```bash
# In core session
Design risk experiments for @.ai/plans/multi-provider/plan.md
```

### Expected timeline
- Designer: 2-4 hours (designs 3-5 experiments)
- Executor: 4-12 hours (runs experiments, may parallelize)
- Analyzer: 1-2 hours (interprets results)
- Validator: 0.5-1 hour (checks quality)
- **Total**: ~8-19 hours for full cycle

## Key Benefits

1. **Fail Fast**: Discover issues in hours, not weeks
2. **Quantified Risk**: Convert uncertainty to probability
3. **Data-Driven**: GO/NO-GO based on evidence, not gut
4. **High ROI**: Typical 10-20:1 return on experiment time
5. **Confidence**: Increases team confidence in decisions

## Experiment Patterns

### Pattern 1: API Compatibility
- **Time**: 2-6 hours
- **Tests**: Can external service work with our system?
- **Example**: CODEX API test

### Pattern 2: Complexity Calibration
- **Time**: 2-4 hours
- **Tests**: Is our estimate realistic?
- **Example**: POC hardest part of refactor

### Pattern 3: Performance Validation
- **Time**: 2-3 hours
- **Tests**: Will abstraction kill performance?
- **Example**: Benchmark RuntimeAdapter overhead

### Pattern 4: Routing Feasibility
- **Time**: 3-6 hours
- **Tests**: Will cross-provider messaging work?
- **Example**: Claude→CODEX message test

## Success Metrics

A good experiment delivers:
- ✅ Clear result (success/partial/failure)
- ✅ Data to support decision
- ✅ ROI > 10:1 (risk reduced vs. time spent)
- ✅ Confidence level increase

## When to Use

Use this mesh **before** any project where:
- Unknowns could derail execution
- Assumptions are critical to success
- Failure cost is high (>5 days wasted)
- Learning is cheap (<1 day to validate)

## Integration with Planning

Add to project plans:

```markdown
## Pre-Work: Risk Experiments (Days -2 to 0)

Use risk-experiment mesh to validate critical assumptions.

**Experiments Needed**:
1. CODEX API compatibility (6 hours)
2. Performance overhead (3 hours)
3. Refactor complexity (4 hours)

**Decision Gate**: Only proceed to Phase 1 if experiments validate assumptions.
```

## Related Meshes

- **Planner**: Creates project plans (this mesh validates assumptions in those plans)
- **Brain**: Architectural analysis (this mesh validates architectural feasibility)
- **TDD-Cycle**: Implementation (this mesh de-risks before implementation)

## Files

- `mesh-configs/risk-experiment.json` - Mesh configuration
- `agents/risk-experiment/coordinator/` - Orchestration agent
- `agents/risk-experiment/designer/` - Experiment design agent
- `agents/risk-experiment/executor/` - Experiment execution agent
- `agents/risk-experiment/analyzer/` - Results analysis agent
- `agents/risk-experiment/validator/` - Quality validation agent

## Notes

- Experiments are time-boxed strictly (no scope creep)
- Executor stops at time box even if incomplete
- Analyzer assigns confidence based on evidence quality
- Validator challenges weak reasoning
- Multiple experiments can run in parallel via coordinator

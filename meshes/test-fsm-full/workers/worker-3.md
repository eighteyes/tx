# Worker 3 Agent
# Ensemble participant (fragile) — writes worker-3.yaml
# Responsibilities: write output file for ensemble aggregation
# Note: This worker is the "fragile" participant for fault_tolerance testing.
# Ensemble min_success_count is 2, so the mesh proceeds even if this worker fails.

<role>
You are worker-3 in a parallel ensemble. Write your output file and exit.
</role>

## Workflow

1. Write `worker-3.yaml` to workspace:

```yaml
worker: 3
status: complete
data: "worker-3 output for aggregation"
```

2. This output is concatenated with other workers by the ensemble coordinator.

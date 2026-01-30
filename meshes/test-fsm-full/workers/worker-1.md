# Worker 1 Agent
# Ensemble participant — writes worker-1.yaml
# Responsibilities: write output file for ensemble aggregation

<role>
You are worker-1 in a parallel ensemble. Write your output file and exit.
</role>

## Workflow

1. Write `worker-1.yaml` to workspace:

```yaml
worker: 1
status: complete
data: "worker-1 output for aggregation"
```

2. This output is concatenated with other workers by the ensemble coordinator.

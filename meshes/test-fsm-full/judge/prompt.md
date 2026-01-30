# Judge Agent
# Verdict agent — writes verdict.yaml for FSM conditional branching
# Responsibilities: evaluate ensemble output, write verdict with result field

<role>
You are the judge. Read ensemble output, write a verdict. FSM routes based on result field.
</role>

## Workflow

1. Read any ensemble output available in workspace (worker-*.yaml files)
2. Write `verdict.yaml` to workspace:

```yaml
result: pass
reason: "all workers completed successfully"
```

Valid result values:
- `pass` — routes to counter_loop (iteration testing)
- `retry` — routes to retry state (retry loop testing)

For default test runs, write `result: pass`.

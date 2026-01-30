# Step B Agent
# Linear pipeline test — writes step-b.yaml gate file
# Responsibilities: write step-b.yaml to workspace

<role>
You are step-b in the linear pipeline test. Write your gate file and exit.
</role>

## Workflow

1. Verify `step-a.yaml` exists in workspace (entry_gates enforce this)
2. Write `step-b.yaml` to workspace:

```yaml
step: b
status: complete
```

3. Confirm completion. FSM gates on this file.

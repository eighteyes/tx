# Step A Agent
# Linear pipeline test — writes step-a.yaml gate file
# Responsibilities: write step-a.yaml to workspace

<role>
You are step-a in the linear pipeline test. Write your gate file and exit.
</role>

## Workflow

1. Write `step-a.yaml` to workspace:

```yaml
step: a
status: complete
```

2. Confirm completion. FSM gates on this file.

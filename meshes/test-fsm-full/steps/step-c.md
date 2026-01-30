# Step C Agent
# Linear pipeline test — writes step-c.yaml gate file
# Responsibilities: write step-c.yaml to workspace

<role>
You are step-c in the linear pipeline test. Write your gate file and exit.
</role>

## Workflow

1. Write `step-c.yaml` to workspace:

```yaml
step: c
status: complete
```

2. Confirm completion. FSM uses exit.run script routing from this state.

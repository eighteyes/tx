# Looper Agent
# Iteration loop — writes loop-result.yaml for counter loop testing
# Responsibilities: write gate file each iteration, FSM handles counter

<role>
You are the looper. Write your gate file on each iteration. FSM handles the counter and loop control.
</role>

## Workflow

1. Write `loop-result.yaml` to workspace:

```yaml
loop: iteration
status: complete
```

2. FSM increments iteration counter on entry, checks max on exit.
   When iteration reaches max_iterations, routes to finalize.
   Otherwise, loops back to this state.

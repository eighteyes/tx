# Retrier Agent
# Retry gate — writes retry-ready.yaml for retry loop testing
# Responsibilities: prepare for ensemble re-run, write gate file

<role>
You are the retrier. Prepare for another ensemble attempt and write your gate file.
</role>

## Workflow

1. Write `retry-ready.yaml` to workspace:

```yaml
retry: ready
status: prepared
```

2. FSM checks gate script (check_max_retries) and this file.
   If retries exhausted, routes to counter_loop.
   Otherwise, routes back to fan_out for another ensemble run.

# Valid-Target Agent (Steering Test)

You are the **happy-path receiver** for the test-steering-wrong-route mesh.

## Your Job

1. Read the incoming task. This should only fire on Scenario C (the happy
   path) — a normal `outcome: complete` from `misrouter` with no route_to
   override.
2. Send one `outcome: complete` message to the dispatch sentinel and finish.
   You are the terminal agent, so this routes to `core/core`.

If you ever receive a message from `system/nudge-detector` in this mesh,
something unexpected happened — report it in your completion message so the
operator notices.

## Absolute Rules

- One message out, then stop.
- Terminal agent: `outcome: complete` lands at core/core by default.

# Setup Agent (Checkpoint Source)

You are the setup agent. Your job is to establish context that downstream agents will inherit.

## Task

1. Announce: "Setup agent initializing session"
2. Read package.json and note the project name
3. Create a small piece of context (write a test note)
4. Route to worker-a when complete

This session will be checkpointed and forked to other agents.

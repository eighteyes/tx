# TX External Relay

This repo is a message bridge to a local TX instance. Use the `/msg` skill to send tasks to mesh agents.

## Quick Start

```
/msg dev "build the login page"
/msg research "find papers on transformers"
```

## How It Works

1. `/msg` writes a message file to `outbox/` and pushes
2. A local watcher (`tx watch`) polls this repo for changes
3. New outbox messages are copied to the local tx instance
4. tx fires the targeted mesh to handle the task
5. Responses are pushed back to `inbox/`

## Checking Responses

Look in `inbox/` for task-complete messages from meshes:

```bash
ls inbox/
```

## Available Meshes

Ask your local tx operator which meshes are configured. Common ones:

- `dev` - Development tasks (coding, implementation)
- `research` - Research and analysis
- `deep-research` - Deep iterative research with validation

## Rules

- Always use `/msg` to send messages (it handles the format)
- Don't manually edit files in `outbox/` or `inbox/`
- Don't delete files from `inbox/` - the watcher tracks sync state

---
name: msg
description: Send a message to a tx mesh agent. Writes a properly formatted message file to outbox/, commits, and pushes so the local tx watcher picks it up.
---

# /msg - Send Message to TX

Send a task to a mesh running on your local tx instance via the git bridge.

## Usage

```
/msg <mesh> "<task description>"
/msg <mesh>/<agent> "<task description>"
```

## Examples

```
/msg dev "build the login page with OAuth support"
/msg dev/worker "refactor the database layer"
/msg research "find papers on transformer architectures"
/msg deep-research "analyze the competitive landscape for AI coding tools"
```

## What This Does

1. Creates a properly formatted `.md` message file in `outbox/`
2. Commits and pushes so the local tx watcher picks it up
3. The watcher copies it to `.ai/tx/msgs/` on your local machine
4. tx fires the targeted mesh to handle the task

## Message Format

The skill writes files with this structure:

```markdown
---
to: <mesh>
from: core/core
type: task
msg-id: ext-<timestamp>-<random>
headline: <first 80 chars of task>
timestamp: <ISO-8601>
---

<full task description>
```

## Instructions

When the user invokes `/msg`, you MUST:

1. Parse the mesh target and task description from the arguments
2. Generate a unique msg-id using format: `ext-<Date.now()>-<4 random hex chars>`
3. Generate the filename: `<timestamp>-task-core-core--<mesh>-<msg-id>.md`
4. Write the file to the `outbox/` directory
5. Stage, commit, and push:
   ```bash
   git add outbox/
   git commit -m "outbox: task to <mesh> - <headline>"
   git push
   ```
6. Confirm to the user that the message was sent

### Argument Parsing

- First argument: mesh target (e.g., `dev`, `dev/worker`, `research`)
- Remaining arguments (or quoted string): the task body
- If mesh contains `/`, use it as-is for the `to` field
- If mesh is a bare name (e.g., `dev`), the `to` field is just the mesh name (tx resolves the entry point)

### Example Output File

For `/msg dev "build the login page"`:

**Filename**: `outbox/1739577600000-task-core-core--dev-ext-1739577600000-a3f2.md`

**Content**:
```markdown
---
to: dev
from: core/core
type: task
msg-id: ext-1739577600000-a3f2
headline: build the login page
timestamp: 2026-02-15T12:00:00.000Z
---

build the login page
```

## Checking Responses

After sending a message, responses from tx will appear in `inbox/` once the mesh completes. You can check for responses:

```bash
ls inbox/
cat inbox/*task-complete*
```

Or just ask: "Are there any responses in the inbox?"

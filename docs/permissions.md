# Tool Permissions

TX uses Claude Code SDK's `dontAsk` permission mode with workDir boundary enforcement — replacing Docker container isolation with runtime security hooks.

## Permission Model

| Mode | Description | When |
|------|-------------|------|
| `dontAsk` | Auto-approve allowed tools, auto-deny disallowed tools | Default for all workers |
| `bypassPermissions` | Skip all permission checks | `--god-mode` flag only |

## Default Tool Access

**Allowed** (all workers):
- `Read`, `Write`, `Edit`, `Glob`, `Grep` — file operations (scoped by write/read gates)
- `Bash` — full shell access (scoped by bash-guard)

**Denied** (must explicitly allow):
- `Task` — prevents uncontrolled subagent spawning

## Security Boundaries

```
┌─────────────────────────────────────────┐
│           SDK dontAsk Mode              │
│  ┌───────────────────────────────────┐  │
│  │        Write Gate                 │  │ ← File writes scoped to manifest
│  ├───────────────────────────────────┤  │
│  │        Read Gate                  │  │ ← File reads scoped to manifest
│  ├───────────────────────────────────┤  │
│  │        Identity Gate              │  │ ← Message from: field validation
│  ├───────────────────────────────────┤  │
│  │        Bash Guard                 │  │ ← workDir boundary + catastrophic denylist
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Bash Guard** is the primary security boundary (replaces Docker):
- Write operations blocked outside workDir
- Catastrophic commands blocked (sudo, rm -rf /, reboot, etc.)
- Reads allowed anywhere (cat /etc/hosts is fine)
- Network allowed (curl, wget, ssh, git push)
- cd/pushd blocked to outside workDir (prevents state change attacks)

See [guardrails.md](guardrails.md) for detailed bash_guard configuration.

## Per-Mesh Permissions

Override defaults in mesh `config.yaml`:

```yaml
agents:
  - name: worker
    model: sonnet
    prompt: worker.md
    permissions:
      mode: dontAsk
      allowedTools:
        - Read
        - Write
        - Edit
        - Bash
        - Task          # Explicitly allow Task for this agent
      disallowedTools: []
```

## God Mode

`--god-mode` bypasses all permission checks:

```bash
tx start dev --god-mode
```

- Sets `TX_GOD_MODE=1` environment variable
- Uses `bypassPermissions` instead of `dontAsk`
- Bash guard disabled
- All tools available without restriction
- **Use only for debugging or trusted environments**

## Implementation

| File | Role |
|------|------|
| `src/worker/permissions.ts` | Default tool lists, `resolvePermissions()`, permission types |
| `src/worker/bash-guard.ts` | BashGuard PreToolUse hook — workDir boundary enforcement |
| `src/worker/dispatcher.ts` | Wires permissions and bash guard into worker spawn |
| `src/cli/start.ts` | `--god-mode` flag, `TX_GOD_MODE=1` env var |
| `src/worker/sdk-runner.ts` | Passes resolved permissions to SDK `createConversation()` |

## Migration from Docker

Previously, TX ran inside Docker containers for isolation. The new model:

| Docker | dontAsk + BashGuard |
|--------|---------------------|
| Container filesystem isolation | workDir boundary enforcement |
| No host access | Reads allowed, writes blocked outside workDir |
| Container networking | Network fully allowed |
| Docker overhead | Zero overhead (native process) |
| Rebuild container on change | Instant — no build step |
| `--dangerously-skip-permissions` | `--god-mode` (explicit opt-in) |

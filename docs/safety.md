# Safety Model

TX replaces Docker container isolation with runtime enforcement. Agents run as native processes with full Bash access, bounded by SDK permission hooks.

## Three-Layer Defense

```
Layer 1: SDK Permission Mode (dontAsk)
  ├── Auto-approve: Read, Write, Edit, Glob, Grep, Bash
  ├── Auto-deny: Task (subagent spawning)
  └── Per-agent override via mesh config

Layer 2: PreToolUse Hooks (runtime enforcement)
  ├── BashGuard     — workDir boundary + catastrophic denylist
  ├── WriteGate     — file writes scoped to manifest paths
  ├── ReadGate      — file reads scoped to manifest paths
  ├── IdentityGate  — message from: field validation
  └── OrchestratorGate — routing-only agents (no implementation)

Layer 3: Escape Hatches
  └── --god-mode    — bypass all enforcement (debugging only)
```

## dontAsk Permission Mode

Default for all workers. Auto-approves allowed tools and auto-denies disallowed tools with zero human prompts.

| Tool | Default | Override |
|------|---------|----------|
| Read, Write, Edit, Glob, Grep | Allowed | Per-agent `permissions.allowedTools` |
| Bash | Allowed | Per-agent `permissions.allowedTools` |
| Task | **Denied** | Explicitly add to `allowedTools` |

```yaml
# meshes/my-mesh/config.yaml
agents:
  - name: worker
    permissions:
      mode: dontAsk
      allowedTools: [Read, Write, Edit, Bash, Task]
      disallowedTools: []
```

Full reference: [permissions.md](permissions.md)

## BashGuard

Primary security boundary. Replaces Docker filesystem isolation.

**Principle**: Full Bash access within workDir. Cannot escape, cannot destroy the host.

### What's blocked

| Category | Examples |
|----------|----------|
| **Catastrophic commands** | `sudo`, `reboot`, `rm -rf /`, `dd`, `mkfs`, `kill -9 1` |
| **Writes outside workDir** | `cp file /tmp/`, `> /etc/cron`, `tar -C /usr`, `sed -i /outside/file` |
| **cd/pushd escape** | `cd /tmp`, `cd /tmp && rm -rf *` |
| **Encoded payloads** | `base64 \| bash`, `xxd \| sh` |
| **Docker host mount** | `docker run`, `docker exec`, `docker cp` |

### What's allowed

| Category | Examples |
|----------|----------|
| **Reads anywhere** | `cat /etc/hosts`, `grep pattern /usr/share/dict/words` |
| **Network** | `curl`, `wget`, `ssh`, `git push`, `npm publish` |
| **Relative paths in workDir** | `./scripts/build.sh`, `src/index.ts` |
| **Dev null/stdout/stderr** | `/dev/null`, `/dev/stdout` |

### Enforcement

| strict | warning | Behavior |
|--------|---------|----------|
| true | true | Block + reason (default for bash_guard) |
| true | false | Block silently |
| false | true | Allow + inject feedback |
| false | false | Disabled |

3 violations in strict mode = worker killed.

## WriteGate / ReadGate

Scope file access to paths declared in the mesh manifest.

```yaml
# meshes/my-mesh/config.yaml
agents:
  - name: worker
    writes: [src/, tests/]     # WriteGate: only allow writes here
    reads: [src/, docs/]       # ReadGate: only allow reads here
```

Without manifest entries, these gates are inactive (all paths allowed).

Exempt paths (always writable): `.ai/tx/msgs/`, `.ai/tx/logs/`

## IdentityGate

Validates `from:` field in message frontmatter matches the agent's actual identity. Catches weaker models that forget their agent name.

- Always enabled (no manifest entry needed)
- Bare `to:` names are allowed — the consumer resolves them via DNS-style search
- Bare `from:` names are rejected — agents must use `mesh/agent` format

## OrchestratorGate

Restricts routing-only agents to `Read` + `Write` (msgs dir only).

```yaml
agents:
  - name: coordinator
    orchestrator: true    # Can read anything, write only to msgs/
```

Prevents coordinators from implementing features instead of routing work.

## God Mode

Bypass all enforcement for debugging:

```bash
tx start dev --god-mode
```

- Sets `TX_GOD_MODE=1`
- `bypassPermissions` mode (all tools available)
- BashGuard disabled
- All gates disabled

## Configuration

### Per-agent in mesh config

```yaml
# meshes/my-mesh/config.yaml
guardrails:
  bash_guard:
    strict: true
    warning: true
  agents:
    worker:
      write_gate:
        strict: true
        kill_threshold: 5
```

### Global defaults

```yaml
# .ai/tx/data/config.yaml
guardrails:
  bash_guard:
    strict: true
    warning: true
  write_gate:
    strict: false
    warning: true
```

### Override chain

```
mesh agent > mesh default > global agent > global mesh > global default > hardcoded
```

Full reference: [guardrails.md](guardrails.md)

## Implementation

| File | Role |
|------|------|
| `src/worker/permissions.ts` | Tool lists, `resolvePermissions()`, dontAsk mode |
| `src/worker/bash-guard.ts` | workDir boundary + catastrophic denylist |
| `src/worker/write-gate.ts` | Manifest-scoped file write enforcement |
| `src/worker/read-gate.ts` | Manifest-scoped file read enforcement |
| `src/worker/identity-gate.ts` | Message `from:` field validation |
| `src/worker/guardrail-config.ts` | Config loading, mode resolution, override chain |
| `src/worker/dispatcher.ts` | Wires all hooks into worker spawn pipeline |
| `src/worker/sdk-runner.ts` | Passes permissions to SDK, max_turns tracking |

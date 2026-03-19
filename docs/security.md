# TX Security Model

## Overview

TX uses a layered security model to constrain agent behavior. The primary boundary is OS-level filesystem sandboxing; bash-guard serves as a fallback on unsupported platforms.

## Sandbox (macOS)

TX uses macOS Seatbelt (`sandbox-exec`) to enforce filesystem write boundaries at the kernel level. When active, all child processes — tmux sessions, SDK workers, and their subprocesses — inherit the sandbox. No userspace code can bypass it.

### What's Writable

| Path | Reason |
|------|--------|
| `pwd` (project directory) | Agent workspace |
| `~/.claude` | Claude config and state |
| `/tmp`, `$TMPDIR` | Temporary files |
| Config allowed paths | `.ai/tx/data/config.yaml` → `guardrails.sandbox.allowed_paths` |

### What's Denied by Default

Credential, secret, and personal directories are denied (read and write) unless explicitly overridden:

```
Credentials: ~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.docker,
             ~/.password-store, ~/.netrc, ~/.pgpass, ~/.gcloud, ~/.azure
Personal:    ~/Documents, ~/Desktop, ~/Downloads, ~/Pictures, ~/Movies, ~/Music
History:     ~/.bash_history, ~/.zsh_history, ~/.*_history
```

Override by adding the path to `guardrails.sandbox.allowed_paths` in `config.yaml`.

**Warning:** Overriding credential denials grants all agents in the mesh read+write access to those directories.

### What's Read-Only

System binaries, frameworks, IDE configs, and toolchain paths are granted read+exec access. Agents can read most of the filesystem, but credential directories, personal directories, and shell history are denied for both reads and writes. Everything outside writable paths is read-only at most.

### Network

Outbound network is unrestricted. Inbound limited to local. All network operations to localhost allowed (needed for local API server). Use an external firewall for domain-level filtering.

### Permission Bypass

When the sandbox is active, Claude runs with `--dangerously-skip-permissions` (core) and `bypassPermissions` mode (workers). The Seatbelt profile replaces Claude's permission prompts as the security boundary.

## bash-guard (Fallback)

On platforms without kernel sandbox support, bash-guard provides workDir boundary enforcement via regex pattern matching on Bash commands. It runs as a PreToolUse SDK hook.

### What It Blocks

- File writes outside workDir (touch, mkdir, rm, cp, mv, redirects)
- Privilege escalation (sudo, su, doas)
- Root filesystem destruction (rm -rf /, mkfs, dd to /dev/)
- System service manipulation (systemctl, service, reboot)
- Docker host escapes (docker run with host mount)
- Encoded payload injection (base64/xxd piped to shell)

### Limitations

bash-guard is heuristic — it pattern-matches shell syntax. Creative or obfuscated commands may evade detection. It is a best-effort defense, not a security boundary. Prefer kernel sandboxing where available.

### Kill Threshold

3 violations in strict mode = worker terminated.

## Platform Matrix

| Platform | Primary Defense | bash-guard | Permission Mode |
|----------|----------------|------------|-----------------|
| macOS (`--sandbox` or `enabled: true`) | Seatbelt sandbox | Disabled | `--dangerously-skip-permissions` |
| macOS (default / `--no-sandbox`) | bash-guard | Enabled | Configured per mesh |
| Linux/Windows | bash-guard | Enabled | Configured per mesh |

## Configuration

```yaml
# .ai/tx/data/config.yaml
guardrails:
  sandbox:
    enabled: false      # default; set true to sandbox by default
    allowed_paths:
      - ~/datasets
      - ~/.aws          # override default denial
  bash_guard:
    # Resolved at load time: false on macOS+sandbox, true elsewhere
    strict: true
    warning: true
```

## CLI

```
tx start                # Sandbox off by default (configurable via enabled: true)
tx start --sandbox      # Force sandbox on for this session
tx start --no-sandbox   # Force sandbox off for this session
```

# OS-Level Sandbox for TX

**Date**: 2026-03-19
**Status**: Design approved

## Problem

TX enforces workDir boundaries via bash-guard — a regex-based TypeScript hook that pattern-matches shell commands to detect escapes. This is fundamentally heuristic: creative shell syntax can evade detection. OS-level sandboxing delegates enforcement to the kernel, which cannot be bypassed from userspace.

## Decision

Replace bash-guard with kernel-level filesystem sandboxing on macOS via Seatbelt (`sandbox-exec`). Retain bash-guard as fallback on non-macOS platforms. No abstraction layer — concrete macOS implementation only. Extract an interface when a second platform needs support.

## Known Risks

**`sandbox-exec` is deprecated by Apple.** The man page states it is deprecated and recommends App Sandbox. However: (a) claundom proves it works on current macOS (15.x), (b) if Apple removes it, bash-guard fallback activates automatically via platform detection, (c) the implementation is isolated in a single module, easy to swap. Monitor macOS release notes.

## Architecture

### `src/sandbox/seatbelt.ts`

Concrete module exporting functions. No interface, no class, no provider pattern.

```typescript
/** Generate a Seatbelt .sb profile for the given config */
export function generateProfile(workDir: string, allowedPaths: string[]): Promise<string>;

/** Validate profile syntax via sandbox-exec -f profile true */
export function validateProfile(profilePath: string): Promise<boolean>;

/** Build the re-exec command array */
export function wrapExec(profilePath: string, argv: string[]): string[];

/** Remove profile file */
export function cleanup(profilePath: string): Promise<void>;

/** Is Seatbelt available on this platform? */
export function isAvailable(): boolean;  // process.platform === 'darwin'
```

Profile generation is ported from claundom's shell script into TypeScript string templating.

### Config

Single config surface: `.ai/tx/data/config.yaml`

```yaml
guardrails:
  sandbox:
    allowed_paths:
      - ~/datasets
      - ~/.aws          # override default denial
```

Allowed writable paths are the union of:

| Source | Location |
|--------|----------|
| Always writable | `pwd`, `~/.claude`, `/tmp` |
| Config | `.ai/tx/data/config.yaml` → `guardrails.sandbox.allowed_paths` |

### Default Denied Paths

Applied unless explicitly added to `allowed_paths`:

```
Credentials: ~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.docker,
             ~/.password-store, ~/.netrc, ~/.pgpass, ~/.gcloud, ~/.azure
Personal:    ~/Documents, ~/Desktop, ~/Downloads, ~/Pictures, ~/Movies, ~/Music
History:     ~/.bash_history, ~/.zsh_history, ~/.*_history
```

Any denied path can be overridden by adding it to `guardrails.sandbox.allowed_paths`.

### Launch Flow

Applies to both `tx start` and `tx run`.

```
tx start / tx run
  │
  ├─ resolve sandbox enabled: --sandbox/--no-sandbox flag > config.yaml > default (false)
  │
  ├─ not enabled? → launch normally (bash-guard active)
  │
  ├─ TX_SANDBOXED=1 in env? → already sandboxed, proceed normally
  │
  ├─ isAvailable()?
  │    ├─ no → warn, bash-guard remains active, proceed normally
  │    └─ yes ↓
  │
  ├─ resolve allowed_paths from config.yaml
  ├─ generateProfile() → /tmp/tx-<sha256-short>.sb
  ├─ validateProfile()
  ├─ disable bash-guard in runtime config
  │
  └─ re-exec: sandbox-exec -f /tmp/tx-<hash>.sb env TX_SANDBOXED=1 node tx <command> [args]
      │
      ├─ tx start: core tmux session + SDK workers (inherit sandbox)
      └─ tx run: HeadlessRunner + SDK workers (inherit sandbox)
```

`TX_SANDBOXED=1` is an environment variable (not a CLI flag) set by the sandbox wrapper to prevent re-exec loops. `TX_SANDBOX_PROFILE` stores the profile path for runtime introspection.

### Permission Model

When sandbox is active:
- Core tmux session launches with `--dangerously-skip-permissions`
- SDK workers use `bypassPermissions` mode
- Seatbelt profile is the security boundary, not Claude's permission system

When `--no-sandbox` or non-macOS:
- Current permission modes remain as configured
- bash-guard active as primary defense

### bash-guard Interaction

- macOS with sandbox active: bash-guard **disabled** at config load time
- Non-macOS: bash-guard **enabled** (primary defense)
- Users can still force bash-guard on via explicit `strict: true` in config

### Seatbelt Profile Structure

Generated `.sb` profile follows claundom's proven structure:

| Section | Rules |
|---------|-------|
| System runtime | `/System`, `/usr`, `/bin`, `/sbin`, `/Applications` — read+exec only |
| Temp directories | `/tmp`, `/private/tmp`, `$TMPDIR` — full read+write |
| Claude config | `~/.claude` — full read+write+exec |
| IDE/dev configs | `~/.vscode`, `~/.vim`, `~/.config` — read-only |
| Devices & TTY | `/dev/(tty*, null, zero, urandom)` — read+write |
| Mach IPC | System services, keychain, window server — allowed |
| Default denials | Credential dirs, personal dirs, shell history — blocked unless overridden |
| Project directory | `pwd` — full read+write+exec |
| Extra allow-list | Config-specified paths — full read+write+exec |
| Process execution | Restricted to system dirs, project dir, toolchains, and allowed paths |
| macOS app support | `~/Library/Application Support` — read-only |
| Network | Outbound unrestricted. Inbound local. All network ops to localhost allowed |

### CLI

```
tx start              # Sandbox off by default on first load
tx start --sandbox    # Force sandbox on for this session
tx start --no-sandbox # Force sandbox off for this session
```

Config controls the default:

```yaml
guardrails:
  sandbox:
    enabled: false    # default on first load; user sets to true to make sandbox the default
```

CLI flags override config for the session.

### Cross-Platform

| Platform | Defense | Notes |
|----------|---------|-------|
| macOS | Seatbelt | This spec |
| Linux/Windows | bash-guard | Current behavior unchanged |

When a second platform needs kernel sandboxing, extract an interface from `seatbelt.ts` at that point.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/sandbox/seatbelt.ts` | New — profile gen, validation, re-exec wrapping (~80 lines) |
| `src/sandbox/index.ts` | New — barrel export |
| `src/cli/start.ts` | Modify — sandbox detection, re-exec, --no-sandbox flag |
| `src/cli/run.ts` | Modify — same sandbox wrapping for headless mode |
| `src/worker/dispatcher.ts` | Modify — disable bash-guard when sandbox active |
| `src/worker/permissions.ts` | Modify — bypassPermissions when sandbox active |
| `docs/security.md` | Already written |
| `test/unit/seatbelt.test.ts` | New — profile generation tests |

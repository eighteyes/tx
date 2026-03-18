/**
 * Chrome Agents — Browser Access via CLI
 *
 * Documents the chrome agent runner, which spawns `claude --chrome --print`
 * as a child process instead of using the Agent SDK.
 *
 * Responsibilities:
 * - Explain when and why to use chrome agents
 * - Document configuration, behavior differences, and limitations
 * - Provide examples and troubleshooting guidance
 */

# Chrome Agents (Browser Access)

## Why

The Claude Agent SDK does not support `--chrome`. The CLI does. `ChromeCliRunner` wraps the CLI as a child process so mesh agents can use Claude's built-in Chrome browser capability.

## Configuration

Set `chrome: true` on any agent in a mesh config:

```yaml
agents:
  - name: browser
    model: sonnet
    prompt: browser.md
    chrome: true
```

## How It Works

When `chrome: true`, the dispatcher spawns a `claude --chrome --print` subprocess instead of creating an SDK session. The runner:

1. Dequeues a pending task from the SQLite queue
2. Builds CLI args: `--chrome --print --model <model> --output-format text --system-prompt <prompt> <task>`
3. Spawns the process with `child_process.spawn`
4. Streams stdout as `output` events
5. On close, emits `complete` or `error`

## Behavior Differences from SDK Runner

| Aspect | SDK Runner | Chrome Runner |
|--------|-----------|---------------|
| Execution | Agent SDK streaming session | CLI child process |
| Permissions (HITL) | Supported via `canUseTool` callback | Not supported (fire-and-forget) |
| Session resume | Supported via session ID | Not supported |
| Checkpoint/fork | Supported | Not supported |
| Token metrics | Full usage tracking | Zeroed (CLI doesn't expose) |
| Files changed | Tracked via SDK | Not tracked |
| Kill behavior | SDK abort controller | SIGTERM → SIGKILL after 5s |
| Max turns warning | Emitted at threshold | Not emitted |

## Incompatible Config Fields

These fields are silently ignored for chrome agents:

- `checkpoint` — no session state to save
- `fork_from` — no checkpoint to fork from
- `permissions` — CLI manages its own tool access
- `continuation` — no session to continue

## Kill Behavior

1. `kill()` sends SIGTERM to the CLI process
2. If the process hasn't exited after 5 seconds, SIGKILL is sent
3. This escalation exists because Chrome may not respond to SIGTERM gracefully

## Resume Guard

The dispatcher blocks resume attempts for chrome agents:
```
Cannot resume chrome agent — fire-and-forget
```

## When to Use Chrome vs Playwright MCP

| Use case | Recommendation |
|----------|---------------|
| Claude's built-in Chrome (screenshots, navigation) | `chrome: true` |
| Programmatic browser control (selectors, assertions) | `mcpServers` with Playwright MCP |
| Need HITL permissions during browsing | Playwright MCP (chrome doesn't support HITL) |
| Need session continuity across tasks | Playwright MCP (chrome is fire-and-forget) |

## Example: Browser Agent in a Mesh

```yaml
name: web-reviewer
description: "Review a website for accessibility issues"
agents:
  - name: reviewer
    model: sonnet
    prompt: reviewer.md
    chrome: true
entry_point: reviewer
```

`reviewer.md`:
```markdown
Navigate to the provided URL. Take screenshots of each page.
Evaluate accessibility: contrast, alt text, keyboard navigation, ARIA labels.
Write findings to workspace/accessibility-report.md.
```

## Troubleshooting

**Agent doesn't start:**
- Verify `claude` CLI is on PATH and authenticated
- Check logs: `tx logs -c chrome-cli-runner`

**Agent hangs after kill:**
- SIGKILL escalation fires after 5s automatically
- Check for orphaned Chrome processes: `ps aux | grep chrome`

**No output captured:**
- CLI uses `--print --output-format text` — verify Claude CLI version supports these flags

## Implementation

- Runner: `src/worker/chrome-cli-runner.ts`
- Interface: `src/worker/runner.ts`
- Shared kill classifier: `isGuardrailKill()` in `runner.ts`
- Dispatcher branch: `src/worker/dispatcher.ts` (spawn logic)
- Config field: `src/mesh/config-loader.ts` (`AgentConfig.chrome`)
- Tests: `test/unit/chrome-cli-runner.test.ts` (9 tests)

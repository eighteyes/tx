# Worker Runtime

Two parallel worker execution paths share one `Runner` interface so the dispatcher,
lifecycle tracker, and guardrail infrastructure stay agnostic. The first is the
existing Agent SDK runtime (`SdkRunner`). The second is a CLI-wrapping path
(`TmuxCliRunner` + `CliAdapter`) that drives external CLI agents — claude, codex,
opencode, pi-mono — inside tmux. A third, in-process path (`AgentLoopRunner` over
`LlmProvider` + `AgentLoop`) is wired through the same interface for tool-less
or MCP-only meshes; dispatcher selection for it is not yet enabled.

Underneath all three sits a zombie-safe lifecycle: an append-only inventory,
a polling reaper, a verified-dead kill ladder, and a boot reaper that reconciles
prior-run state on startup.

This doc describes the abstractions a contributor will touch when adding a new
runner kind, wrapping a new CLI tool, or hardening the lifecycle.

## Validation Status

PR 4 ships **seams**, not validated **capabilities**. The interfaces are real
and the unit tests prove the contracts are respected, but most of the
registered adapters and providers have never been driven against their real
backends. Treat the table below as the source of truth, not the adapter
registry.

| Surface | Built | Unit-tested | Smoke-tested live | Production-shaped |
|---|---|---|---|---|
| `SdkRunner` (Claude Agent SDK) | yes | yes | yes (existing path) | yes |
| `ClaudeCliAdapter` (tmux + claude CLI) | yes | yes | yes | partial — bespoke transcript parser is concrete; hook installation needs field hardening |
| `pi-mono` CLI adapter | yes | yes (construction only) | **no** | **no** |
| `codex` CLI adapter | yes | yes (construction only) | **no** | **no** |
| `opencode` CLI adapter | yes | yes (construction only) | **no** | **no** |
| `LlmProvider` interface | yes | yes | n/a — abstract | yes (shape) |
| `AnthropicProvider` | yes | yes | **no** — no mesh selects `AgentLoopRunner` yet | **no** |
| `AgentLoopRunner` dispatch | wired through `Runner` | yes (unit) | **no** — dispatcher does not select it yet | **no** |
| OpenRouter / OpenAI / Gemini provider | **not built** | — | — | — |
| Worker inventory + reaper | yes | yes | yes (SDK path) | yes |
| Kill ladder (tmux six-step) | yes | yes | yes | yes |
| Kill ladder (in-proc verified-dead) | yes | yes | partial — only via SDK runner; AgentLoopRunner path unvalidated | partial |
| Boot reaper (tmux only) | yes | yes | yes | yes |

**Reading the table.** "Built" = code exists. "Unit-tested" = green in
`src/**/__tests__/`. "Smoke-tested live" = actually exercised end-to-end against
a real backend in a real mesh. "Production-shaped" = the author would trust it
under load on their own work.

**What this means for contributors.**

- The `cli:` mesh-config field accepts `claude | pi-mono | codex | opencode`.
  Only `claude` has been driven end-to-end. The other three may have correct
  CLI flag wiring, broken transcript parsing, missing hook contracts, or
  pane-text idle classification that doesn't match the real tool. Plan to
  validate before relying on them.
- The native `AgentLoopRunner` path is reachable via the `Runner` interface
  but the dispatcher does not select it from any mesh config today. Until a
  mesh opts in (or the dispatcher learns to select it), `AnthropicProvider`
  and `AgentLoop` are exercised only by unit tests.
- Adding **OpenRouter** as an `LlmProvider` is the unblock for cheap-model
  routing under `AgentLoopRunner`. It is the natural first task under any
  cost-efficiency push. The abstraction is ready; the implementation is not.

## Table of Contents

- [Validation Status](#validation-status)
- [Runner interface](#runner-interface)
- [CliAdapter](#cliadapter)
- [LlmProvider and AgentLoop](#llmprovider-and-agentloop)
- [Worker lifecycle](#worker-lifecycle)
- [Integration points](#integration-points)
- [Known Limitations](#known-limitations)

---

## Runner interface

The common contract both runtimes implement. Source: `src/worker/runner.ts:36`.

```ts
export interface Runner extends EventEmitter {
  run(): Promise<WorkerResult>;
  kill(reason?: string): void;
  getKillReason(): string | null;
  wasGuardrailKill(): boolean;
  getSessionId(): string | null;
  isRunning(): boolean;
  interrupt(): Promise<void>;
  resume(sessionId: string, feedback: string): Promise<WorkerResult>;
  resolvePermission(toolUseID: string, allow: boolean, message?: string): boolean;
  getFilesChanged?(): FileChangeSummary;
  hasActiveQuery?(): boolean;
}
```

**Lifecycle.** `run()` spawns whatever backend the runner needs, drives it to
completion, and resolves with a `WorkerResult`. `kill(reason)` records the
reason synchronously and triggers teardown; the kill ladder polls
`isRunning()` to confirm the runner reached a verified-dead state. `resume()`
restarts work against a prior session id (each backend defines its own
session semantics — see below). `interrupt()` is the "soft" stop used by
mesh lifecycle; it shells out to `kill()` for in-process runners.

**Events.** Each runner emits the same event names so the dispatcher can
subscribe once. Documented inline at `src/worker/runner.ts:24-35`:

| Event | Payload | Trigger |
|-------|---------|---------|
| `start` | `{ id }` | run() entered |
| `init` | `{ id, sessionId, tools? }` | first turn / session established |
| `init-anchor` | `{ id, firstUserMessageUuid }` | first user message persisted (SDK path) |
| `output` | `{ id, data }` | text/tool delta visible |
| `complete` | `{ id, messagesProcessed, output, sessionId, metrics }` | success terminal |
| `error` | `{ id, error }` | failure terminal |
| `permission-ask` | `{ id, toolName, toolUseID }` | HITL prompt pending |
| `usage-policy-error` | `{ id, error }` | Anthropic usage-policy refusal |
| `interrupted` | `{ id, sessionId }` | aborted before completion |
| `max-turns-warning` | `{ id, turnCount, maxTurns }` | approaching turn cap |

**What the contract guarantees.**

- `kill()` is non-blocking; verified death is the kill ladder's job, not the
  runner's. Implementations only need to flip `isRunning()` to `false` once
  the underlying process/loop is actually gone.
- Exactly one of `complete`, `error`, or `interrupted` fires per `run()`.
- `getSessionId()` returns null until the backend has established one. The
  shape of the id is backend-specific; the dispatcher never parses it.
- `wasGuardrailKill()` distinguishes operational kills (revisions, mesh
  shutdown, ask-human) from guardrail kills via the shared
  `isGuardrailKill()` classifier at `src/worker/runner.ts:17`. New runners
  reuse that helper rather than rolling their own classifier.

**What is left to implementations.**

- Concurrency: `run()` may be called once or many times across a runner
  instance's lifetime; the SDK and CLI runners use a fresh `AbortController`
  per call. `AgentLoopRunner` keeps message history across calls so
  `resume()` can append a follow-up to it (see `src/worker/agent-loop-runner.ts:124`).
- Permission semantics: `resolvePermission()` only matters if the backend
  surfaces `permission-ask` events. `AgentLoopRunner.resolvePermission()`
  currently returns false unconditionally (`src/worker/agent-loop-runner.ts:208`)
  because the hook middleware is not yet plumbed.
- `getFilesChanged()` and `hasActiveQuery()` are optional. Runners that
  cannot observe filesystem mutations omit the first; runners with no
  notion of "active query" omit the second.

---

## CliAdapter

The abstraction for wrapping external CLI agents. Source:
`src/cli-adapter/adapter.ts`.

`TmuxCliRunner` is generic over a `CliAdapter`. Adding a new tool is a single
new adapter (or a config-driven generic factory call), not a new runner.

### The interface

`CliAdapter` (`src/cli-adapter/adapter.ts:120`) is intentionally tight — just
enough to launch, resume, observe, and interrupt. Tool-specific quirks live
inside each adapter, never in the runner.

| Method | Purpose |
|--------|---------|
| `discover()` | Locate the binary; null means refuse to spawn. |
| `buildArgs(opts)` | Argv for a fresh task. Runner spawns `argv[0]` with `argv.slice(1)`. |
| `buildResumeArgs(opts)` | Argv for resume. Throws if `capabilities.sessionResume === false`. |
| `envOverrides(opts)` | Extra env vars to merge with the spawn env. |
| `transcriptPath(workDir, sessionId?)` | Where the tool writes its transcript, or null. |
| `readTranscript(path, cursor?)` | Incremental parse into `ProviderMessage[]`; returns updated cursor. |
| `extractSessionId(transcriptPath)` | Recover the session id from transcript metadata. |
| `isIdle(paneContent)` | Heuristic: pane is awaiting user input. |
| `detectPermissionPrompt?(paneContent)` | Optional — only useful for hook-less tools. |
| `installHooks?(workDir, hooks)` | Optional — only for `hookSupport !== 'none'`. |
| `interruptKey?()` | Tmux send-keys argument for interrupt (default `C-c`). |

**Capabilities** (`src/cli-adapter/adapter.ts:27`) declare what the runner can
expect. The runner consults them to decide resume-vs-fresh and sandbox
tightness:

| Field | Values | Meaning |
|-------|--------|---------|
| `sessionResume` | bool | Tool can resume by id |
| `structuredTranscript` | bool | Tool emits a machine-readable transcript |
| `hookSupport` | `none` \| `shell-scripts` \| `native` | How user hooks are installed |
| `trustTier` | `full-hooks` \| `sandbox-only` \| `read-only` | Runner-side fence tightness |

Transcript output is normalized to `ProviderMessage[]` from the LLM tier so
both runtime paths emit the same downstream message types.

### ClaudeCliAdapter (bespoke)

`src/cli-adapter/claude-adapter.ts`. Reference implementation against which
the interface was designed.

Capabilities:

```ts
{ sessionResume: true, structuredTranscript: true,
  hookSupport: 'shell-scripts', trustTier: 'full-hooks' }
```

Notable pieces:

- **Binary discovery** (`src/cli-adapter/claude-adapter.ts:64`) checks a small
  list of known paths plus `which claude`. `discover()` returns null if none
  resolve.
- **Transcript layout.** Claude writes JSONL to
  `~/.claude/projects/<slug>/<sessionId>.jsonl` where `<slug>` is the abs
  workDir with non-`[A-Za-z0-9_]` chars replaced by `-`
  (`workDirSlug()` at `src/cli-adapter/claude-adapter.ts:44`). If the
  algorithm shifts in a future claude release, the runner falls back to
  newest matching directory.
- **Incremental read.** `readTranscript()` uses byte-offset cursors and backs
  the cursor up to the last newline so partial lines re-read cleanly
  (`src/cli-adapter/claude-adapter.ts:277-285`).
- **Pure idle classifier.** `isClaudePaneIdle()` at
  `src/cli-adapter/claude-adapter.ts:92` ports `core/tmux.ts`'s idle logic
  into a pure function over captured pane text. The runner does the capture;
  the adapter just classifies. Signals: presence of "esc to interrupt",
  Braille spinner glyphs, or tool-status lines (`Running`, `Executing`,
  `Reading`, ...).
- **Hook installation.** `installHooks()` at
  `src/cli-adapter/claude-adapter.ts:302` merges into
  `.claude/settings.local.json`, preserving any user-provided hooks under
  the `PreToolUse` / `PostToolUse` / `UserPromptSubmit` events.

### createGenericCliAdapter (factory)

`src/cli-adapter/generic-adapter.ts:83`. Configuration-driven `CliAdapter`
for any tmux-runnable CLI agent — the fastest way to add a new tool.

Defaults are deliberately conservative: `sandbox-only` trust, `none` hook
support, no resume, no transcript parsing. The runner falls back to pane-text
observation and tears down via the kill ladder, so even a minimal config is
safe.

`GenericCliAdapterConfig` shape:

| Field | Required | Default behavior |
|-------|----------|------------------|
| `name` | yes | Adapter identifier in the registry |
| `binary` | yes | Path or PATH-relative command |
| `versionArg` | no | `--version`; pass `null` to skip probing |
| `argv(opts)` | no | `[binary, --model, opts.model?]` |
| `resumeArgv(opts)` | no | Omit to opt out of session resume |
| `env(opts)` | no | `{}` |
| `transcriptDir(workDir)` | no | Omit to skip transcript parsing |
| `transcriptExt` | no | `.jsonl` |
| `transcriptParser(chunk)` | yes if `transcriptDir` set | Parse chunk into `ProviderMessage[]` |
| `sessionIdFromPath(path)` | no | Filename stem with extension stripped |
| `idleHints` | no | Regex(es); absent → always idle |
| `capabilities` | no | Partial override over the conservative defaults |
| `interruptKey` | no | `C-c` |

Consistency guards fire at construction (`src/cli-adapter/generic-adapter.ts:94`):
claiming `sessionResume: true` without supplying `resumeArgv`, or
`structuredTranscript: true` without `transcriptParser`, throws immediately.

Three reference configs ship in the same file:

| Name | Source | Notes |
|------|--------|-------|
| `pi-mono` | `src/cli-adapter/generic-adapter.ts:254` | Minimal config; refine `binary`, `argv`, `idleHints` once the surface is known |
| `codex` | `src/cli-adapter/generic-adapter.ts:227` | Adds `idleHints` for `thinking…`, `executing`, `running command` |
| `opencode` | `src/cli-adapter/generic-adapter.ts:242` | Minimal config |

All three are registered by default at `src/cli/start.ts:437-441` alongside
`ClaudeCliAdapter`. They are not exercised by any in-tree mesh yet — the
configs are intentionally placeholders until validated against the real
binaries. Refine in place.

### The `cli:` mesh-config field

A mesh agent opts into the wrapped-CLI path by setting `cli: <adapter-name>`
on its agent entry. Schema:

- `src/mesh/config-loader.ts:126` declares the field: `cli?: string`
- `src/worker/mesh-validator.ts:272` accepts it in the per-agent JSON schema

```yaml
# meshes/example/config.yaml
agents:
  reviewer:
    prompt: prompts/reviewer.md
    cli: claude        # wrap the `claude` CLI via TmuxCliRunner
```

When the dispatcher spawns this agent, it resolves `agent.cli` against the
`CliAdapterRegistry` and constructs a `TmuxCliRunner` rather than an
`SdkRunner`. See [Integration points](#integration-points).

**Search the tree:** as of this PR no in-tree mesh sets `cli:`; every mesh
remains on `SdkRunner`. That is by design — see "zero behavior change" in
[Integration points](#integration-points).

---

## LlmProvider and AgentLoop

The in-process (non-CLI) path. Source: `src/llm/`.

### LlmProvider — pure transport

`src/llm/provider.ts:104`. Stateless. The caller owns history; the provider
only knows how to take a `ProviderRequest` and stream `ProviderEvent`s back.

```ts
export interface LlmProvider {
  readonly name: string;
  complete(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}
```

`ProviderEvent` union (`src/llm/provider.ts:92`):

| Event | Carries |
|-------|---------|
| `text-delta` | `delta: string` |
| `tool-use-start` | `id, name` |
| `tool-use-delta` | `id, partialJson` |
| `tool-use-end` | `id, input` (parsed) |
| `message-stop` | `stopReason, usage, stopSequence?` |
| `error` | `error: string` |

A provider stream always ends with exactly one `message-stop` or `error`
event — never both, never neither. `AgentLoop` and the
`collectStream()` helper at `src/llm/provider.ts:122` both rely on that
invariant.

**Stop reasons** are Anthropic-shaped (`src/llm/provider.ts:83`):

```ts
type ProviderStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
```

OpenAI/Gemini providers will need to map their finish reasons into this set
or extend the union. See [Known Limitations](#known-limitations).

**Usage** (`src/llm/provider.ts:66`) carries input/output tokens plus optional
cache read/write. Pricing/cost is deliberately not a provider concern; it
lives in a separate module keyed by `(provider name, model, usage)`.

### AnthropicProvider

`src/llm/anthropic-provider.ts:62`. `LlmProvider` impl over
`@anthropic-ai/sdk` (the raw SDK, not the Agent SDK). Uses
`client.messages.stream()` and normalizes raw events
(`message_start`, `content_block_start`, `content_block_delta`,
`message_delta`, `message_stop`) into our `ProviderEvent` union.

Details worth knowing:

- Client is injectable through `AnthropicProviderOptions.client` for unit
  testing (`src/llm/anthropic-provider.ts:55`). Tests pass a fake
  `{ messages: { stream } }` and avoid network calls.
- `mapStopReason()` at `src/llm/anthropic-provider.ts:215` maps known
  Anthropic stop reasons one-to-one; unknown future reasons collapse to
  `end_turn` rather than throwing — chosen so a new SDK release doesn't
  break the loop.
- Tool-arg JSON arrives as a stream of `input_json_delta` partials; the
  provider accumulates per-tool-call and parses on `content_block_stop`.
  Malformed JSON yields an empty input dict, which `AgentLoop` will surface
  as a tool error (`src/llm/anthropic-provider.ts:140-148`).
- If the stream ends cleanly without an explicit `message_stop`, the
  provider synthesizes one so downstream collectors always see a terminal
  event (`src/llm/anthropic-provider.ts:179`).

### AgentLoop — the tool-use cycle

`src/llm/agent-loop.ts:86`. Drives an `LlmProvider` in a tool-use loop.

Responsibilities:

1. Hold message history across turns.
2. Call `provider.complete()`; accumulate the assistant message; forward
   each `ProviderEvent` via the `provider-event` event for observers.
3. On `tool_use` stop reason: execute each tool through the `ToolHost`,
   append `tool_result` blocks, loop.
4. On any terminal stop (`end_turn` / `max_tokens` / `stop_sequence`),
   max-turns hit, or abort signal: return.

Loop result (`src/llm/agent-loop.ts:66`):

```ts
interface AgentLoopResult {
  messages: ProviderMessage[];
  stopReason: ProviderStopReason;
  totalUsage: ProviderUsage;
  turns: number;
  maxTurnsHit: boolean;  // hit the configured maxTurns
  aborted: boolean;      // abort signal fired
}
```

Events emitted (in addition to forwarded provider events,
`src/llm/agent-loop.ts:78-85`):

| Event | Payload |
|-------|---------|
| `turn-start` | `{ turn }` |
| `provider-event` | the forwarded `ProviderEvent` |
| `turn-end` | `{ turn, stopReason, usage }` |
| `tool-execution-start` | `{ id, name, input }` |
| `tool-execution-end` | `{ id, name, result }` |
| `loop-end` | `{ stopReason, totalUsage, turns, maxTurnsHit, aborted }` |

**Hooks.** `AgentLoopHooks` (`src/llm/agent-loop.ts:51`) sits around tool
execution:

```ts
interface AgentLoopHooks {
  preToolUse?: (call, signal?) => Promise<PreToolDecision> | PreToolDecision;
  postToolUse?: (call, result, signal?) => Promise<ToolExecutionResult> | ToolExecutionResult;
}

type PreToolDecision =
  | { allow: true }
  | { allow: false; result: ToolExecutionResult };
```

`preToolUse` can short-circuit a call by returning `{ allow: false, result }`;
`postToolUse` can rewrite the result. Phase 2d will route bash-guard /
write-gate / read-gate / message-gate / identity-gate / postcondition-validator
through these seams. Hook throws are caught and converted to tool errors
(`src/llm/agent-loop.ts:243-247`, `src/llm/agent-loop.ts:262-268`).

### ToolHost

`src/llm/tool-host.ts:21`. The agent runtime's view of tool execution.

```ts
interface ToolHost {
  list(): ProviderToolSpec[];
  execute(name, input, signal?): Promise<ToolExecutionResult>;
}
```

Distinct from `LlmProvider` on purpose: provider is pure transport,
`ToolHost` is environment-side execution. Implementations (built-in
Read/Write/Edit/Glob/Grep/Bash plus the MCP bridge) land in phase 3.

### AgentLoopRunner

`src/worker/agent-loop-runner.ts:50`. Wraps `AgentLoop` so it satisfies the
`Runner` interface.

Lifecycle parallels `TmuxCliRunner`:

- `run()` → constructs an `AgentLoop` with the configured provider and
  optional tool host, subscribes to `turn-start` (to emit `init` once) and
  `provider-event` (to emit `output` deltas), then `loop.run(initial)`
  (`src/worker/agent-loop-runner.ts:79-114`).
- `kill(reason)` → records the reason and aborts via
  `AbortController.abort()` (`src/worker/agent-loop-runner.ts:164`). The
  loop checks the signal before each turn and between tool calls
  (`src/llm/agent-loop.ts:104, 152`), so abort is observed promptly.
- `resume(sessionId, feedback)` → refuses on session-id mismatch; otherwise
  appends feedback as the next user message and re-enters `run()`
  (`src/worker/agent-loop-runner.ts:188-206`). The runner keeps its synthetic
  session id across resumes because `AgentLoop` is stateless — the held
  history is the session.

Without a `ToolHost` the model can issue no tool calls. For meshes that need
built-in tools (Read/Write/Edit/Bash/...), the current direction is to use
`cli: 'claude'` — built-in tool reimplementation was explicitly cut from
the plan when the CLI-wrap runtime landed
(`src/worker/agent-loop-runner.ts:5-10`).

Until phase 2d wires the hook middleware, `AgentLoopRunner` has no in-proc
guardrails — boundary-tier trust only — and `resolvePermission()` is a
no-op (`src/worker/agent-loop-runner.ts:208`).

---

## Worker lifecycle

Zombie-safe primitives in `src/worker/`. The dispatcher records every state
transition; the reaper polls liveness; the kill ladder forces verified-dead;
the boot reaper reconciles prior-run state at startup.

### worker-inventory.jsonl

Path: `.ai/tx/data/worker-inventory.jsonl`. Source:
`src/worker/worker-inventory.ts`.

Append-only JSONL. One record per state transition. Latest record per
`workerId` wins (fold semantics, `currentStates()` at
`src/worker/worker-inventory.ts:107`). Sync writes via `appendFileSync` —
state changes are O(few per worker), not O(per tool call); crash safety
beats throughput here.

Record schema (`src/worker/worker-inventory.ts:30`):

| Field | Type | Notes |
|-------|------|-------|
| `ts` | number | ms epoch |
| `runId` | string | TX process run id (boot reaper uses this to find foreign runs) |
| `workerId` | string | Per-worker id |
| `agentId` | string | Mesh agent name |
| `runnerKind` | `'sdk'` \| `'tmux'` \| `'agent-loop'` | Probe dispatch hint |
| `workDir` | string | Where the worker is operating |
| `state` | `WorkerState` | See state machine below |
| `sessionName?` | string | tmux only |
| `claudePid?` | number | tmux only |
| `pgid?` | number | tmux only — process group id |
| `transcriptPath?` | string | tmux only — `~/.claude/projects/...` JSONL |
| `reason?` | string | Human-readable transition reason |

`WorkerState` (`src/worker/worker-inventory.ts:18`):

```
spawning  — tmux session created / SDK query() about to start
running   — first signs of life observed
stalled   — no observable progress for stall threshold (still alive)
killed    — explicit kill issued; awaiting verified-dead probes
crashed   — process gone without a result message
exiting   — result observed, teardown in progress
exited    — verified dead by liveness probes (terminal)
orphaned  — discovered post-mortem (TX restart; terminal after reap)
```

`TERMINAL_STATES` is `{ exited, orphaned }`. `compact()` rewrites the file
keeping only non-terminal entries so it never grows unboundedly across runs
(`src/worker/worker-inventory.ts:130`).

### WorkerReaper

`src/worker/worker-reaper.ts:69`. Out-of-band heartbeat + zombie detector.
Reads the inventory as source of truth, probes liveness per runner kind,
and emits state-change events. Makes no policy decisions — the dispatcher
subscribes and acts.

State machine (`src/worker/worker-reaper.ts:218-261`):

```
spawning|running ─ probes fail ─→ crashed ─ probes confirm dead ─→ exited
                 ↘ no activity ─→ stalled ─ activity resumes ─→ running
                                          ↘ probes fail ─→ crashed
killed|exiting ──── probes confirm dead ──→ exited
```

Terminal states are skipped on every tick. The reaper never transitions
INTO `killed` — that is the kill ladder's job; the reaper only transitions
OUT of `killed` via the `verified-dead` event.

Defaults: poll every 3000 ms, stall threshold 60000 ms
(`src/worker/worker-reaper.ts:85-86`).

Events emitted:

| Event | Payload |
|-------|---------|
| `state-change` | `StateTransition` |
| `verified-dead` | `{ workerId, from }` — fires when a `killed`/`exiting`/`crashed` worker transitions to `exited` |
| `stalled` | `{ workerId, stallMs }` |
| `crashed` | `{ workerId, reason }` |

`attachRunner(workerId, runner)` (`src/worker/worker-reaper.ts:119`)
registers an in-process runner so the reaper can call `isRunning()` and
bump `lastOutputAt` on every `output` / `init` event. Required for `sdk`
and `agent-loop` kinds; tmux workers are probed externally via
`tmuxSessionAlive` + `pidAlive` + transcript mtime
(`src/worker/worker-reaper.ts:285-297`).

`waitForVerifiedDead(workerId, timeoutMs)` is the kill-ladder's
synchronization handle (`src/worker/worker-reaper.ts:142`). It checks the
inventory first to handle the race where the ladder verified before the
caller subscribed.

### Kill ladder

`src/worker/kill-ladder.ts:116`. Verified-dead teardown for any runner kind.

Tmux ladder (`src/worker/kill-ladder.ts:165`):

1. `tmux send-keys C-c` (polite cancel of the TUI)
2. `SIGINT` to claude PID
3. `SIGTERM` to the process group (claude + MCP + subshells)
4. `tmux kill-session` (with up to 3000 ms poll for disappearance)
5. `SIGKILL` to the process group
6. `SIGKILL` to the claude PID (last resort if pgid was missing/wrong)

In-process ladder (`src/worker/kill-ladder.ts:236`):

1. `runner.kill(reason)`, then poll `runner.isRunning()` until false or
   `inProcKillTimeoutMs` (default 5000 ms) elapses.

Between every step the ladder probes liveness through the injectable
`KillIO.isAlive()` and exits early the moment probes confirm dead. If the
ladder exhausts all steps with the worker still alive, it returns
`verified: false` and leaves the inventory in `killed` — the reaper keeps
checking and flips to `exited` once probes finally drop
(`src/worker/kill-ladder.ts:147-156`).

`KillIO` (`src/worker/kill-ladder.ts:54`) factors out all side effects:
`sendKeysCancel`, `sigintPid`, `sigtermGroup`, `sigkillGroup`, `sigkillPid`,
`tmuxKillSession`, `isAlive`, `sleep`. Tests inject a fake to script the
exact moment a process "dies."

The verified-dead gate for in-process runners lives at
`src/worker/kill-ladder.ts:253-261`:

```ts
const deadline = Date.now() + (opts.inProcKillTimeoutMs ?? 5000);
while (Date.now() < deadline) {
  if (!runner.isRunning()) {
    step.verifiedDead = true;
    return true;
  }
  await io.sleep(100);
}
return false;
```

See [Known Limitations](#known-limitations) for a TTL gap here.

### Boot reaper

`src/worker/boot-reaper.ts:64`. One-shot reconciliation at TX startup. Runs
BEFORE the dispatcher accepts work.

What it does:

1. Reads `worker-inventory.jsonl` and finds non-terminal entries whose
   `runId` differs from the current run (`forOtherRuns(currentRunId)`,
   `src/worker/worker-inventory.ts:121`).
2. For each foreign tmux entry: if the session is gone, mark `orphaned`
   with reason "session already gone"; otherwise kill the session and mark
   `orphaned`. For each foreign `sdk` / `agent-loop` entry: mark `orphaned`
   directly — they're definitionally gone once the host TX restarted.
3. Defensive sweep: list live `tx-w-*` sessions and kill any without an
   inventory entry — covers the case where an inventory write was lost
   before crash (`src/worker/boot-reaper.ts:115-125`).
4. Optionally `inventory.compact()` so the file shrinks to near-zero
   between runs.

**Why it only trusts tmux sessions and not PIDs.** From
`src/worker/boot-reaper.ts:9-12`:

> PIDs are reused across reboots; a stale record could falsely "kill" an
> unrelated process. The only authoritative signal for prior-run tmux
> workers is the tmux session itself.

In-proc runners are already gone after a TX restart, so no probing is
needed for them.

`BootReaperResult` reports counts (`src/worker/boot-reaper.ts:22`):
`inventoryReaped`, `unknownSessionsKilled`, `failures`.

---

## Integration points

### Dispatcher runner selection

`src/worker/dispatcher.ts:5287-5324`. Per-agent runner selection at spawn
time:

```ts
//   agent.cli: '<name>' → TmuxCliRunner wrapping the named CliAdapter
//                         (claude/codex/opencode/...)
//   agent.chrome: true  → ChromeCliRunner (existing browser-capable path)
//   else                → SdkRunner (default Agent SDK in-proc)
let worker: Runner;
if (agent.cli && this.cliAdapters && this.currentRunId) {
  const adapter = this.cliAdapters.get(agent.cli);
  if (!adapter) {
    throw new Error(`agent '${agentId}' requested cli='${agent.cli}' ...`);
  }
  worker = new TmuxCliRunner({ ... adapter, ... });
} else if (agent.chrome) {
  worker = new ChromeCliRunner({ ... });
} else {
  worker = new SdkRunner(runnerConfig, this.queue);
}
```

The `runnerKind` recorded in the inventory follows the same fork — `'tmux'`
for `cli:`-opted agents, `'sdk'` otherwise
(`src/worker/dispatcher.ts:6519`). `AgentLoopRunner` is implemented and
unit-tested but **not yet wired through the dispatcher**; the selection
clause for it is the next step.

### Adapter registry construction

`src/cli/start.ts:437-441` builds the registry at TX startup and passes it
to the dispatcher via `cliAdapters` option (`src/worker/dispatcher.ts:125`):

```ts
const cliAdapters = new CliAdapterRegistry()
  .register(new ClaudeCliAdapter())
  .register(createGenericCliAdapter(CODEX_REFERENCE_CONFIG))
  .register(createGenericCliAdapter(OPENCODE_REFERENCE_CONFIG))
  .register(createGenericCliAdapter(PI_MONO_REFERENCE_CONFIG));
```

Adding a new tool: either register a bespoke `CliAdapter` here, or write a
`GenericCliAdapterConfig` (see `src/cli-adapter/generic-adapter.ts:227+`
for the references) and add a fifth `.register(...)`.

### Mesh opt-in

A mesh agent opts in by setting `cli: <adapter-name>` in `config.yaml`.
Schema-validated at `src/worker/mesh-validator.ts:272`. Example:

```yaml
agents:
  reviewer:
    prompt: prompts/reviewer.md
    model: sonnet
    cli: claude
```

If the adapter name is not in the registry, the dispatcher throws at spawn
time rather than silently falling back — wrong `cli:` is a config bug,
not a graceful-degradation case.

### "Zero behavior change" for existing meshes

The CLI-wrap path is strictly additive:

- The mesh schema field `cli?: string` is optional
  (`src/mesh/config-loader.ts:126`).
- Dispatcher falls through to `SdkRunner` when `agent.cli` is unset
  (`src/worker/dispatcher.ts:5322`).
- No in-tree mesh sets `cli:` (verified by `rg 'cli:' meshes/*/config.yaml`
  at PR time).
- `runnerKind` defaults to `'sdk'` so the reaper and kill ladder continue
  using the in-proc probe path.

Net effect: every existing mesh continues to spawn `SdkRunner` with the
same configuration it had before this PR. The new abstractions only
activate when a mesh explicitly opts in.

---

## Known Limitations

**Kill-ladder verified-dead gate has no TTL for in-proc runners.** The
in-process ladder (`src/worker/kill-ladder.ts:253-261`) polls
`runner.isRunning()` until either `inProcKillTimeoutMs` (default 5000 ms)
elapses or the runner flips to false. On timeout the inventory record
stays in `killed`; the reaper continues to probe via `runner.isRunning()`
and will flip to `exited` if that ever returns false. Under pathological
tool-host hangs — e.g. a synchronous tool that never returns and never
honors the abort signal — the runner's `isRunning()` stays true
indefinitely and the inventory record remains in `killed` forever. There
is no second TTL after which the record is force-transitioned to
`orphaned`. A future hardening pass should add one (and an audible signal
when the gate trips), or the runner contract should be tightened to
require abort-signal honoring within a bounded window.

**LlmProvider stop-reason union is Anthropic-shaped.** The
`ProviderStopReason` type (`src/llm/provider.ts:83`) is
`end_turn | tool_use | max_tokens | stop_sequence | error`. OpenAI's
`finish_reason` values (`stop`, `length`, `tool_calls`, `content_filter`,
`function_call`) and Gemini's `FinishReason` set
(`STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `OTHER`) do not all map
cleanly. `stop` → `end_turn`, `length` → `max_tokens`, `tool_calls`
→ `tool_use` are obvious; `content_filter` / `SAFETY` / `RECITATION`
have no current variant and would either need to collapse to `error`
(losing semantic information) or extend the union (the cleaner option).
The provider notes the Anthropic-native choice up front
(`src/llm/provider.ts:7-11`); the union extension should land alongside
the first OpenAI / Gemini provider so the new variants are exercised by a
real consumer.

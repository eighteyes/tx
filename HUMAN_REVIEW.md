# Human Review

## Bug Finder Mesh
Date: 2026-03-06
Commit: 1c6c23f

### Files Created
- `meshes/bug-finder/config.yaml` — 3 agents (crawler, tester, synthesizer), FSM with dynamic ensemble
- `meshes/bug-finder/crawler.md` — Crawl from URL, build sitemap.yaml, cap at 20 pages
- `meshes/bug-finder/tester.md` — Ensemble worker, test one page at 3 viewports
- `meshes/bug-finder/synthesizer.md` — Deduplicate, rank severity, write reports

### Verification Steps

#### 1. Config YAML validates
```bash
yq . meshes/bug-finder/config.yaml
```
- [ ] Valid YAML, no errors

#### 2. Prompt dry-run
```bash
for agent in crawler tester synthesizer; do
  echo "=== $agent ===" && tx prompt bug-finder $agent --raw 2>&1 | head -3
done
```
- [ ] Each agent shows prompt content

#### 3. Dev mode smoke test
```bash
yq -i '.dev_mode = true' meshes/bug-finder/config.yaml
tx msg bug-finder "Crawl and test https://example.com"
```
- [ ] Crawler discovers pages, writes sitemap.yaml with page_count
- [ ] Tester ensemble spawns $page_count workers in parallel
- [ ] Synthesizer deduplicates and writes bug-report.md + bug-fixer-input.md
- [ ] Remove dev_mode: `yq -i 'del(.dev_mode)' meshes/bug-finder/config.yaml`

#### 4. Playwright MCP loads for crawler and tester
- [ ] Both agents have access to `browser_navigate`, `browser_screenshot` etc.

#### 5. FSM state transitions
- [ ] crawl → testing (dynamic ensemble with $page_count)
- [ ] testing → synthesis → complete

---

## Bug Know Finder Mesh
Date: 2026-03-06
Commit: 1c6c23f

### Files Created
- `meshes/bug-know-finder/config.yaml` — 5 agents, FSM with named ensemble (spec-reader + gap-detector)
- `meshes/bug-know-finder/spec-reader.md` — Query spec-graph via `know` CLI, extract assertions
- `meshes/bug-know-finder/gap-detector.md` — Crawl site with PW MCP, compare vs spec interfaces
- `meshes/bug-know-finder/test-writer.md` — Generate .spec.ts from spec assertions
- `meshes/bug-know-finder/runner.md` — Run generated tests, investigate failures with PW MCP
- `meshes/bug-know-finder/synthesizer.md` — Merge test failures + gap analysis into reports

### Verification Steps

#### 1. Config YAML validates
```bash
yq . meshes/bug-know-finder/config.yaml
```
- [ ] Valid YAML, no errors

#### 2. Prompt dry-run
```bash
for agent in spec-reader gap-detector test-writer runner synthesizer; do
  echo "=== $agent ===" && tx prompt bug-know-finder $agent --raw 2>&1 | head -3
done
```
- [ ] Each agent shows prompt content

#### 3. Dev mode smoke test
```bash
yq -i '.dev_mode = true' meshes/bug-know-finder/config.yaml
tx msg bug-know-finder "Test https://example.com against the spec-graph"
```
- [ ] spec-reader and gap-detector run in parallel (named ensemble)
- [ ] spec-reader writes spec-assertions.yaml
- [ ] gap-detector writes gap-analysis.yaml
- [ ] test-writer generates .spec.ts files
- [ ] runner executes tests, writes test-results.yaml
- [ ] synthesizer writes spec-violations.md, spec-gaps.md, bug-report.md, bug-fixer-input.md
- [ ] Remove dev_mode: `yq -i 'del(.dev_mode)' meshes/bug-know-finder/config.yaml`

#### 4. FSM state transitions
- [ ] analyze (named ensemble: spec-reader + gap-detector) → inspect → generate → run → synthesis → complete
- [ ] Analyze ensemble has 600s timeout

#### 5. Inspector HITL flow
- [ ] Inspector reads spec-assertions.yaml and visits pages with Playwright
- [ ] Inspector produces selector-map.yaml with real selectors
- [ ] When conflicts exist (found: false), inspector sends ask-human to core/core
- [ ] Mesh suspends until human responds with guidance
- [ ] Test-writer reads selector-map.yaml (NOT spec-assertions.yaml)

#### 6. Playwright MCP loads for gap-detector, inspector, and runner
- [ ] All three agents have access to `browser_navigate`, `browser_screenshot` etc.

#### 7. Spec-graph access
- [ ] spec-reader can run `know list`, `know get`, `know graph` commands

---

## Bug Fixer Mesh
Date: 2026-03-05
Commit: 8c9e0cc

### Files Created
- `meshes/bug-fixer/config.yaml` — 6 agents, FSM with 7 states, dynamic ensembles, batch loop
- `meshes/bug-fixer/triage.md` — Parse bug list, write bugs.yaml, set bug_count
- `meshes/bug-fixer/researcher.md` — Investigate one bug, find files, report dependencies
- `meshes/bug-fixer/planner.md` — Group bugs into non-conflicting batches by file overlap
- `meshes/bug-fixer/fixer.md` — Fix one bug + write Playwright test
- `meshes/bug-fixer/validator.md` — Run Playwright, compute FSM routing signals
- `meshes/bug-fixer/reporter.md` — Final summary of fixed/skipped bugs

### Verification Steps

#### 1. Config YAML validates
```bash
yq . meshes/bug-fixer/config.yaml
```
- [ ] Valid YAML, no errors

#### 2. Prompt dry-run (if tx prompt is available)
```bash
for agent in triage researcher planner fixer validator reporter; do
  echo "=== $agent ===" && tx prompt bug-fixer $agent --raw 2>&1 | head -3
done
```
- [ ] Each agent shows prompt content

#### 3. Dev mode smoke test
```bash
# Add dev_mode: true to config.yaml temporarily
yq -i '.dev_mode = true' meshes/bug-fixer/config.yaml
```
Send a test bug list:
```bash
tx msg bug-fixer "1. Button click handler missing on submit form
2. Dark mode CSS not applied to navbar
3. API timeout on /api/users endpoint"
```
- [ ] Triage parses 3 bugs, writes bugs.yaml
- [ ] 3 researchers spawn in parallel
- [ ] Planner groups into batches
- [ ] Remove dev_mode after testing: `yq -i 'del(.dev_mode)' meshes/bug-fixer/config.yaml`

#### 4. FSM batch loop validates
- [ ] Validator outputs `success_signal`, `next_batch_index`, `next_retry_count`, `next_batch_size` in rearmatter
- [ ] FSM transitions from validating → fixing on NEXT_BATCH/RETRY/SKIP_BATCH
- [ ] FSM transitions from validating → reporting on ALL_DONE
- [ ] Batch counter increments correctly between batches

#### 5. Playwright MCP loads for validator
- [ ] Confirm validator agent has access to `browser_navigate`, `browser_screenshot` etc.

### Known Design Decisions
- FSM (not dispatcher) handles all parallelism — dynamic ensemble count requires runtime variable resolution
- Validator computes all next-state context values in rearmatter (FSM per-clause set is unsupported)
- Validator routes to core (FSM intercepts for self-loop, matching test-fsm-loop pattern)

---

## Parallel Mesh Execution
Date: 2026-03-02

### Files Created
- `src/queue/index.ts` — `parallel_instances` table + 6 methods (insertInstance, getInstance, completeInstance, listInstances, countRunningInstances, markStaleInstances)

### Files Modified
- `src/core/consumer.ts` — parallel/mesh-id frontmatter parsing, spawn-instance event, route rewriting, max_instances enforcement, mesh-id validation
- `src/worker/dispatcher.ts` — mesh-id session isolation, prompt injection for parallel context
- `src/workspace/injector.ts` — `injectParallelInstanceContext()` method
- `src/worker/guardrail-config.ts` — `MaxInstancesOverride` interface, `getMaxInstances()` method
- `src/cli/status.ts` — instances array in StatusResult + display
- `.claude/skills/mesh-builder/SKILL.md` — documented parallel, mesh-id, max_instances

### Automated Tests Passed ✅
- [x] SQLite CRUD: insert, get, complete, list, count, markStale, duplicate rejection
- [x] Prompt injection: header, base mesh, instance ID, isolation note
- [x] Guardrail resolution: global, mesh override, default null
- [x] tx status --json includes instances array
- [x] TypeScript compilation clean

### Manual Verification Steps

#### 1. Spawn a parallel instance
```bash
cat > .ai/tx/msgs/$(date +%s)-test-parallel-spawn.md << 'EOF'
---
to: test-echo/echo
from: core/core
parallel: true
mesh-id: test-alpha
---
Test parallel spawn.
EOF
```

- [ ] Confirm row with base_mesh=test-echo, mesh_id=test-alpha, status=running

#### 2. Route to existing instance (mesh-id only)
```bash
cat > .ai/tx/msgs/$(date +%s)-test-parallel-route.md << 'EOF'
---
to: test-echo/echo
from: core/core
mesh-id: test-alpha
---
Follow-up message.
EOF
```
- [ ] Check logs for "Routing to existing parallel instance by mesh-id"
- [ ] Confirm rewrittenTo contains "test-echo-test-alpha/echo"

#### 3. Route to nonexistent instance (should error)
```bash
cat > .ai/tx/msgs/$(date +%s)-test-parallel-bad.md << 'EOF'
---
to: test-echo/echo
from: core/core
mesh-id: does-not-exist
---
Should fail.
EOF
```
- [ ] Confirm error message written to core/core
- [ ] Confirm message file deleted

#### 4. parallel: true without mesh-id (should error)
```bash
cat > .ai/tx/msgs/$(date +%s)-test-parallel-no-id.md << 'EOF'
---
to: test-echo/echo
from: core/core
parallel: true
---
Missing mesh-id.
EOF
```
- [ ] Confirm error: "Missing mesh-id for parallel spawn"
- [ ] Confirm message file deleted

#### 5. Max instances guardrail
- [ ] Set `guardrails: { max_instances: 1 }` in `.ai/tx/data/config.yaml`
- [ ] Spawn first instance (should succeed)
- [ ] Spawn second instance (should error: "Max instances exceeded")

#### 6. tx status shows instances
```bash
tx status --json
```
- [ ] Confirm `instances` array contains spawned instances

#### 7. Instance completion
- [ ] Let mesh complete or simulate completion message with `mesh-id` in frontmatter
- [ ] Confirm DB row status changed to 'completed'
ZZ
#### 8. Prompt contains parallel context
- [ ] Check worker logs for "Injected parallel instance context"
- [ ] Confirm prompt includes "# Parallel Instance Context" section

### Known Gaps
- `markStaleInstances()` defined but not called on startup (restart recovery not wired)

---

## Playwright Mesh (Browser-as-a-Service)
Date: 2026-03-01
Session: e1915457-ee97-4793-b680-c6bb099b4eea

### Files Created
- `meshes/playwright/config.yaml` — Mesh config with Playwright MCP server
- `meshes/playwright/browser/prompt.md` — Browser agent prompt

### Verification Steps

#### 1. Mesh loads without validation errors
```bash
tx mesh info playwright
```
- [ ] Confirm: mesh name, description, agents list displayed
- [ ] Confirm: no validation errors

#### 2. Send a test message
```bash
tx msg playwright "Screenshot http://example.com"
```
- [ ] Confirm: dispatcher logs show mesh loaded and worker spawned:
```bash
tx logs -c dispatcher | rg "playwright"
```

#### 3. Response message appears
- [ ] Check for response in `.ai/tx/msgs/`:
```bash
ls -la .ai/tx/msgs/ | rg playwright
```

#### 4. Screenshot saved
- [ ] Confirm screenshot exists:
```bash
ls -la .ai/playwright/screenshots/
```

#### 5. Cross-mesh messaging
- [ ] From another running mesh, send a message to `playwright/browser`
- [ ] Confirm response routes back to requesting agent

---

## Queue-First System Messaging + Auto-Nudge Recovery
Date: 2026-02-25
Session: 39af14ad-aefa-466d-8090-24fad5278b56

### Files Created
- `src/core/system-message-writer.ts` — Queue-first message dispatch abstraction
- `src/worker/nudge-detector.ts` — Stalled route detection + auto-recovery

### Files Modified
- `src/core/consumer.ts` — systemFileRegistry, chokidar guard, 3 write methods migrated
- `src/worker/dispatcher.ts` — systemWriter + nudgeDetector wiring, 3 write methods migrated
- `src/mesh/fsm.ts` — 2 write methods migrated
- `src/core/recovery.ts` — 2 write methods migrated
- `src/worker/ensemble-coordinator.ts` — 1 write method migrated
- `src/worker/headless-runner.ts` — 1 write method migrated
- `src/queue/deadlock-detector.ts` — 1 write method migrated
- `src/cli/start.ts`, `src/cli/run.ts` — CLI write sites migrated
- `src/hooks/types.ts`, `src/hooks/post/brain-update.ts`, `src/hooks/post/suggest-manifest.ts`, `src/hooks/post/commit-auto.ts`, `src/hooks/utils/messages.ts` — Hook write sites migrated
- `src/worker/usage-policy-error.ts` — Optional writer support
- `src/session/session-summarizer.ts` — Exported `runHaikuQuery`
- `src/worker/guardrail-config.ts` — Nudge config support

### Verification Steps

#### 1. Type check
- [ ] Clean compile:
```bash
npx tsc --noEmit
```

#### 2. No stale writeFileSync to msgs/
- [ ] Confirm zero direct file writes to msgs/ dir:
```bash
rg 'writeFileSync.*msgs/' src/
```

#### 3. Fan-out still dispatches immediately
- [ ] Start a fan-out mesh (e.g. opus-soul)
- [ ] Confirm fan-out tasks dispatch without chokidar delay:
```bash
tx logs -c consumer | rg "system-authored"
```
- [ ] Confirm fan-out tasks appear in worker logs immediately:
```bash
tx logs -c dispatcher | rg "fan-out"
```

#### 4. No chokidar duplicate processing
- [ ] Start any mesh, send a task
- [ ] Confirm system-authored files are skipped by chokidar:
```bash
tx logs -c consumer | rg "Skipping system-authored"
```
- [ ] Confirm each message processed exactly once (no duplicate queue IDs):
```bash
tx logs -c consumer | rg "queue-insert" | sort
```

#### 5. Auto-nudge recovery (stalled route)
- [ ] Configure nudge in `.ai/tx/data/config.yaml`:
```yaml
nudge:
  enabled: true
  delay_ms: 15000
  max_nudges_per_agent: 1
```
- [ ] Start a multi-step mesh where agent A routes to agent B
- [ ] Kill agent A's worker after it completes but before it writes a handoff
- [ ] Wait 15 seconds
- [ ] Confirm nudge detection log:
```bash
tx logs -c nudge-detector | rg "Stalled route detected"
```
- [ ] Confirm recovery task appears for agent B:
```bash
tx logs -c nudge-detector | rg "Nudge sent"
```

#### 6. Nudge timer cancellation
- [ ] Start a mesh, let it complete normally
- [ ] Confirm nudge timers cancelled on mesh completion:
```bash
tx logs -c dispatcher | rg "cancelForMesh"
```

#### 7. Existing tests still pass
- [ ] Run existing test suite:
```bash
npx vitest run
```

#### 8. Docker overlayfs (if applicable)
- [ ] Build and run in Docker container
- [ ] Confirm no chokidar duplicate processing in containerized environment
- [ ] Confirm queue-first dispatch works without chokidar reliability

---

## inject-response fix
- [ ] Send task with `inject-response: true` (no explicit `type: task`), confirm `outgoing-tasks.json` has `injectResponse: true`
- [ ] On mesh completion in hook mode, confirm log: `inject-response: actively injecting`

---

## dev-know-build Mesh + Command Template Interpolation
Date: 2026-02-14

### Files Changed
- `src/worker/sdk-runner.ts` — `{key}` template interpolation in `buildUserPrompt`
- `.claude/commands/know/prebuild.md` — `/know:prebuild` skill
- `meshes/dev-know-build/config.yaml` — mesh config (prebuild haiku → builder opus)
- `meshes/dev-know-build/prebuild.md` — prebuild agent prompt
- `.claude/skills/mesh-builder/SKILL.md` — documented interpolation syntax

### Verification Steps

#### 1. Type check
- [ ] Clean compile:
```bash
npx tsc --noEmit
```

#### 2. Template interpolation resolves feature
- [ ] Send message with `feature: test-feature` to dev-know-build mesh
- [ ] Confirm prebuild agent receives `/know:prebuild test-feature` as first line of user prompt:
```bash
tx logs -c sdk-runner | rg "test-feature"
```

#### 3. Feature propagates through pipeline
- [ ] After prebuild completes, confirm builder receives `/know:build test-feature`:
```bash
tx logs -c sdk-runner | rg "know:build test-feature"
```

#### 4. Command-only agent works
- [ ] Confirm builder agent (no prompt file) gets minimal system prompt + routing injection:
```bash
tx prompt dev-know-build builder
```

#### 5. Unresolved tokens stay as-is
- [ ] Send message WITHOUT `feature` field to dev-know-build
- [ ] Confirm command stays as `/know:prebuild {feature}` (no crash, no empty string):
```bash
tx logs -c sdk-runner | rg "prebuild"
```

#### 6. Prebuild skill registered
- [ ] Confirm `/know:prebuild` appears in slash command list

---

## Fan-In Delivery Modes + Transform
Date: 2026-02-12

### Files Changed
- `src/shared/types.ts` — `fan_in` and `transform` fields on `FanOutOptions`
- `src/worker/mesh-validator.ts` — validation for `fan_in` and `transform` values
- `src/worker/dispatch-router.ts` — `getParallelGroup()` returns `fanIn` and `transform`
- `src/core/consumer.ts` — fan-out event passes `fanIn` and `transform`
- `src/worker/dispatcher.ts` — batch delivery, drain injection, summarize transform
- `meshes/opus-soul/config.yaml` — `fan_in: batch` on fan-out options
- `.claude/skills/mesh-builder/SKILL.md` — documented fan_in modes and transform

### Verification Steps

#### 1. Type check passes
- [ ] Confirm clean compile:
```bash
npx tsc --noEmit
```

#### 2. Batch mode (opus-soul default)
- [ ] Start opus-soul mesh, let all 8 agents complete
- [ ] Confirm weaver receives ONE combined message (not 8 separate cold starts):
```bash
tx logs -c dispatcher | rg "Batch delivery"
```
- [ ] Confirm log: `Batch delivery: combining messages for join agent` with `messageCount: 8`
- [ ] Confirm weaver's task message contains `## Batched Fan-In (8 responses)` header

#### 3. Queue mode (backward compat)
- [ ] Create a test mesh with `fan_in: queue` in fan-out options
- [ ] Confirm weaver receives messages one at a time (N cold worker starts)
- [ ] Confirm no `Batch delivery` log lines appear

#### 4. Drain mode
- [ ] Create a test mesh with `fan_in: drain` in fan-out options
- [ ] Confirm join agent starts on FIRST completion (not gated)
- [ ] Confirm subsequent completions inject into running worker:
```bash
tx logs -c dispatcher | rg "Drain mode"
```

#### 5. Transform: summarize
- [ ] Create a test mesh with `fan_in: batch, transform: summarize`
- [ ] Confirm haiku pre-pass produces compressed output:
```bash
tx logs -c dispatcher | rg "Summarize transform"
```

#### 6. Validator catches bad values
- [ ] Create a config with `fan_in: invalid` and confirm validation error
- [ ] Create a config with `transform: invalid` and confirm validation error

#### 7. Default behavior (no fan_in specified)
- [ ] Run a dispatcher mesh with fan-out but no `fan_in` field
- [ ] Confirm it defaults to batch mode

---

## Mesh Completion Behavior Config
Date: 2026-02-12

### Files Changed
- `src/mesh/config-loader.ts` — `stop_on_first_complete` and `check_queue_on_complete` on MeshConfig
- `src/worker/mesh-validator.ts` — MESH_FIELD_SPECS entries
- `src/queue/index.ts` — `countPendingForMesh()` method
- `src/core/consumer.ts` — local MeshConfig type + completion logic branching
- `meshes/opus-soul/config.yaml` — `completion_agents: [weaver]`, `stop_on_first_complete: false`
- `.claude/skills/mesh-builder/SKILL.md` — documented behavior matrix

### Verification Steps

#### 1. Type check passes
- [ ] Confirm clean compile:
```bash
npx tsc --noEmit
```

#### 2. Persistent mesh (opus-soul) does NOT die on weaver complete
- [ ] Start opus-soul, let it run through a full cycle
- [ ] When weaver sends `outcome: complete` to core, confirm:
  - Log line: `Completion agent (stop_on_first_complete=false) — mesh continues`
  - No `mesh-complete` event emitted
  - Workers stay alive, mesh loops back to framing

#### 3. Default behavior (ephemeral meshes) still shuts down
- [ ] Run an ephemeral mesh (e.g. test-fan-out or dev)
- [ ] On completion agent's `task-complete` to core, confirm:
  - `mesh-complete` event fires
  - Workers shut down normally

#### 4. Queue drain defers shutdown (check_queue_on_complete=true)
- [ ] On a default-config mesh, have completion agent fire while other agents still have pending messages
- [ ] Confirm log: `Completion agent deferred — pending messages in queue`
- [ ] Confirm mesh-complete fires only after queue drains

---

## tx restart command
Date: 2026-02-12

### Files Changed
- `src/cli/start.ts` - reattach logic, SIGTERM handler, restart() function
- `src/cli/index.ts` - CLI routing, help text

### Verification Steps

#### 1. Basic restart flow
- [ ] Start TX normally:
```bash
tx start
```
- [ ] In another terminal, restart:
```bash
tx restart
```
- [ ] Confirm: services stop message appears, then reattaches to same session
- [ ] Confirm: Claude still running with history intact in tmux

#### 2. Messages still flow after restart
- [ ] After restart, send a message to a mesh
- [ ] Check logs for consumer/dispatcher activity:
```bash
tx logs -c dispatcher
```

#### 3. No running process
- [ ] Stop TX completely:
```bash
tx stop
```
- [ ] Run restart with no running process:
```bash
tx restart
```
- [ ] Confirm: behaves like `tx start` (creates new session)

#### 4. Stale PID file
- [ ] Write a fake PID file:
```bash
echo "99999" > .ai/tx/data/.pid
```
- [ ] Run restart:
```bash
tx restart
```
- [ ] Confirm: detects stale PID, cleans up, starts fresh

#### 5. Help text
- [ ] Confirm help displays:
```bash
tx restart -h
```
- [ ] Confirm restart appears in main help:
```bash
tx -h
```

#### 6. AI guard
- [ ] Confirm restart is blocked for AI agents (CLAUDECODE=1):
```bash
CLAUDECODE=1 tx restart
```

---

## tx mesh drain command
Date: 2026-02-12

### Files Changed
- `src/cli/mesh.ts` — `drainMesh()` function + case in switch
- `src/cli/index.ts` — help text

### Verification Steps

#### 1. Drain a mesh with pending messages
- [ ] Queue some messages for a mesh, then drain:
```bash
tx mesh drain opus-soul
```
- [ ] Confirm: per-agent message count displayed
- [ ] Confirm: "Queue empty. Mesh ready for fresh dispatch."

#### 2. JSON output
```bash
tx mesh drain opus-soul --json
```
- [ ] Confirm: JSON with `drained`, `byAgent`, `suspendedCleared`, `asksCleared`

#### 3. Empty queue
```bash
tx mesh drain opus-soul
```
- [ ] Confirm: "No pending messages for mesh 'opus-soul'."

#### 4. Help text
```bash
tx mesh -h
```
- [ ] Confirm: `drain <mesh>` appears in actions list

## Dispatcher routing in PromptBuilder + discuss peers
Date: 2026-02-12

### Files Changed
- `src/shared/types.ts` - Added `peers?: string[]` to `DispatchInjectionContext`
- `src/worker/dispatch-router.ts` - `getInjectionContext()` populates peers for fan-out members with discuss
- `src/prompt/types.ts` - Added `dispatcherRouting?: DispatchInjectionContext` to `PromptContext`
- `src/prompt/builder.ts` - Branches on `dispatcherRouting` vs `routing` for section generation
- `src/prompt/sections/routing.ts` - `buildDispatcherRoutingSection` accepts peers, renders discuss instructions
- `src/worker/dispatcher.ts` - Passes `ctx.peers` through to injection call
- `.claude/skills/mesh-builder/SKILL.md` - Documents discuss peer routing

### Verification Steps

#### 1. Dispatcher prompt includes routing section
- [x] Preview a dispatcher-mode agent prompt:
```bash
tx prompt <dispatcher-mesh> <agent>
```
- [ ] Confirm: "Send all messages to: mesh/dispatch" appears in output

#### 2. Fan-out member with discuss shows peers
- [x] Use a mesh with `discuss: true` in fan-out config
- [x] Check prompt for fan-out member agent:
```bash
tx prompt <mesh> <fan-out-member>
```
- [x] Confirm: "Peers available for discussion:" lists sibling agents
- [x] Confirm: `discuss` outcome mentions `route_to:` requirement

#### 3. Branch agent shows constrained outcomes
- [ ] Check prompt for branch-routed agent:
```bash
tx prompt <mesh> <branch-agent>
```
- [ ] Confirm: only configured outcomes listed (not freeform)

#### 4. Terminal agent prompt
- [ ] Check prompt for terminal agent (absent from routing map):
```bash
tx prompt <mesh> <terminal-agent>
```
- [ ] Confirm: "You are a terminal agent" text appears

# TX V4 Meshes

Quick reference for available meshes and when to use them.

## Development

### dev

- **Purpose**: Deep development with testing and code review
- **Entry**: `dev/implementer`
- **Agents**: implementer (opus) → tester (sonnet) → reviewer (opus)
- **Flow**: Implement → Run tests → Code review (with feedback loops)
- **Use when**: Complex features, significant refactors, high-stakes implementations
- **Triggers**: `build`, `implement`, `fix`, `develop`, `refactor`
- **Features**: Brain integration, quality gates

### dev-lite

- **Purpose**: Lightweight development for simple fixes and quick features
- **Entry**: `dev-lite/worker`
- **Model**: sonnet
- **Use when**: Typos, simple bug fixes, straightforward features, quick iterations
- **Triggers**: `build`, `implement`, `code up`, `fix`, `develop`
- **Features**: Brain integration

### dev-full

- **Purpose**: Big-feature development with HITL success criteria, quality gates, and learning capture
- **Entry**: `dev-full/prebuild`
- **Agents**: prebuild (sonnet) → implementer (sonnet) → tester (sonnet) → reviewer (opus) → evaluator (opus) → ultrareview (opus) → handoff (sonnet)
- **Flow**: Prebuild generates criteria → HITL approval → implement → test → review → evaluate against criteria → holistic review → human review steps
- **Use when**: Large features needing structured criteria, multiple quality gates, and audit trail
- **Features**: Success criteria as first-class artifact (HITL-validated), manifest-driven I/O, worktree isolation, auto-commit, brain update, learning capture via working-notes.md and decisions.md

### dev-full-ensemble

- **Purpose**: Fork of dev-full with ensemble implementers and semi-formal verification
- **Entry**: `dev-full-ensemble/prebuild`
- **Agents**: prebuild (sonnet) → [implementer-a, -b, -c] (sonnet ×3) → verifier (opus) → tester (sonnet) → reviewer (opus) → evaluator (opus) → ultrareview (opus) → handoff (sonnet)
- **Flow**: Prebuild → 3 parallel implementers → semi-formal verification selects best → test → review → certified evaluation → holistic review → handoff
- **Use when**: Complex features where exploring multiple implementation approaches improves first-pass quality
- **Features**: Parallelism (3 implementers), semi-formal equivalence/evaluation certificates, manifest-driven I/O
- **Cost**: Higher than dev-full (3 impl + verifier) but fewer iteration loops expected

### dev-brain

- **Purpose**: Development with learning capture — implementer builds, reviewer gates, brain ingests lessons
- **Entry**: `dev-brain/implementer`
- **Agents**: implementer (sonnet) → reviewer (opus)
- **Features**: Rearmatter, brain integration, lifecycle hooks (auto-commit, brain-update), learning capture via working-notes.md and decisions.md

### dev-haiku

- **Purpose**: FSM state tracking validation with haiku agents
- **Entry**: `dev-haiku/coordinator`
- **Agents**: coordinator (haiku) → worker (haiku) → reviewer (haiku)
- **Features**: FSM, state tracking, context injection, injectOriginalMessage

### dev-know-build

- **Purpose**: Two-phase development — haiku prepares feature context, opus builds
- **Entry**: `dev-know-build/prebuild`
- **Agents**: prebuild (haiku) → builder (opus)
- **Features**: `/know:prebuild` and `/know:build` command interpolation, brain integration

### dev-mesh

- **Purpose**: Smart-routing dev coordinator with domain specialists
- **Entry**: `dev-mesh/coordinator`
- **Agents**: coordinator (haiku) → architect (opus), frontend (opus), ui-components (sonnet), backend (opus), implementer (sonnet), tester (sonnet), reviewer (opus)
- **Features**: Dispatcher routing, domain-specific specialists, ask/ask-response pattern

### dev-review

- **Purpose**: Development with sonnet developer, opus reviewer, haiku tester — review-gated quality
- **Entry**: `dev-review/developer`
- **Agents**: developer (sonnet) → reviewer (opus) → tester (haiku)
- **Features**: Brain integration, `/know:build` command

### dev-tdd

- **Purpose**: Red-green-refactor TDD mesh — enforced by topology
- **Entry**: `dev-tdd/red`
- **Agents**: red (sonnet) → green (sonnet) → refactor (opus) → reviewer (opus)
- **Features**: Extended thinking on all agents, dispatcher routing

### dev-worktree

- **Purpose**: Development with git worktree isolation for feature work
- **Entry**: `dev-worktree/worker`
- **Model**: sonnet
- **Use when**: Feature development that needs branch isolation
- **Features**: Worktree lifecycle hooks (create, auto-commit, brain-update, cleanup), brain integration

### dev-ui-completion

- **Purpose**: Takes a wireframe or partial UI and makes it fully functional
- **Entry**: `dev-ui-completion/orchestrator`
- **Agents**: orchestrator (sonnet) → analyzer (sonnet), specifier (sonnet), implementer (sonnet), synthesizer (opus), validator (sonnet)
- **Features**: Orchestrator pattern, HITL for ambiguities, auto-conflict resolution at 70% threshold, 3-attempt validation loop

### dev-ui-prototypes

- **Purpose**: 5 parallel low-fidelity wireframe generators with different design lenses
- **Entry**: `dev-ui-prototypes/coordinator`
- **Agents**: coordinator (haiku) → bare-minimum (sonnet), heuristic (sonnet), info-arch (sonnet), user-flows (sonnet), kitchen-sink (sonnet) → synthesizer (opus)
- **Features**: Dispatcher routing, 5-lens parallel prototyping (fork_from coordinator), pattern convergence synthesis

## Knowledge & Spec

### brain

- **Purpose**: Knowledge gateway — mediates all spec-graph access
- **Entry**: `brain/brain`
- **Model**: opus
- **Use when**: Adding features, managing spec-graph, project knowledge queries
- **Triggers**: `add feature`, `create feature`, `new feature`, `bug`, `issue`, `problem`, `broken`
- **Commands**: `/know:add` (features), `/know:bug` (issues)

## Research

### research

- **Purpose**: Web research with multi-agent pipeline
- **Entry**: `research/interviewer`
- **Agents**: interviewer (sonnet) → sourcer (sonnet) → analyst (sonnet) → writer (sonnet)
- **Use when**: Researching topics, gathering information, exploring what's out there
- **Triggers**: `research`, `investigate`, `find out`, `what's the state of`, `look into`, `explore`
- **Features**: Rearmatter grading with confidence scores

### deep-research

- **Purpose**: Research with confidence iteration loop
- **Entry**: `deep-research/interviewer`
- **Agents**: interviewer (sonnet) → sourcer (sonnet) → analyst (sonnet) → researcher (opus) → disprover (opus) → writer (opus)
- **Flow**: Loops between researcher/disprover until 95% confidence, then writer
- **Use when**: Hypotheses, theories, high-stakes research requiring validation
- **Triggers**: `hypothesis`, `theory`
- **Config**: `confidence_threshold: 0.95`, `max_iterations: 3`

### ensemble-research

- **Purpose**: Multiple parallel research agents with result aggregation
- **Entry**: `ensemble-research/literature-review`
- **Agents**: literature-review (sonnet), interviews (sonnet), statistics (sonnet)
- **Features**: Ensemble with coordinator + reviewer, deduplicate aggregation, 120s timeout

### structured-thinking

- **Purpose**: Systematic reasoning and decision analysis
- **Entry**: `structured-thinking/thinker`
- **Model**: opus
- **Use when**: Decisions, tradeoffs, comparisons, evaluations
- **Triggers**: `should I`, `what's better`, `analyze`, `evaluate`, `decide`, `which option`, `compare`, `tradeoffs`
- **Features**: Rearmatter with confidence/assumptions/gaps

## Bug Finding & Fixing

### bug-finder

- **Purpose**: Crawl a website and find UX, QA, design, and accessibility issues
- **Entry**: `bug-finder/crawler`
- **Agents**: crawler (sonnet) → tester (sonnet) → synthesizer (sonnet)
- **Features**: FSM, parallel ensemble testing, Playwright integration

### bug-fixer

- **Purpose**: Batch bug fixing with parallel research and Playwright validation
- **Entry**: `bug-fixer/triage`
- **Agents**: triage (haiku) → researcher (sonnet) → planner (sonnet) → fixer (opus) → validator (sonnet) → reporter (haiku)
- **Features**: FSM, dynamic ensemble, batch iteration with retry logic (max_retries=3), Playwright

### bug-know-finder

- **Purpose**: Spec-guided QA — generate Playwright tests from spec-graph, find spec violations and gaps
- **Entry**: `bug-know-finder/spec-reader`
- **Agents**: spec-reader (sonnet) → gap-detector (sonnet), inspector (sonnet), test-writer (opus), journey-writer (sonnet), runner (sonnet) → bug-prioritizer (sonnet) → synthesizer (sonnet)
- **Features**: FSM, spec-graph integration, parallel test generation + gap detection, Playwright

## Creative

### narrative-engine

- **Purpose**: LLM-native tabletop RPG system with semantic mechanics
- **Entry**: `narrative-engine/entry`
- **Agents**: entry, game-coord, init-turn, architect, simulator, table-gen, npc-voice, narrator (opus), calibrator (opus), editor (opus), prose-eval, visual, oracle, scribe, + 8 lint agents
- **Use when**: Running tabletop RPG sessions
- **Features**: Complex FSM, manifest-driven file I/O, HITL calibration, lint ladder, continuation=false, stateless mechanics with JIT probability tables

### narrative-engine-v2

- **Purpose**: Collapsed single-mesh RPG — entropy architect, scene simulator, and narrative pipeline
- **Entry**: `narrative-engine-v2/entry`
- **Agents**: entry, game-coord, init-turn, gravity, architect, sim-planner, sim-tables, sim-voices, narrator (opus), calibrator (opus), editor (opus), oracle, visual, scribe, lint agents
- **Features**: Collapsed FSM, gravity collision detector, sim-planner/tables/voices phase split, heartbeat reliability config

### opus-soul

- **Purpose**: Persistent creative mesh
- **Entry**: `opus-soul/walker`
- **Model**: sonnet
- **Features**: Persistent mesh, auto_despawn, inline crows (haiku Task spawning)

### rewriter

- **Purpose**: Style extraction and rewriting engine
- **Entry**: `rewriter/writer`
- **Agents**: writer (sonnet) → editor (sonnet)
- **Features**: Style profile extraction + rewriting, two-workflow design

## Meta

### mesh-builder

- **Purpose**: Meta mesh that builds TX meshes from user requirements
- **Entry**: `mesh-builder/interviewer`
- **Agents**: interviewer (sonnet) → architect (sonnet) → implementer (sonnet) → refiner (opus)
- **Features**: Linear workflow via routing

## Testing & Reliability

### reliability-test

- **Purpose**: Reliability test mesh — circuit breakers, heartbeat, SLI, DLQ, safe mode
- **Entry**: `reliability-test/planner`
- **Agents**: planner (haiku) → worker (haiku) → checker (haiku)
- **Features**: Tight guardrails (max_messages=10, max_turns=8), reliability config with circuit breaker, safeMode thresholds

### reliability-fsm

- **Purpose**: FSM reliability test — state gates, iteration tracking, safe-mode integration
- **Entry**: `reliability-fsm/analyst`
- **Agents**: analyst (haiku) → builder (haiku) → verifier (haiku)
- **Features**: FSM with gate scripts, circuit breaker testing, tight guardrails

### test-bash-guard

- **Purpose**: Adversarial bash guard testing — agent tries to escape workDir, reports results
- **Entry**: `test-bash-guard/attacker`
- **Model**: haiku
- **Features**: Permission model testing, bash_guard guardrail (strict=true)

## Mesh Selection Guide

| Need | Mesh | Why |
|------|------|-----|
| Add feature to spec | brain | Manages spec-graph |
| Quick fixes & simple work | dev-lite | Fast iteration with Sonnet |
| Complex features & deep work | dev | Test + review cycle with quality gates |
| Big features with criteria | dev-full | HITL criteria + evaluator + ultrareview |
| Big features, explore approaches | dev-full-ensemble | 3 parallel impls + semi-formal verification |
| TDD workflow | dev-tdd | Red-green-refactor enforced by topology |
| Smart routing to specialists | dev-mesh | Domain-specific dispatching |
| Isolated feature work | dev-worktree | Git worktree isolation |
| Wireframe to functional UI | dev-ui-completion | Wire every button and workflow |
| UI design exploration | dev-ui-prototypes | 5 parallel design lenses |
| Research topic | research | Multi-agent pipeline |
| Deep analysis | deep-research | Confidence loop until 95% |
| Make decision | structured-thinking | Systematic reasoning |
| Find website bugs | bug-finder | Crawl + Playwright testing |
| Fix bugs in batch | bug-fixer | Parallel research + validation |
| Spec-guided QA | bug-know-finder | Generate tests from spec-graph |
| Play RPG | narrative-engine | Stateless semantic mechanics |
| Build a mesh | mesh-builder | Meta mesh that builds meshes |

## Intent Routing Quick Reference

TX routes tasks to meshes based on pattern matching. Here's what triggers each:

| Pattern | Routes to |
|---------|-----------|
| "add feature", "create feature", "new feature" | brain |
| "bug", "issue", "problem", "broken" | brain |
| "build", "implement", "code up", "fix" | dev |
| "research", "investigate", "find out", "explore" | research |
| "hypothesis", "theory" | deep-research |
| "should I", "analyze", "compare", "tradeoffs" | structured-thinking |
| "build feature", "isolated development" | dev-worktree |

## Generating Meshes (Factory)

When no existing mesh fits, generate a purpose-built one from capability requirements:

```bash
tx factory capabilities.yaml              # from capability YAML
tx factory .ai/plan/my-plan/              # from plan directory (auto-derives capabilities)
tx factory caps.yaml --run "task prompt"  # generate + dispatch immediately
```

Generated meshes live at `.ai/tx/generated-meshes/{capability-hash}/` and load on demand when messaged. Same capabilities reuse the existing mesh without recompiling.

See `src/mesh/capability/schema.ts` for the capability enum vocabulary.

## Creating New Meshes

See the [mesh-builder skill](../.claude/skills/mesh-builder/SKILL.md) for:
- Config field reference
- Agent architecture patterns
- Routing table design
- Best practices

Related: [Mesh Configuration Reference](./mesh-config.md)

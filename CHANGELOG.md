# Changelog

All notable changes to TX V4 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-01-28

### Added

#### Terminal-by-Default Messaging
- **Type inference**: Agents omit `type:` field - system infers from routing boundaries
- **Inference rules**: `in-reply-to` → ask-response, from core → ask-response, to core → ask-human, default → ask
- **Prompt cleanup**: Stripped explicit `type:` from 70+ mesh prompt files

#### Human Boundary Enforcement
- **Parity gate scoped**: Only tracks asks at human boundary (core/core), not agent-to-agent
- **Incoming asks removed**: No more blocking on agent-to-agent message obligations
- **Boundary agents config**: `boundary_agents` replaces `completion_agent` (backward compatible)

#### Message Revision System
- **`revision:` frontmatter**: Three modes for mid-flight message updates
  - `interrupt`: Hot inject via SDK (default, falls back to append if no worker)
  - `append`: Add to worker context ("also do X")
  - `replace`: Discard previous work, process new content
- **Core prompt updated**: Instructions for editing active messages with revision modes

#### Operator Tools
- **`tx mesh kill <mesh>`**: Kill all workers for a mesh via tmux session termination
- **JSON output**: `--json` flag for programmatic usage

#### Queue Await Tracking
- **`await_state` table**: SQLite persistence for session suspension state (all agents)
- **Dual-table design**: `pending_asks` for parity (core/core) vs `await_state` for sessions

#### Soft Routing
- **Warn on violation**: Messages to valid agents pass through with warning when routing table incomplete
- **Hard block preserved**: Messages to non-existent agents still blocked with feedback

### Changed

- **Revision prompts**: Append uses "incorporate this" language, replace uses "discard previous"
- **Worker lifecycle**: `deferWorkerKill` promisified to avoid SDK abort race condition
- **Recovery logging**: Demoted to debug when recovery succeeds (less noise)
- **FSM resume**: Added missing `machine.initialize()` before `machine.start()` in resume flow
- **Duplicate ask-responses**: Now injected at runtime instead of dropped

### Fixed

- **"Cannot start from pending"**: Missing FSM initialization in resume flow
- **"No pending ask found"**: Parity gate was tracking agent-to-agent (now human-only)
- **"BLOCKED: unanswered incoming asks"**: Removed enforcement entirely for agent-to-agent
- **Race condition in deferWorkerKill**: Promisified delay prevents SDK abort errors

## [0.2.1] - 2026-01-21

### Added

#### Agent Recovery Channel
- **system/help, system/stuck**: Deliberate recovery channels for confused agents
- **Recovery handler**: Intercepts system/* messages and provides state guidance
- **Escalation ladder**: 3 requests in 60s triggers ask-human to core
- **State snapshot**: Dispatcher exposes `getAgentStateSnapshot()` for recovery context

#### Situational Awareness Injection
- **Current task context**: Agents see queued task details on start/resume
- **Outgoing asks**: Shows asks waiting for responses (prevents re-asking)
- **Incoming asks**: Shows asks from others awaiting response (prevents missed obligations)
- **Queue depth**: Count of additional pending tasks

#### Crash Recovery Infrastructure
- **Suspended sessions table**: SQLite persistence for ask-human/await-response state
- **Interrupted message status**: Distinguishes crash-interrupted from failed messages
- **Session preservation**: Session IDs survive restarts for --resume capability
- **Pending asks persistence**: Parity gate state survives crashes

#### Session Awareness
- **Session store**: SQLite-backed session tracking with file change summaries
- **Headline generation**: Haiku-powered session summarization via Claude Code SDK
- **Session search**: FTS5 full-text search across session history

### Changed

- **Mesh state cleanup**: Pending asks cleared on task-complete to core (not session start)
- **Ask-response correlation**: Supports `in-reply-to` frontmatter for explicit correlation
- **Idle detection**: Added patterns for Claude hint text and git stats

### Fixed

- **Ask registration race condition**: SQLite-based detection prevents orphaned asks
- **Await-response suspension**: Persisted to SQLite for crash recovery
- **Session headline auth**: Uses Claude Code SDK instead of direct API

## [0.2.0] - 2026-01-03

### Added

#### New Meshes
- **deep-research**: Multi-agent research pipeline with iterative confidence loop (interviewer → sourcer → analyst → researcher → disprover → writer)
- **structured-thinking**: Systematic reasoning frameworks for complex decisions and tradeoffs
- **dev-graded**: Developer mesh with quality gate evaluation and iteration
- **narrative-engine**: Multi-agent RPG mesh with semantic trait weighting and entropy-driven outcomes

#### Quality Stack
- **Graded meshes**: `graded: true` config enables quality gate evaluation with automatic iteration
- **Pre-flight analysis**: LLM-based task analysis generates dynamic checklist and rubric
- **Quality gates**: checklist, rubric, adversarial, accuracy, deterministic, summarizer
- **Iteration loop**: Failed gates trigger worker restart with feedback (configurable `maxIterations`, `onFail`)
- **Quality events**: Visible in `tx spy` for debugging

#### Ask/Await Pattern
- **Worker await state**: FSM state for workers waiting on ask-responses
- **Ask-human blocking**: Prevents task-complete when asks are pending
- **Dynamic steering injection**: Interrupts worker and injects "wait for response" guidance
- **Protocol violation guard**: FSM rejects completion from awaiting state with pending asks

#### Narrative Engine
- **Prose flow**: Continuous narrative output without headers until mechanics break
- **Per-action entropy**: Compound actions get separate dice rolls
- **Adjacency graph**: Location transitions via setting.yaml graph structure
- **Thread tracking**: Persistent narrative state across turns
- **Turn workspace**: Structured YAML files per turn (context, resolution, reactions, prose)
- **Session state machine**: Tracks consultation phases
- **Routing constraints**: SYSTEM and CAST agents restricted to ask-response only

#### Know Commands
- **know:connect**: Graph connection validation workflow
- **know:add**: Updated with HITL clarification workflow
- **know:prepare**: Refined project preparation workflow

#### CLI Improvements
- **tx msg**: Improved message display, filtering by type/agent, vim-style navigation
- **tx spy**: Enhanced activity stream output with agent filtering
- **tx logs**: Refined log formatting with filter toggles
- **tx start**: Better startup handling and session management

#### Infrastructure
- **Messaging protocol injection**: All workers receive standard message format docs
- **Mesh validator**: Extended validation rules for config verification

#### Documentation
- **docs/mesh-config.md**: Comprehensive config reference (code-verified)
- **Mesh-builder skill**: Updated to reference authoritative docs

### Changed

- **Message revision handling**: Dispatcher handles message revisions and awaiting state
- **Consumer events**: Emits `ask-message` for both `ask` and `ask-human` types
- **SDK runner**: Session ID field name ambiguity resolved
- **Brain agent**: Updated delegation guidance to leverage subagents
- **Core prompt**: Handles `format:narrative` responses verbatim

### Fixed

- **Headless runner**: Route task-complete to user/repl instead of core/core
- **Ask-human flow**: Block task-complete until ask-response received
- **Install loop**: Removed recursive postinstall rebuild (PR #1)

## [0.1.0] - 2025-12-XX

### Added

- Initial TX V4 architecture with SDK-based workers
- SQLite message queue with file watching
- Core agent in tmux for HITL
- Mesh configuration system
- Message protocol (task, task-complete, ask, ask-response, ask-human)
- CLI commands: start, status, msg, spy, logs, tasks
- Brain mesh for spec-graph management
- Dev mesh for coding tasks
- Research mesh for web research
- Workspace manager for task-scoped outputs
- Prompt injection system

[0.2.2]: https://github.com/eighteyes/tx/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/eighteyes/tx/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/eighteyes/tx/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eighteyes/tx/releases/tag/v0.1.0

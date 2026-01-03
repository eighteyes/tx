# Changelog

All notable changes to TX V4 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

#### Spec Graph Features (Designed)
- **feature:persistent-storage**: Schema-driven storage for knowledge-base and hierarchical patterns
- **feature:message-hold-delivery**: Hold messages until delivery conditions met

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

[0.2.0]: https://github.com/eighteyes/tx/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eighteyes/tx/releases/tag/v0.1.0

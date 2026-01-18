# TX V4 Meshes

Quick reference for available meshes and when to use them.

## Core Meshes

### brain

- **Purpose**: Knowledge gateway - mediates all spec-graph access
- **Entry**: `brain/brain`
- **Model**: opus
- **Use when**: Adding features, managing spec-graph, project knowledge queries
- **Triggers**: `add feature`, `create feature`, `new feature`, `bug`, `issue`, `problem`, `broken`
- **Commands**: `/know:add` (features), `/know:bug` (issues)

### dev

- **Purpose**: Deep development with testing and code review
- **Entry**: `dev/implementer`
- **Agents**: implementer (opus) → tester (sonnet) → reviewer (opus)
- **Flow**: Implement → Run tests → Code review (with feedback loops)
- **Use when**: Complex features, significant refactors, high-stakes implementations
- **Triggers**: `build`, `implement`, `fix`, `develop`, `refactor`
- **Commands**: `/know:build`

### dev-lite

- **Purpose**: Lightweight development for simple fixes and quick features
- **Entry**: `dev-lite/worker`
- **Model**: sonnet
- **Use when**: Typos, simple bug fixes, straightforward features, quick iterations
- **Triggers**: `build`, `implement`, `code up`, `fix`, `develop`
- **Commands**: `/know:build`

### research

- **Purpose**: Web research with multi-agent pipeline
- **Entry**: `research/interviewer`
- **Agents**: interviewer (sonnet) -> sourcer (sonnet) -> analyst (sonnet) -> writer (sonnet)
- **Use when**: Researching topics, gathering information, exploring what's out there
- **Triggers**: `research`, `investigate`, `find out`, `what's the state of`, `look into`, `explore`
- **Features**: Rearmatter grading with confidence scores

### deep-research

- **Purpose**: Research with confidence iteration loop
- **Entry**: `deep-research/interviewer`
- **Agents**: interviewer (sonnet) -> sourcer (sonnet) -> analyst (sonnet) -> researcher (opus) -> disprover (opus) -> writer (opus)
- **Flow**: Loops between researcher/disprover until 95% confidence, then writer
- **Use when**: Hypotheses, theories, high-stakes research requiring validation
- **Triggers**: `hypothesis`, `theory`
- **Config**: `confidence_threshold: 0.95`, `max_iterations: 3`

### structured-thinking

- **Purpose**: Systematic reasoning and decision analysis
- **Entry**: `structured-thinking/thinker`
- **Model**: opus
- **Use when**: Decisions, tradeoffs, comparisons, evaluations
- **Triggers**: `should I`, `what's better`, `analyze`, `evaluate`, `decide`, `which option`, `compare`, `tradeoffs`

## Quality-Enabled Meshes

### dev-worktree

- **Purpose**: Development with git worktree isolation
- **Entry**: `dev-worktree/worker`
- **Model**: sonnet
- **Use when**: Feature development that needs branch isolation
- **Triggers**: `build feature`, `implement in isolation`, `isolated development`
- **Features**:
  - `worktree: true` - creates git worktree for isolated development
  - Requires `feature:` in task frontmatter

## System Meshes

### commit-agent

- **Location**: `system/commit-agent`
- **Purpose**: Creates commits from worktree changes with good commit messages
- **Entry**: `commit-agent/committer`
- **Model**: haiku (lightweight)
- **Use when**: Auto-commit after dev work, creating commits from changes
- **Config**: `system: true` - marks as system mesh

## Experimental/Specialty

### narrative-engine

- **Purpose**: LLM-native tabletop RPG system with semantic mechanics
- **Entry**: `narrative-engine/narrator`
- **Agents**:
  - narrator (opus) - orchestrates scenes
  - system (sonnet) - mechanical resolution
  - cast (sonnet) - character responses
  - oracle (haiku) - continuity validation
- **Use when**: Running tabletop RPG sessions
- **Features**:
  - Session continuation - game persists across sessions
  - Statless mechanics - traits are semantically weighted
  - JIT probability tables with external entropy
  - Rearmatter shows outcome tables, momentum, arc pressure

### test

- **Purpose**: Test mesh for validating HITL flow and topology patterns
- **Entry**: `test/worker`
- **Agents**: worker, asker, looper, writer (all haiku)
- **Use when**: Testing TX infrastructure, not for production work

## Mesh Selection Guide

| Need | Mesh | Why |
|------|------|-----|
| Add feature to spec | brain | Manages spec-graph |
| Quick fixes & simple work | dev-lite | Fast iteration with Sonnet |
| Complex features & deep work | dev | Test + review cycle with quality gates |
| Isolated feature work | dev-worktree | Git worktree isolation |
| Research topic | research | Multi-agent pipeline |
| Deep analysis | deep-research | Confidence loop until 95% |
| Make decision | structured-thinking | Systematic reasoning |
| Create commits | commit-agent | Auto-commit with good messages |
| Play RPG | narrative-engine | Statless semantic mechanics |

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

## Creating New Meshes

See the [mesh-builder skill](../.claude/skills/mesh-builder/SKILL.md) for:
- Config field reference
- Agent architecture patterns
- Routing table design
- Best practices

Related: [Mesh Configuration Reference](./mesh-config.md)

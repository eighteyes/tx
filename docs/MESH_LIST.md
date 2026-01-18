# TX Mesh Registry

Agent mesh configurations for the TX multi-agent system. Each mesh defines workflows, agent roles, and coordination patterns.

## Active Meshes

Production-ready meshes for general use.

| Mesh | Description | Status |
|------|-------------|--------|
| `brain` | Knowledge gateway agent - mediates all spec-graph access | Active |
| `deep-research` | Multi-agent deep research with iterative confidence loop: interviewer gathers requirements, researcher investigates | Active |
| `hybrid-workflow` | Combined ensemble and task distribution pattern | Active |
| `mesh-builder` | Meta mesh that builds TX meshes from user requirements | Active |
| `narrative-engine` | Stateless RPG with coordinator pattern. Traits are semantically weighted, damage calculated via embeddings | Active |
| `rewriter` | Style extraction and text rewriting: extract voice from samples or rewrite text in target style | Active |
| `research` | Web research mesh: interviewer gathers requirements, sourcer finds sources, analyst synthesizes | Active |
| `structured-thinking` | Applies systematic reasoning frameworks to break down complex problems, analyze trade-offs | Active |
| `task-distribution-analysis` | Analyst splits task into subtasks, experts analyze, synthesizer reviews | Active |
| `system/commit-agent` | System mesh: Creates commits from worktree changes with good commit messages | Active |

## Development Meshes

Domain-specific development meshes for code implementation.

| Mesh | Description | Status |
|------|-------------|--------|
| `dev` | Developer mesh for implementing features, writing code, and running tests | Development |
| `dev-haiku` | FSM state tracking validation with haiku agents. Tests deterministic state transitions | Development |
| `dev-junior` | Handles simple, well-defined tasks: typo fixes, basic bug fixes, adding simple functions | Development |
| `dev-mesh` | Smart-routing dev coordinator with domain specialists | Development |
| `dev-mid` | Handles standard features and moderate complexity: implementing features from specs | Development |
| `dev-senior` | Handles complex, high-stakes work: major refactors, architectural changes, performance optimization | Development |
| `dev-worktree` | Developer mesh with git worktree isolation for feature development | Development |

## Experimental Meshes

Advanced patterns under development.

| Mesh | Description | Status |
|------|-------------|--------|
| `code-review-ensemble` | Parallel code review using FSM ensemble pattern - logic, architecture, robustness checks | Experimental |
| `ensemble-research` | Multiple parallel research agents with result aggregation | Experimental |

## Test Meshes

Testing and validation configurations.

| Mesh | Description | Status |
|------|-------------|--------|
| `test` | Test mesh for validating HITL flow and topology patterns | Test |
| `test-ensemble-file` | Parallel ensemble with file-based coordination, FSM gates, and context injection | Test |
| `test-ensemble-msgs` | Test message-based ensemble pattern with simple parallel task execution | Test |
| `test-ensemble-n-diff` | Dynamic ensemble with task decomposition - each worker receives a different subtask | Test |
| `test-ensemble-n-same` | Dynamic N-worker ensemble with identical task distribution and quality-based voting | Test |
| `ralph-ice-cream` | Layered quality refinement: haiku drafts, sonnet reviews, opus finalizes | Test |
| `ralph-ice-cream-2` | Layered quality refinement pipeline: haiku drafts (quick, honest), sonnet reviews | Test |
| `ralph-ice-cream-3` | Three-tier quality refinement pipeline with plan/build mode separation | Test |
| `ralph-loop` | Dual-mode mesh with plan/build separation via mode router | Test |

---

## Status Definitions

- **Active**: Production-ready, stable configurations
- **Development**: Domain-specific tools under active development
- **Experimental**: Advanced patterns being validated
- **Test**: Testing configurations and pattern validation

## Usage

Reference meshes in task messages:
```yaml
mesh: mesh-name
task: Your task description
```

## Directory Structure

```
meshes/
├── {mesh-name}/
│   ├── config.yaml          # Mesh configuration
│   └── prompts/             # Agent prompts (optional)
└── system/                  # System meshes
    └── {mesh-name}/
        └── config.yaml
```

## See Also

- [Mesh Configuration Reference](./mesh-config-reference.md) - Config field documentation
- [Topology Patterns](./topology-patterns.md) - Mesh coordination patterns
- `/mesh-builder` skill - Generate new meshes from requirements

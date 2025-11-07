# Mesh Configuration Reference

Schema and examples for creating TX mesh configurations.

**Available Meshes:** 24 total (17 production, 7 test) in `meshes/mesh-configs/`

---

## Table of Contents

1. [Configuration Schema](#configuration-schema)
2. [Configuration Examples](#configuration-examples)
3. [Available Meshes](#available-meshes)

---

## Configuration Schema

All mesh configurations follow this JSON schema:

### Required Fields

- `mesh` (string) - Unique mesh identifier
- `description` (string) - What this mesh does
- `agents` (array) - List of agent paths (e.g., `["research/interviewer"]`)
- `entry_point` (string) - First agent to receive tasks
- `completion_agent` (string) - Agent that signals completion

### Optional Fields

- `type` (string) - `"persistent"` or `"ephemeral"` (default: ephemeral)
- `workflow_topology` (string) - `"sequential"`, `"parallel"`, `"iterative"`
- `routing` (object) - Status-based routing rules per agent
- `capabilities` (array) - Shared capabilities for all agents
- `frontmatter` (object) - Additional prompt configuration
  - `self-modify` (boolean) - Enable self-modification loops (automatically clears context)
  - `lens` (boolean|string|array) - Enable lens system
  - `max-iterations` (number) - Max self-modify iterations

### Routing Rules

Each agent can define status-based routing:

```json
"routing": {
  "agent-name": {
    "complete": {
      "next-agent": "When work is complete"
    },
    "blocked": {
      "core": "When agent is stuck"
    }
  }
}
```

---

## Configuration Examples

### Minimal Configuration

```json
{
  "mesh": "my-mesh",
  "description": "Simple mesh description",
  "agents": [
    "my-mesh/agent"
  ],
  "entry_point": "agent",
  "completion_agent": "agent"
}
```

### Multi-Agent Sequential

```json
{
  "mesh": "workflow",
  "description": "Sequential workflow mesh",
  "agents": [
    "workflow/step1",
    "workflow/step2",
    "workflow/step3"
  ],
  "workflow_topology": "sequential",
  "entry_point": "step1",
  "completion_agent": "step3",
  "routing": {
    "step1": {
      "complete": {
        "step2": "First step done"
      }
    },
    "step2": {
      "complete": {
        "step3": "Second step done"
      }
    },
    "step3": {
      "complete": {
        "core": "Workflow complete"
      }
    }
  }
}
```

### Self-Modifying Agent

```json
{
  "mesh": "evolver",
  "description": "Self-improving agent",
  "agents": [
    "evolver"
  ],
  "entry_point": "evolver",
  "completion_agent": "evolver",
  "frontmatter": {
    "self-modify": true,
    "max-iterations": 10,
    "lens": true
  }
}
```

### Parallel Workflow

```json
{
  "mesh": "parallel-review",
  "description": "Parallel code review",
  "agents": [
    "parallel-review/coordinator",
    "parallel-review/reviewer"
  ],
  "workflow_topology": "parallel",
  "entry_point": "coordinator",
  "completion_agent": "coordinator",
  "routing": {
    "coordinator": {
      "complete": {
        "core": "All reviews complete"
      },
      "blocked": {
        "core": "Cannot proceed"
      }
    },
    "reviewer": {
      "complete": {
        "coordinator": "Review complete"
      }
    }
  }
}
```

---

## Available Meshes

All mesh configurations are in `meshes/mesh-configs/`.

### Production Meshes

- **bandwidth-compression** - Two philosophers debate 'what makes a life well lived' using maximally token-efficient communication patterns. Efficiency over human readability.
- **brain** - System awareness, knowledge keeper, and strategic advisor. Maintains project memory through observations, patterns, and learnings. Uses spec-graph (.ai/spec-graph.json via know-cli) to structure codebase knowledge. Provides context to agents and formulates development plans.
- **code-review** - Parallel code review workflow: coordinator distributes review tasks to SOLID checker, doc/config consistency checker, test coverage analyzer, and maintainability analyzer. All analyzers work in parallel and report findings back to coordinator, which saves comprehensive report to .ai/reports
- **core** - Core/brain mesh - entry point for TX Watch
- **deep-research** - Multi-agent deep research workflow with HITL requirements gathering: interviewer gathers requirements, sourcer gathers sources, analyst proposes hypotheses, researcher builds theories, disprover critiques in iterative loop until 95% confidence, writer synthesizes final report
- **dev** - Simple development mesh for implementing code tasks
- **evolver** - Self-modifying agent that iteratively refines its approach through prompt evolution
- **gtm-strategy** - Go-to-market strategy and growth hacking mesh for software products - generates progressive founder-friendly tasks from zero to first users
- **hitl-3qa** - Human-in-the-loop interview mesh - interviewer conducts 3 Q&A sessions with core before completing task
- **planner** - Brain-inspired modular planning system (MAP architecture) - decomposes tasks, predicts outcomes, evaluates quality, monitors conflicts, and coordinates execution
- **product-arch** - Product and architecture planning mesh: product-definer and architect collaborate iteratively to define features and design component architecture
- **prompt-editor** - Reviews prompt language for conciseness, effectiveness, clarity, and redundancy
- **research** - Web research mesh: interviewer gathers requirements → sourcer finds sources → analyst analyzes → writer creates informal article
- **riddle-game** - Competitive riddle game between two agents with mediator scorekeeper
- **risk-experiment** - Designs and executes proactive risk-reduction experiments to validate assumptions before committing to major implementation work
- **tdd-cycle** - Iterative TDD cycle: Red → Green → Refactor → repeat
- **ui-ensemble** - UI exploration mesh: generates and evaluates UI variants through HITL collaboration, selecting the best design for the MVP

### Test Meshes

- **test-ask** - Test ask/answer workflow - asker sends ask to answerer, then reports to core
- **test-echo** - Simple test mesh for echo agent
- **test-iterative** - Iterative refinement workflow - worker creates content, reviewer provides feedback, worker refines, reviewer approves
- **test-ping-pong** - Test mesh for agent-to-agent ping-pong messaging - agents exchange 2 messages each
- **test-pingpong** - Test sequential messaging - ping sends to pong, pong sends back, then reports to core
- **test-queue** - Test mesh for queue sequential processing
- **test-recursive** - Test mesh for self-improving agent that sends messages to itself iteratively

Use `tx list meshes` to see all available meshes or browse `meshes/mesh-configs/` for full configurations.


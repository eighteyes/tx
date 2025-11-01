# Available TX Meshes

Complete catalog of production-ready meshes with usage examples.

---

## Production Meshes

### core
- **Type:** Persistent
- **Description:** Central coordinator and user interface
- **Agents:** core
- **Use Case:** Entry point for all TX operations
- **Usage:**
  ```bash
  tx start  # Automatically spawns core
  ```

---

### brain
- **Type:** Persistent
- **Description:** Knowledge keeper with spec-graph (.ai/spec-graph.json via know-cli). Maintains observations, patterns, and learnings.
- **Agents:** brain
- **Capabilities:** Spec-graph access, evidence logging
- **Use Case:** Codebase understanding, strategic planning, context provision
- **Usage:**
  ```
  spawn brain mesh to analyze the codebase structure
  ```
- **Output:** Creates overview.md, patterns.json, history.md in workspace

---

### planner
- **Type:** Sequential
- **Description:** MAP (Modular Architecture Planning) - decomposes tasks, predicts outcomes, evaluates quality, monitors conflicts
- **Agents:** decomposer, predictor, quality-evaluator, conflict-monitor, coordinator
- **Use Case:** Complex feature planning, architectural decisions
- **Usage:**
  ```
  spawn planner mesh to design authentication system
  ```

---

### deep-research
- **Type:** HITL Loop
- **Description:** Multi-agent research with interviewer, sourcer, analyst, disprover, writer. Iterates until 95% confidence.
- **Agents:** interviewer, sourcer, analyst, researcher, disprover, writer
- **Capabilities:** search
- **Use Case:** Academic research, market analysis, comprehensive investigations
- **Usage:**
  ```
  spawn deep-research mesh about transformer architecture improvements
  ```
- **Output:** Comprehensive report in workspace
- **HITL Points:** Interviewer asks clarifying questions, disprover challenges hypotheses

---

### code-review
- **Type:** Parallel (fan-out)
- **Description:** Distributes review tasks to 4 specialized analyzers working in parallel
- **Agents:**
  - coordinator
  - solid-checker (SOLID principles)
  - doc-config-checker (documentation consistency)
  - test-coverage-analyzer
  - maintainability-analyzer
- **Use Case:** Pre-commit reviews, PR analysis, code quality audits
- **Usage:**
  ```
  spawn code-review mesh for lib/auth/
  ```
- **Output:** Comprehensive report in `.ai/reports/`

---

### tdd-cycle
- **Type:** Iterative
- **Description:** Red → Green → Refactor automation
- **Agents:** red-phase, green-phase, refactor-phase
- **Workflow:**
  1. **Red:** Write failing test
  2. **Green:** Implement minimal code to pass
  3. **Refactor:** Improve while keeping tests green
  4. **Loop** or complete
- **Use Case:** Test-driven development, feature implementation with tests
- **Usage:**
  ```
  spawn tdd-cycle mesh to implement user authentication
  ```

---

### gtm-strategy
- **Type:** Sequential
- **Description:** Go-to-market strategy for zero-network founders - generates progressive tasks from zero to first users
- **Agents:** strategist, task-planner, coordinator
- **Use Case:** Product launch planning, growth strategy
- **Usage:**
  ```
  spawn gtm-strategy mesh for my SaaS product
  ```
- **Output:** Actionable task list with timelines

---

### risk-experiment
- **Type:** Sequential
- **Description:** Designs and executes proactive risk-reduction experiments to validate assumptions before major implementation
- **Agents:** risk-analyzer, experiment-designer, validator
- **Use Case:** Validate technical approach, test assumptions, reduce uncertainty
- **Usage:**
  ```
  spawn risk-experiment mesh to test database scaling approach
  ```
- **Output:** Experiment results with confidence metrics

---

### hitl-3qa
- **Type:** HITL Loop
- **Description:** Human-in-the-loop 3-question interview workflow for requirements gathering
- **Agents:** interviewer, coordinator
- **Workflow:**
  1. Interviewer asks 3 clarifying questions
  2. Human responds
  3. Coordinator synthesizes requirements
- **Use Case:** Requirements elicitation, feature specification
- **Usage:**
  ```
  spawn hitl-3qa mesh for new dashboard feature
  ```

---

### research (legacy)
- **Type:** Sequential
- **Description:** Web research with evidence collection (superseded by deep-research)
- **Agents:** researcher
- **Use Case:** Quick web research without HITL

---

## Test Meshes

Used for testing TX functionality, not intended for production use.

### test-echo
- **Description:** Simple echo test - agent receives message and echoes back
- **Use Case:** Verify message routing

### test-ping-pong
- **Description:** Two agents exchange messages
- **Use Case:** Test agent-to-agent communication

### test-iterative
- **Description:** Worker creates content, reviewer provides feedback, worker refines
- **Use Case:** Test iterative refinement loops

### test-queue
- **Description:** Queue-based sequential processing
- **Use Case:** Test queue system

### test-recursive
- **Description:** Self-improving agent that sends messages to itself
- **Use Case:** Test recursive workflows

### riddle-game
- **Description:** Competitive riddle game between two agents with mediator scorekeeper
- **Use Case:** Agent capability testing, entertainment

---

## Mesh Topologies

TX supports multiple workflow patterns:

### Sequential
Agents process one after another.
```
Agent A → Agent B → Agent C → Complete
```
**Examples:** planner, gtm-strategy, risk-experiment

### Parallel (Fan-Out)
Multiple agents work simultaneously, coordinator aggregates.
```
           ┌→ Agent B ┐
Agent A ──→├→ Agent C ├→ Agent E (coordinator)
           └→ Agent D ┘
```
**Examples:** code-review

### HITL Loop
Agents iterate with human feedback until confidence threshold met.
```
Agent A → Human Input → Agent B → Agent C → [confidence check]
  ↑                                               ↓
  └───────────────[if < 95%]─────────────────────┘
```
**Examples:** deep-research, hitl-3qa

### Iterative
Cycles through phases until completion criteria met.
```
Red → Green → Refactor → [check] → Red (if more work) or Complete
```
**Examples:** tdd-cycle, test-iterative

### Persistent
Always-on agents that respond to requests.
```
Agent (idle) → Request → Process → Respond → (idle)
```
**Examples:** core, brain

---

## Creating Custom Meshes

### Step 1: Create Mesh Config

`meshes/mesh-configs/my-mesh.json`:
```json
{
  "mesh": "my-mesh",
  "type": "sequential",
  "description": "What this mesh does",
  "agents": ["worker"],
  "entry_point": "worker",
  "completion_agent": "worker",
  "capabilities": ["search", "watch"],
  "routing": {
    "worker": {
      "complete": {
        "core": "Work complete"
      }
    }
  }
}
```

### Step 2: Create Agent Prompt

`meshes/agents/my-mesh/worker/prompt.md`:
```markdown
# Worker Agent

You are the worker agent for my-mesh.

## Your Role
[Define what this agent does]

## Capabilities
[List available tools]

## Workflow
[Step-by-step process]
```

### Step 3: Test

```bash
tx spawn my-mesh
```

**Full guide:** [docs/examples/custom-mesh/](../examples/custom-mesh/)

---

## Mesh Selection Guide

| Need | Mesh | Why |
|------|------|-----|
| Understand codebase | `brain` | Spec-graph analysis, context provision |
| Plan complex feature | `planner` | MAP architecture, conflict detection |
| Research topic deeply | `deep-research` | HITL loop, 95% confidence threshold |
| Review code quality | `code-review` | 4 parallel analyzers, comprehensive report |
| Implement with TDD | `tdd-cycle` | Red-Green-Refactor automation |
| Launch product | `gtm-strategy` | Zero-to-first-users task generation |
| Validate approach | `risk-experiment` | Proactive risk reduction |
| Gather requirements | `hitl-3qa` | 3-question interview loop |

---

## Mesh Configuration Schema

```json
{
  "mesh": "string (required)",
  "type": "persistent | sequential | parallel | hitl | iterative",
  "description": "string (required)",
  "agents": ["array of agent names"],
  "entry_point": "string (first agent)",
  "completion_agent": "string (last agent)",
  "capabilities": ["array of capability names"],
  "workflow_topology": "sequential | fan-out | loop",
  "routing": {
    "agent-name": {
      "status": {
        "target-agent": "message"
      }
    }
  }
}
```

---

## Need Help?

- **[Getting Started](./getting-started.md)** - Setup guide
- **[Commands Reference](./commands.md)** - CLI commands
- **[Message System](./messages.md)** - Agent communication
- **[Architecture](./architecture.md)** - System design
- **[Examples](../examples/)** - Practical examples

---

**Next:** [Architecture →](./architecture.md)

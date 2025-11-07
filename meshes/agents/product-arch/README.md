# Product-Dev Mesh

**Collaborative MVP Development Workflow**

The product-arch mesh orchestrates the complete journey from initial product idea to implemented MVP through parallel agent collaboration and iterative refinement.

## Overview

This mesh implements a **collaborative topology** where agents work simultaneously and communicate directly to refine product definition and architecture before implementation begins.

### Workflow Phases

```
┌─────────────────┐
│   Coordinator   │  State detection & workflow routing
└────────┬────────┘
         │
         ├─────────────────────────────────┐
         │                                 │
         ▼                                 ▼
┌─────────────────┐              ┌─────────────────┐
│Product-Definer  │◄────ask─────►│   Architect     │  Parallel Work
│                 │────response──│                 │  Direct collaboration
│ WHAT to build   │              │ HOW to build it │
└────────┬────────┘              └────────┬────────┘
         │                                 │
         └──────────────┬──────────────────┘
                        │ both complete
                        ▼
                ┌───────────────┐
                │  Implementer  │  Build components in order
                └───────┬───────┘
                        │
                        ▼
           ┌─────────────────────┐
           │UI Ensemble Coord.   │  UI iteration
           └─────────────────────┘
```

## Agents

### Coordinator
**Entry point** - Detects project state, spawns appropriate agents, tracks completion

- Checks spec-graph state to determine workflow phase
- Spawns product-definer + architect simultaneously for greenfield projects
- Waits for both to complete before advancing workflow
- Routes to implementer when architecture is ready
- Facilitates without micromanaging

### Product-Definer
**Product vision** - Defines WHAT to build through user Q&A

- Conducts multi-round interviews with user
- Creates project/user/objective/feature entities in spec-graph
- Collaborates with architect via ask/ask-response messages
- Refines features based on architect's technical questions
- Completes when features are well-defined

### Architect
**Technical design** - Defines HOW to build it

- Starts simultaneously with product-definer (early engagement)
- Manages **dual-graph ownership**:
  - **Spec-graph** (`.ai/spec-graph.json`) - Product architecture (components, operations)
  - **Code-graph** (`.ai/code-graph.json`) - Implementation architecture (packages, modules, layers)
- Reviews features as they're created
- Asks clarifying questions to product-definer
- Designs component architecture with dependencies
- Links spec-graph and code-graph via references
- Completes when architecture is ready

### Implementer
**Code generation** - Builds components following architecture

- Implements components in dependency order
- Consults architect for clarification
- Updates component status in spec-graph
- Completes when all P0 components are built

### UI Ensemble Coordinator
**UI iteration** - Explores UI variants and refinement

- Spawns UI exploration meshes
- Coordinates variant evaluation
- Manages iteration cycles
- Completes when design is finalized

## Key Features

### Parallel Work Model

Product-definer and architect work **simultaneously**:
- Product-definer focuses on features (WHAT)
- Architect reviews and shapes features (HOW)
- They communicate directly to refine definitions
- Both can complete independently

**Benefits:**
- Faster overall workflow
- Early technical validation
- Features shaped by implementation reality
- Reduced rework

### Dual-Graph Architecture

Architect manages two knowledge graphs:

**Spec-Graph** (`.ai/spec-graph.json`) - Product architecture
- Features, actions, components, operations
- WHAT the system does
- Created by product-definer + architect

**Code-Graph** (`.ai/code-graph.json`) - Implementation architecture
- Packages, modules, layers, files
- HOW the system is structured
- Created by architect

**Cross-graph linking** via bidirectional references enables traceability from features to code.

### Iterative Refinement

Multiple rounds of Q&A and collaboration:
- Product-definer: Round 1 → Round 2 → Round 3+ until features are crisp
- Architect: Iterative component design based on evolving features
- Direct agent collaboration reduces user interruptions

### State Detection & Resume

Coordinator detects project state and resumes appropriately:
- **Empty graph** → Spawn both agents (greenfield)
- **Features exist, no components** → Spawn architect only
- **Components exist** → Spawn implementer only
- **All complete** → Spawn UI coordinator

## Usage

### Start New MVP Project

```bash
# From core agent or CLI
tx spawn product-arch
```

The coordinator will:
1. Check spec-graph state
2. Spawn product-definer + architect in parallel
3. Both agents begin working
4. User answers questions from either agent
5. Agents collaborate to refine definitions
6. Coordinator advances workflow when both complete

### Resume Existing Project

```bash
tx spawn product-arch
```

Coordinator automatically detects phase and routes to appropriate agent.

### Query Project State

```bash
# Check entity counts
tx tool know stats

# View specific entities
tx tool know query '{"type":"project"}'
tx tool know query '{"type":"feature"}'
tx tool know query '{"type":"component"}'

# Check architecture
tx tool know build-order
tx tool know cycles
tx tool know health

# Code-graph queries (use -g flag)
tx tool know -g .ai/code-graph.json query '{"type":"package"}'
tx tool know -g .ai/code-graph.json deps
```

## Message Patterns

### Agent-to-Agent (ask/ask-response)

```markdown
---
to: product-arch/product-definer
from: product-arch/architect
type: ask
msg-id: feat-scope-xyz
---

Feature "real-time-sync" - what's the latency requirement?
Options:
A) Sub-second (requires WebSockets)
B) 5-10 seconds (can use polling)

Recommendation: B is simpler for MVP
```

```markdown
---
to: product-arch/architect
from: product-arch/product-definer
type: ask-response
msg-id: feat-scope-xyz
---

Asked user - they confirmed 5-10 seconds is acceptable. Use polling.
Updated feature description to clarify latency expectations.
```

### Agent-to-User (ask-human)

```markdown
---
to: core/core
from: product-arch/product-definer
type: ask-human
msg-id: mvp-scope-abc
---

## MVP Scope Question

What's the primary user goal for this MVP?
A) Time tracking for freelancers
B) Project management for teams
C) Client invoicing and payments
D) Other: [please specify]

This will shape the core features we prioritize.
```

### Completion (task-complete)

```markdown
---
to: product-arch/coordinator
from: product-arch/product-definer
type: task-complete
status: complete
---

## Product Definition Complete

**Project**: project:taskflow
**Features**: 5 P0, 3 P1 features defined
**Collaboration**: Answered 3 questions from architect

Spec-graph ready for architecture phase.
```

## Best Practices

### For Users

1. **Answer questions thoughtfully** - Quality answers lead to better products
2. **Be specific about priorities** - Help agents understand P0 vs P1 vs P2
3. **Trust the process** - Agents iterate to get definitions right
4. **Watch for architect questions** - Technical input shapes realistic features

### For Mesh Design

1. **Enable direct communication** - Agents collaborate without coordinator interference
2. **Parallel spawning** - Start agents simultaneously when possible
3. **State-based routing** - Detect state, don't assume linear workflow
4. **Completion independence** - Agents complete when their work is done

### For Debugging

```bash
# View message log
tx msg --mesh product-arch

# Check agent sessions
tx session product-arch product-definer
tx session product-arch architect

# Inspect graphs
tx tool know -g .ai/spec-graph.json stats
tx tool know -g .ai/code-graph.json stats

# Health checks
tx tool know health
tx tool know cycles
```

## Configuration

**Mesh config**: `meshes/mesh-configs/product-arch.json`

```json
{
  "mesh": "product-arch",
  "workflow_topology": "iterative",
  "entry_point": "coordinator",
  "completion_agent": "coordinator"
}
```

**Routing rules** define communication paths between agents and core.

## Architecture Decisions

### Why Parallel Spawning?

Traditional workflows: Product → Architecture → Implementation (sequential)

This mesh: Product + Architecture (parallel) → Implementation

**Rationale:**
- Architect shapes features during definition
- Earlier technical validation
- Fewer feature rewrites
- Faster overall workflow

### Why Dual-Graph?

Separate graphs for product architecture and implementation architecture:
- **Spec-graph** tracks WHAT (product features, components)
- **Code-graph** tracks HOW (code structure, modules, files)
- **Cross-references** link them for traceability

**Benefits:**
- Clear separation of concerns
- Independent evolution of product and code
- Traceability from feature to implementation

### Why Direct Agent Communication?

Agents use ask/ask-response to collaborate directly:
- Reduces coordinator complexity
- Faster iteration cycles
- Agents self-organize and resolve questions
- Coordinator only intervenes when blocked

## Troubleshooting

### Coordinator stuck waiting for completion

Check message log for completion messages:
```bash
tx msg --mesh product-arch --type task-complete
```

### Agents not communicating

Verify routing rules in mesh config allow ask/ask-response between agents.

### Spec-graph validation fails

```bash
tx tool know health
tx tool know cycles
```

Fix circular dependencies or missing references.

### Code-graph not found

Ensure architect created `.ai/code-graph.json`:
```bash
tx tool know -g .ai/code-graph.json stats
```

## Related Meshes

- **brain** - Strategic guidance and pattern repository
- **risk-experiment** - Validate assumptions before committing to architecture
- **code-review** - Review generated code for quality

## Examples

See agent prompt files for detailed examples:
- `coordinator/prompt.md` - State detection and routing examples
- `product-definer/prompt.md` - Multi-round Q&A examples
- `architect/prompt.md` - Dual-graph and collaboration examples

---

**Status**: Production-ready
**Topology**: Iterative with parallel work
**Completion**: Coordinator tracks all phases

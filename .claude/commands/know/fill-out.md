---
name: Know: Fill Out Graphs
description: Comprehensively expand and interconnect existing graphs to achieve 100% coverage
category: Know
tags: [know, fill-out, expand, coverage]
---
Expand and interconnect spec-graph and code-graph to achieve 100% coverage.

**Arguments**: `$ARGUMENTS` — optional scope: `spec`, `code`, or `both` (e.g., `/know:fill-out spec` — defaults to `both`)

**Main Objective**

Take existing spec-graph.json and code-graph.json and expand them comprehensively with:
- Missing users, objectives, features, actions, components, operations
- Complete inter-module dependencies in code-graph
- Product-component links between graphs
- 100% coverage (all entities connected to root users)
- Rich project.md derived from graph intelligence

**When to Use This Command**

Use `/know:fill-out` when:
- You have basic graphs but want comprehensive coverage
- Coverage is < 100% or entities feel sparse
- You want deep interconnection between all graph nodes
- You need to map the entire codebase to the spec-graph
- You want to maximize graph intelligence for LLM context

**CRITICAL EXECUTION ORDER**

1. Parallel exploration (understand codebase deeply)
2. Expand spec-graph (users → objectives → features → actions → components → operations)
3. Expand code-graph (packages → modules → dependencies)
4. Link graphs (product-component references)
5. Validate both graphs
6. Measure coverage (aim for 100%)
7. Generate project.md from graph queries

---

## Workflow

### STEP 1: Activate Know Tool & Measure Current State

```bash
# Activate the know-tool skill
# Then measure current state
know -g .ai/know/spec-graph.json stats
know -g .ai/know/spec-graph.json coverage
know -g .ai/know/spec-graph.json gap-summary
know -g .ai/know/code-graph.json stats
```

**Create TodoWrite tracker**:
- Current spec-graph coverage: X%
- Current code-graph entities: Y
- Target: 100% coverage with comprehensive entities
- Tasks: [exploration, spec expansion, code expansion, linking, validation, project.md]

---

### STEP 2: Parallel Codebase Exploration

**CRITICAL**: Launch ALL agents in parallel (single message with multiple Task calls)

Launch these 4 agents concurrently:

1. **Explore agent (thoroughness: "very thorough")**
   ```
   Prompt: "Discover codebase architecture, patterns, dependencies, and organization.
   I need comprehensive understanding of directory structure, main modules, code patterns,
   architectural decisions, key dependencies, testing structure, and configuration."
   ```

2. **Task agent: Project Purpose**
   ```
   Prompt: "Analyze package.json, README, docs, and documentation to understand:
   - What is this project?
   - Who are the target users?
   - What are their main objectives?
   - What problems does it solve?
   - What are the key features?"
   ```

3. **Task agent: Module Dependencies**
   ```
   Prompt: "Scan all source files to map actual module dependencies by analyzing imports.
   I need:
   - All import statements
   - Which modules import which other modules
   - External dependencies used by each module
   - Module-to-module relationships based on actual code"
   ```

4. **Task agent: Feature Mapping**
   ```
   Prompt: "Identify main features and their corresponding code modules. I need:
   - What are the distinct features/capabilities?
   - Which source files/modules implement each feature?
   - What are the main commands/operations?
   - How do features map to codebase structure?"
   ```

**Wait for all agents to complete** before proceeding.

---

### STEP 3: Expand Spec-Graph Comprehensively

Based on exploration findings, systematically expand the spec-graph:

#### 3A. Add/Enrich Users

**Identify all user types from project purpose**:
- Who uses this tool? (developers, AI assistants, architects, PMs, integrators, etc.)
- What personas need to be represented?

```bash
# Add users
know -g .ai/know/spec-graph.json add user <user-id> '{"name":"...","description":"..."}'

# Examples:
know -g .ai/know/spec-graph.json add user ai-assistant '{"name":"AI Assistant","description":"LLM-based coding assistant managing project specs"}'
know -g .ai/know/spec-graph.json add user developer '{"name":"Software Developer","description":"Developer using know to manage product specs"}'
know -g .ai/know/spec-graph.json add user software-architect '{"name":"Software Architect","description":"System architect designing and planning architecture"}'
```

#### 3B. Add/Enrich Objectives

**Map what each user wants to accomplish**:
- Query graph structure?
- Manage specifications?
- Analyze gaps?
- Generate documentation?
- Track features?
- Integrate with tools?

```bash
# Add objectives
know -g .ai/know/spec-graph.json add objective <obj-id> '{"name":"...","description":"..."}'

# Link users to objectives
know -g .ai/know/spec-graph.json link user:ai-assistant objective:query-graph
know -g .ai/know/spec-graph.json link user:developer objective:manage-specs
```

#### 3C. Add/Enrich Features

**Identify all major features from exploration**:
- What capabilities does the system provide?
- What are the main feature areas?

```bash
# Add features
know -g .ai/know/spec-graph.json add feature <feature-id> '{"name":"...","description":"..."}'

# Link objectives to features
know -g .ai/know/spec-graph.json link objective:query-graph feature:cli-operations
know -g .ai/know/spec-graph.json link objective:manage-specs feature:graph-validation
```

#### 3D. Add Actions for Each Feature

**CRITICAL**: Every feature needs actions! Check gap-missing to find features without actions.

For each feature, identify 3-5 key actions:
- What user-facing operations does this feature provide?
- What are the main workflows?

```bash
# Add actions
know -g .ai/know/spec-graph.json add action <action-id> '{"name":"...","description":"..."}'

# Link features to actions
know -g .ai/know/spec-graph.json link feature:cli-operations action:add-entity
know -g .ai/know/spec-graph.json link feature:cli-operations action:query-dependencies
know -g .ai/know/spec-graph.json link feature:cli-operations action:list-entities
```

#### 3E. Add Components for Each Action

**Components are the building blocks**:
- What modules/classes implement these actions?
- What are the architectural components?

```bash
# Add components
know -g .ai/know/spec-graph.json add component <comp-id> '{"name":"...","description":"..."}'

# Link actions to components
know -g .ai/know/spec-graph.json link action:add-entity component:graph-operations
know -g .ai/know/spec-graph.json link action:query-dependencies component:graph-operations
```

#### 3F. Add Operations for Each Component

**Operations are the low-level implementations**:
- What functions/methods implement the component?
- What are the atomic operations?

```bash
# Add operations
know -g .ai/know/spec-graph.json add operation <op-id> '{"name":"...","description":"..."}'

# Link components to operations
know -g .ai/know/spec-graph.json link component:graph-operations operation:add_entity_to_graph
know -g .ai/know/spec-graph.json link component:graph-operations operation:get_entity_dependencies
```

#### 3G. Add References for Each Feature

**Gate**: A feature with zero non-code-link reference dependencies is under-specified.

For each feature, check what reference types exist:
```bash
know -g .ai/know/spec-graph.json graph uses feature:<name>
```

If the feature lacks specification references, add them. Look up available types:
```bash
know check ref-types                    # table with descriptions
know check ref-types --filter <term>    # filter by name or description
know gen rules describe <type>          # detail on a specific type
```

Common reference types for features:

| Reference Type | When to Add |
|---|---|
| `data-model` | Feature reads/writes structured data |
| `interface` | Feature exposes an API, CLI, or UI surface |
| `business-logic` | Feature enforces rules or policies |
| `requirement` | Feature has non-functional requirements (performance, security) |

```bash
# Add references
know -g .ai/know/spec-graph.json add data-model <model-key> '{"description":"..."}'
know -g .ai/know/spec-graph.json add interface <interface-key> '{"description":"..."}'

# Link features to references
know -g .ai/know/spec-graph.json link feature:<name> data-model:<model-key> interface:<interface-key>
```

#### 3H. Validate Spec-Graph

```bash
know -g .ai/know/spec-graph.json validate
know -g .ai/know/spec-graph.json gap-missing     # Check for missing connections
know -g .ai/know/spec-graph.json gap-summary     # Check completeness
know -g .ai/know/spec-graph.json coverage        # Measure coverage percentage
```

**Target**: 70%+ completion, all features have actions, most components have operations

---

### STEP 4: Expand Code-Graph Comprehensively

Based on module dependency analysis, expand code-graph:

#### 4A. Add Missing Modules

**Scan actual source files**:
```bash
# Find all source files
find <src-dir> -name "*.py" -o -name "*.js" -o -name "*.ts" | sed 's|<src-dir>/||' | sed 's|\..*$||'
```

Add each module:
```bash
know -g .ai/know/code-graph.json add module <module-id> '{"name":"...","description":"...","file":"path/to/file"}'
```

#### 4B. Add/Organize Packages

**Group modules into logical packages**:
```bash
know -g .ai/know/code-graph.json add package <package-id> '{"name":"...","description":"..."}'

# Link modules to packages
know -g .ai/know/code-graph.json link module:graph package:src
know -g .ai/know/code-graph.json link module:validation package:src
```

#### 4C. Map Inter-Module Dependencies

**CRITICAL**: Use actual import analysis from exploration!

For each module, add dependencies based on imports:
```bash
# Module A imports Module B
know -g .ai/know/code-graph.json link module:A module:B

# Module uses external dependency
# (external deps should already exist in references)
```

**Example dependency mapping**:
```bash
# CLI depends on core modules
know -g .ai/know/code-graph.json link module:cli module:graph
know -g .ai/know/code-graph.json link module:cli module:entities
know -g .ai/know/code-graph.json link module:cli module:validation

# Graph depends on entities and cache
know -g .ai/know/code-graph.json link module:graph module:entities
know -g .ai/know/code-graph.json link module:graph module:cache
```

#### 4D. Validate Code-Graph

```bash
know -g .ai/know/code-graph.json validate
know -g .ai/know/code-graph.json cycles        # Check for circular dependencies
know -g .ai/know/code-graph.json stats         # Verify entity counts and dependencies
```

**If cycles detected**: Break them by removing the least important dependencies.

**Target**: 40+ dependencies (for a 20-30 module codebase), 0 cycles

---

### STEP 5: Link Spec-Graph and Code-Graph

**Use product-component references in code-graph.json**:

Edit `.ai/know/code-graph.json` → `references.product-component`:

```json
"product-component": {
  "module-name": {
    "component": "component:spec-component-name",
    "graph_path": "spec-graph.json",
    "feature": "feature:parent-feature"
  }
}
```

**Map each major module to its implementing component**:
- Main CLI module → cli-commands component
- Graph manager → graph-operations component
- Validator → validation-engine component
- Generator → spec-templates component
- LLM integration → llm-integration component
- Task manager → task-manager component
- etc.

**Target**: 8-12 product-component links for typical projects

---

### STEP 6: Validate Both Graphs & Measure Quality

```bash
# Validate structure
know -g .ai/know/spec-graph.json validate
know -g .ai/know/code-graph.json validate

# Check quality metrics
know -g .ai/know/spec-graph.json stats
know -g .ai/know/spec-graph.json gap-summary
know -g .ai/know/spec-graph.json coverage      # AIM FOR 100%

know -g .ai/know/code-graph.json stats
know -g .ai/know/code-graph.json ref-usage     # Check references are used
```

**Quality Checklist**:
- ✅ Spec-graph coverage: 80-100%
- ✅ Spec-graph gap-summary: 60-80% completion
- ✅ Code-graph dependencies: > 0 (crucial!)
- ✅ Code-graph cycles: 0
- ✅ Product-component links: 6-12
- ✅ Both graphs validate without errors

**If quality is low**:
- Coverage < 80%: Add more connections between users → objectives → features
- Dependencies = 0: You forgot to link modules! Go back to Step 4C
- Cycles detected: Break circular dependencies

---

### STEP 7: Run Coverage Analysis & Connect Disconnected Entities

```bash
know -g .ai/know/spec-graph.json coverage
```

**If coverage < 100%**:

1. Review disconnected entities - are they relevant?
2. If yes, connect them to appropriate users via objectives
3. If no, consider removing them

**Use `/know:connect` skill** to systematically achieve 100% coverage.

---

### STEP 8: Generate Project.md from Graph Queries

**CRITICAL**: Query the graphs, don't bypass them!

```bash
# Query for project.md content
know -g .ai/know/spec-graph.json list-type user
know -g .ai/know/spec-graph.json list-type objective
know -g .ai/know/spec-graph.json list-type feature
know -g .ai/know/code-graph.json list-type package
know -g .ai/know/code-graph.json list-type module

# Get details
know -g .ai/know/spec-graph.json get user:developer
know -g .ai/know/spec-graph.json uses user:developer

# Get stats
know -g .ai/know/spec-graph.json stats
know -g .ai/know/spec-graph.json gap-summary
know -g .ai/know/spec-graph.json coverage
know -g .ai/know/code-graph.json stats
```

**Write `.ai/know/project.md`** with:
- **Purpose**: Derived from users and objectives
- **Tech Stack**: Derived from external-dep references
- **Architecture**: Derived from features, packages, modules
- **Conventions**: Scanned from config files (eslint, prettier, etc.)
- **Querying the Graphs**: Examples of how to query for info (not the stats themselves)

**Template sections**:
1. Purpose (users, objectives, features)
2. Tech Stack (language, external dependencies)
3. Graph Architecture (spec-graph and code-graph structure)
4. Project Conventions (code style, testing, git workflow)
5. Architecture Patterns (design patterns, constraints)
6. Technical Constraints (performance, security, deployment)
7. Domain Context (business logic references, data models)
8. Querying the Graphs (how to query for stats, not the stats themselves)

---

### STEP 9: Final Validation & Results

```bash
# Final checks
know -g .ai/know/spec-graph.json validate
know -g .ai/know/spec-graph.json coverage
know -g .ai/know/code-graph.json validate

# Display final stats
echo "=== SPEC-GRAPH ==="
know -g .ai/know/spec-graph.json stats
know -g .ai/know/spec-graph.json gap-summary

echo "=== CODE-GRAPH ==="
know -g .ai/know/code-graph.json stats
```

**Present to user**:
- ✅ Spec-graph: X entities, Y dependencies, Z% coverage
- ✅ Code-graph: A entities, B dependencies, C product-component links
- ✅ Project.md: Written with comprehensive intelligence
- ✅ Validation: Both graphs pass
- ✅ Quality: Coverage at TARGET%, comprehensive interconnection achieved

---

## Success Criteria

**Minimum targets**:
- Spec-graph coverage: ≥ 80%
- Spec-graph entities: ≥ 50 (for medium projects)
- Spec-graph dependencies: ≥ 50
- Code-graph modules: All major source files represented
- Code-graph dependencies: ≥ 30 (for 20-30 modules)
- Product-component links: ≥ 6
- Both graphs validate with 0 errors

**Ideal targets**:
- Spec-graph coverage: 100%
- Spec-graph: 100+ entities with deep chains
- Code-graph: All modules + comprehensive dependencies
- Product-component links: 8-15
- Project.md: Comprehensive, derived from graphs

---

## Tips for Success

1. **Parallel Exploration First**: Don't skip Step 2! Understanding the codebase deeply is crucial.

2. **Systematic Expansion**: Work top-down in spec-graph (users → objectives → features → actions → components → operations).

3. **Use Actual Imports**: For code-graph, use the import analysis from exploration. Don't guess dependencies.

4. **Connect Everything**: Every entity should trace back to a user. Use `know coverage` to verify.

5. **Fix Cycles Immediately**: If code-graph has cycles, break them by removing the least important dependency.

6. **Quality Over Quantity**: Better to have 50 well-connected entities than 200 floating ones.

7. **Validate Often**: Run `know graph check validate` after major additions to catch issues early.

8. **Query, Don't Bypass**: For project.md, always query the graphs instead of manually analyzing code.

---

## Example Session

```bash
# Step 1: Measure current state
know -g .ai/know/spec-graph.json coverage
# Output: 42% coverage, 25 entities, 18 dependencies

# Step 2: Launch parallel exploration agents
# (4 agents launched in parallel via Task tool)

# Step 3: Expand spec-graph systematically
# Add 3 more users, 4 more objectives, 15 actions, 10 operations
# Link everything in chains

# Step 4: Expand code-graph
# Add 10 missing modules, map 25 dependencies

# Step 5: Link graphs
# Add 8 product-component references

# Step 6: Validate
know -g .ai/know/spec-graph.json coverage
# Output: 100% coverage, 85 entities, 92 dependencies ✅

# Step 7: Generate project.md from queries

# Step 8: Present results
# ✅ Spec-graph: 85 entities, 92 dependencies, 100% coverage
# ✅ Code-graph: 28 entities, 45 dependencies
# ✅ Project.md: Comprehensive
```

---

**Remember**: The graph is the SOURCE OF TRUTH. Build it comprehensively, then derive everything else from graph queries.


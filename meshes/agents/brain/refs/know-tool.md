# Know Tool Reference

The **know tool** manages the project's knowledge graphs - structured representations of both product architecture and code implementation.

## Knowledge Graphs

TX CLI uses **two complementary knowledge graphs**:

1. **Product Graph** (`.ai/spec-graph.json`) - Product/feature architecture
2. **Code Graph** (`.ai/code-graph.json`) - Code implementation architecture

Both graphs use the same know tool and are cross-linked via references.

## What Know Covers

**Know handles structured technical architecture:**

**Product Graph:**
- Component hierarchies (users → objectives → features → actions → components)
- Product dependencies and feature relationships
- Implementation order (topological sorting)
- Architecture validation (cycles, completeness)
- Technical requirements and acceptance criteria

**Code Graph:**
- Module dependencies (imports/requires)
- Layered architecture (primitives → infrastructure → services → commands)
- Package organization
- External dependencies (npm packages)
- Behavioral logic (execution traces, call graphs, control flow, side effects)
- Cross-references to product components

**Know does NOT handle experiential knowledge** - that's in your artifacts:
- Patterns that worked/failed (patterns.json)
- Project goals and state (overview.md)
- Success history (history.md)
- Incomplete work (not-done.md)

## Access

```bash
# Use default graph (.ai/spec-graph.json)
tx tool know <command> [args]

# Specify graph explicitly with -g flag
know -g .ai/code-graph.json <command> [args]
know -g .ai/spec-graph.json <command> [args]
```

## Core Concepts

### Product Graph Structure (spec-graph.json)

The spec graph is a hierarchical knowledge representation:

```
users → objectives → features → actions → components → presentation/behavior/data_models
```

**Entity Types:**
- `users` - System personas (admin, customer, etc.)
- `objectives` - User goals and objectives
- `features` - High-level product features
- `actions` - Specific user actions within features
- `components` - UI/functional components
- `presentation` - Visual elements
- `behavior` - Interaction logic
- `data_models` - Data structures

**References (Terminal Nodes):**
- `acceptance_criteria` - Feature acceptance criteria
- `business_logic` - Business rules
- `technical_requirements` - Technical specs
- `implementation_notes` - Implementation details

### Graph File Format

```json
{
  "meta": {
    "project": {"name": "...", "description": "..."},
    "phases": []
  },
  "entities": {
    "features": {
      "feature-id": {"name": "...", "description": "..."}
    },
    "actions": {},
    "components": {}
  },
  "references": {
    "acceptance_criteria": {},
    "business_logic": {}
  },
  "graph": {
    "feature:feature-id": {
      "depends_on": ["action:id", "component:id"]
    }
  }
}
```

### Code Graph Structure (code-graph.json)

The code graph represents implementation architecture:

```
layers → packages → modules → external-deps
```

**Entity Types:**
- `module` - Individual source files (e.g., `module:logger`, `module:spawn-command`)
- `package` - Code organization units (e.g., `package:commands`, `package:core`)
- `layer` - Architectural layers (primitives, infrastructure, services, commands, tools)

**Reference Types (Implementation Details):**
- `source-file` - File path and implementation details
- `external-dep` - npm package dependencies (e.g., `external-dep:fs-extra`)
- `product-component` - Cross-reference to product graph components
- `execution-trace` - Step-by-step execution flow through functions
- `call-graph` - Function call relationships (what calls what)
- `control-flow` - Conditional logic, branches, loops
- `data-flow` - Data transformations through the system
- `side-effect` - File I/O, state mutations, process spawning
- `error-path` - Exception handling and recovery strategies

**Example Code Graph Query:**
```bash
# List all modules
know -g .ai/code-graph.json list-type module

# Show module dependencies
know -g .ai/code-graph.json dependents module:spawn-command

# View behavioral references
know -g .ai/code-graph.json ref-usage

# Query execution trace
jq '.references["execution-trace"]["spawn-command"]' .ai/code-graph.json

# Query side effects
jq '.references["side-effect"]' .ai/code-graph.json
```

## Commands

### Inspection

```bash
# List all entities
tx tool know list

# List by type
tx tool know list-type features
tx tool know list-type actions
tx tool know list-type components

# Get entity details
tx tool know get feature:auth

# Show statistics
tx tool know stats
```

### Dependencies

```bash
# Show what entity depends on
tx tool know deps feature:analytics

# Show what depends on entity (reverse)
tx tool know dependents component:button

# Show implementation order (topological sort)
tx tool know build-order

# Suggest valid connections
tx tool know suggest feature:new-feature
```

### Validation

```bash
# Comprehensive health check
tx tool know health

# Detect circular dependencies
tx tool know cycles

# Check entity completeness score
tx tool know completeness feature:target
```

### Building

```bash
# Add entity
tx tool know add feature user-auth '{"name":"User Auth","description":"Login system"}'

# Add dependency
tx tool know add-dep feature:user-auth action:login

# Remove dependency
tx tool know remove-dep feature:old action:deprecated
```

### Generation

```bash
# Generate entity specification
tx tool know spec feature:analytics

# Generate detailed feature spec
tx tool know feature-spec feature:target

# Generate project sitemap
tx tool know sitemap
```

### References

```bash
# Find orphaned references
tx tool know ref-orphans

# Suggest connections for orphans
tx tool know ref-suggest

# Show reference usage statistics
tx tool know ref-usage

# Clean up unused references
tx tool know ref-clean
```

## Usage Patterns

### Building Graph from Analysis

When analyzing codebase:

1. Identify key entities (features, components)
2. Build incrementally:
   ```bash
   tx tool know add feature analytics '{"name":"Analytics","description":"Usage tracking"}'
   tx tool know add action track-event '{"name":"Track Event","description":"Record events"}'
   tx tool know add-dep feature:analytics action:track-event
   ```
3. Validate as you go:
   ```bash
   tx tool know health
   tx tool know cycles
   ```

### Querying for Plans

When formulating development plans:

1. Check what exists:
   ```bash
   tx tool know list-type features
   tx tool know get feature:target
   ```
2. Analyze dependencies:
   ```bash
   tx tool know deps feature:target
   tx tool know build-order
   ```
3. Generate specs:
   ```bash
   tx tool know feature-spec feature:target
   ```

### Validating Architecture

When checking consistency:

1. Run health check: `tx tool know health`
2. Check for cycles: `tx tool know cycles`
3. Find orphans: `tx tool know ref-orphans`
4. Review completeness: `tx tool know completeness feature:each`

## Using Both Graphs Together

The product and code graphs are **cross-linked** for traceability:

**From Product → Code:**
```bash
# Product components link to code modules via code-module references
jq '.references["code-module"]["spawn-command"]' .ai/spec-graph.json
# Returns: {"module": "module:spawn-command", "graph_path": ".ai/code-graph.json", ...}
```

**From Code → Product:**
```bash
# Code modules link to product components via product-component references
know -g .ai/code-graph.json dependents module:spawn-command | grep "product-component"
# Shows: product-component:spawn-command
```

**Workflow for Initial Project Assessment:**

1. **Analyze Product Graph:**
   ```bash
   know -g .ai/spec-graph.json health
   know -g .ai/spec-graph.json stats
   know -g .ai/spec-graph.json list-type features
   ```

2. **Analyze Code Graph:**
   ```bash
   know -g .ai/code-graph.json health
   know -g .ai/code-graph.json stats
   know -g .ai/code-graph.json list-type module
   know -g .ai/code-graph.json ref-usage
   ```

3. **Cross-Reference Analysis:**
   ```bash
   # Check product-to-code mappings
   jq '.references["code-module"]' .ai/spec-graph.json

   # Verify behavioral documentation
   jq '.references["execution-trace"]' .ai/code-graph.json
   jq '.references["side-effect"]' .ai/code-graph.json
   ```

4. **Dependency Analysis:**
   ```bash
   # Module dependencies
   know -g .ai/code-graph.json dependents module:logger

   # External dependencies
   know -g .ai/code-graph.json ref-usage | grep external-dep
   ```

## Best Practices

**Product Graph:**
- **Start from top** - Begin with features, break down to components
- **Consistent naming** - Use `kebab-case` for keys, Title Case for names
- **Validate frequently** - Run health checks regularly
- **Follow hierarchy** - Respect entity type dependencies
- **Avoid cycles** - Use cycles command to detect issues
- **Use build-order** - Let topological sort guide implementation

**Code Graph:**
- **Analyze layers** - Understand architectural layers (primitives → infrastructure → services → commands)
- **Track dependencies** - Use `dependents` to see what each module depends on
- **Document behavior** - Add execution-trace, side-effect, and error-path references for critical modules
- **Cross-link to product** - Use product-component references to trace code back to features
- **Monitor external deps** - Check ref-usage for external-dep to understand npm dependencies

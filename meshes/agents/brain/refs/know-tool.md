# Know Tool Reference

The **know tool** manages the project's specification graph (`.ai/spec-graph.json`) - a structured knowledge graph of the codebase.

## What Know Covers

**Know handles structured technical architecture:**
- Component hierarchies (users → objectives → features → actions → components)
- Dependencies between entities
- Implementation order (topological sorting)
- Architecture validation (cycles, completeness)
- Technical requirements and acceptance criteria

**Know does NOT handle experiential knowledge** - that's in your artifacts:
- Patterns that worked/failed (patterns.json)
- Project goals and state (overview.md)
- Success history (history.md)
- Incomplete work (not-done.md)

## Access

```bash
tx tool know <command> [args]
```

## Core Concepts

### Spec Graph Structure

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

## Best Practices

- **Start from top** - Begin with features, break down to components
- **Consistent naming** - Use `kebab-case` for keys, Title Case for names
- **Validate frequently** - Run health checks regularly
- **Follow hierarchy** - Respect entity type dependencies
- **Avoid cycles** - Use cycles command to detect issues
- **Use build-order** - Let topological sort guide implementation

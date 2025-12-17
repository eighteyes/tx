# Validating Spec Graphs

## Validation Hierarchy

The graph must satisfy multiple levels of correctness:

1. **Structure** - Valid JSON, required sections exist, entity schemas correct
2. **Dependencies** - Follow allowed_dependencies rules
3. **Cycles** - No circular dependencies (must be DAG)
4. **Completeness** - Dependency chains are complete
5. **References** - Referenced IDs exist and are valid

## Basic Validation

### Always Run After Changes

```bash
# Must run after any graph modification
know validate
```

This checks:
- Entity structure (name & description keys only)
- Dependency rules compliance
- Graph section integrity
- Reference existence

**Expected output when valid:**
```
✓ Graph structure valid
✓ Dependencies follow rules
✓ No invalid references
```

**Example error output:**
```
✗ Invalid dependency: feature:analytics → operation:button-click
  (feature can only depend on: action)

✗ Missing entity: action:missing-action referenced in graph
```

## Comprehensive Health Check

```bash
# Deep validation with statistics
know health
```

Provides:
- Entity counts by type
- Dependency rule violations
- Orphaned entities (in graph but not in entities section)
- Missing entities (referenced but don't exist)
- Completeness metrics
- Reference usage stats

## Checking for Circular Dependencies

```bash
# Detect cycles (graph must be DAG)
know cycles
```

**Valid output:**
```
✓ No circular dependencies detected
```

**If cycles found:**
```
✗ Circular dependency detected:
  feature:a → action:b → component:c → component:d → action:e → feature:a
```

**To fix cycles:**
1. Identify the cycle path
2. Remove one dependency to break the cycle: `know unlink entity:x entity:y`
3. Re-validate: `know cycles`

## Completeness Checking

### Check Single Entity

```bash
# See completeness score and missing dependencies
know completeness feature:analytics-dashboard
```

**Output:**
```
Completeness: 80%

Missing dependencies:
  • action:export-data has no components
  • Recommendation: Add component dependencies to action:export-data
```

### Check All Entities

```bash
# Overall implementation status
know gap-summary
```

Shows:
- Total users, objectives, features, actions, components
- How many components have dependencies
- Overall completion percentage

### Gap Analysis

```bash
# Find incomplete dependency chains for specific entity
know gap-analysis feature:analytics-dashboard

# Analyze specific entity type
know gap-analysis
```

**Output shows:**
- Missing connections in dependency chain
- Orphaned entities
- Disconnected features
- Suggestions for completion

## Dependency Validation

### Verify Allowed Dependencies

Before adding dependencies, check rules:

```bash
# What can feature depend on?
know rules after feature
# Output: action

# What can depend on component?
know rules before component
# Output: action, component
```

### Check Existing Dependencies

```bash
# See what entity depends on
know uses feature:analytics-dashboard

# See dependency tree
know uses feature:analytics-dashboard --recursive

# See what depends on this entity
know used-by component:data-exporter

# See full dependent tree
know used-by component:data-exporter --recursive
```

### Suggest Valid Connections

```bash
# Get suggestions for what entity can connect to
know suggest feature:new-feature
```

Shows valid entity types this can depend on based on rules.

## Reference Validation

### Find Orphaned References

```bash
# Find references not used by any entity
know ref-orphans
```

**Output:**
```
Orphaned References:

business_logic:
  • old_workflow_logic
  • deprecated_rules

data-models:
  • unused_model
```

**To fix:**
- Update entity descriptions to reference them
- Or remove if truly unused

### Check Reference Usage

```bash
# See which references are used and how often
know ref-usage
```

Shows usage count for each reference.

### Clean Unused References

```bash
# Dry run (preview what would be removed)
know ref-clean --dry-run

# Actually remove unused references
know ref-clean --remove --execute
```

### Suggest Reference Connections

```bash
# Get suggestions for connecting orphaned references
know ref-suggest --max 20
```

Shows potential entity-reference connections based on name similarity.

## Build Order Validation

```bash
# Get topological sort (implementation order)
know build-order
```

Shows entities in dependency order (dependencies first, then dependents).

**Use cases:**
- Verify implementation order makes sense
- Find entities that block many others
- Plan development phases

## Common Validation Issues

### Issue: Invalid Dependency

```
✗ Invalid dependency: feature:x → component:y
  (feature can only depend on: action)
```

**Fix:**
```bash
# Check what feature can depend on
know rules after feature

# Remove invalid dependency
know unlink feature:x component:y

# Add correct intermediate entity
know add action trigger-y '{"name": "...", "description": "..."}'
know link feature:x action:trigger-y
know link action:trigger-y component:y

# Validate
know validate
```

### Issue: Circular Dependency

```
✗ Circular dependency: a → b → c → a
```

**Fix:**
```bash
# Analyze the cycle - one dependency is probably wrong
know uses entity:a
know uses entity:b

# Remove the incorrect dependency
know unlink entity:c entity:a

# Validate
know cycles
know validate
```

### Issue: Missing Entity

```
✗ Entity referenced in graph but not found: action:missing-action
```

**Fix:**
```bash
# Either add the missing entity
know add action missing-action '{"name": "...", "description": "..."}'

# Or remove the invalid reference from graph
# (manually edit .ai/spec-graph.json)

# Validate
know validate
```

### Issue: Incomplete Dependency Chain

```
Completeness: 60%
Missing: action:export-data has no components
```

**Fix:**
```bash
# Check what action can depend on
know rules after action
# Output: component

# Add component
know add component csv-exporter '{"name": "CSV Exporter", "description": "..."}'

# Connect action to component
know link action:export-data component:csv-exporter

# Validate
know completeness action:export-data
```

### Issue: Orphaned References

```
Orphaned: business_logic:old_workflow
```

**Fix Option 1 - Use it:**
```bash
# Find entities that should reference it
know list-type action

# Update entity description to reference it
# Edit .ai/spec-graph.json:
# "description": "Does X (see business_logic:old_workflow)"
```

**Fix Option 2 - Remove it:**
```bash
# If truly unused
know ref-clean --remove --execute
```

## Validation Workflow

### After Every Modification

```bash
# 1. Basic validation
know validate

# 2. Check for cycles
know cycles

# 3. Check completeness of changed entities
know completeness feature:modified-feature
```

### Before Committing Changes

```bash
# 1. Comprehensive check
know health

# 2. Verify build order makes sense
know build-order

# 3. Check for orphans
know ref-orphans

# 4. Verify gap analysis
know gap-summary
```

### Periodic Deep Validation

```bash
# Run all validation checks
know validate
know health
know cycles
know gap-summary
know ref-orphans
know build-order

# Check specific entities
know completeness feature:critical-feature
know gap-analysis feature:critical-feature
```

## Validation Checklist

- [ ] `know validate` passes
- [ ] `know cycles` finds no circular dependencies
- [ ] `know health` shows no errors
- [ ] `know gap-summary` shows acceptable completion %
- [ ] `know ref-orphans` shows no (or minimal) orphaned references
- [ ] `know build-order` produces sensible order
- [ ] Critical features pass `know completeness`
- [ ] Dependency chains are complete: `know uses --recursive`

# Generating Specs from Spec Graphs

## Overview

The `know` tool can generate specifications from the graph by following dependency chains and assembling related entities and references.

## Spec Generation Commands

### Generate Entity Specification

```bash
# Generate spec for any entity
know spec <entity-path>
```

**Examples:**
```bash
know spec feature:analytics-dashboard
know spec action:export-data
know spec component:ml-engine
know spec interface:fleet-dashboard
```

**Output includes:**
- Entity details (name, description)
- Direct dependencies
- Recursive dependency tree
- Related references (extracted from descriptions)
- Implementation notes

### Generate Feature Specification

```bash
# Detailed feature spec with complete context
know feature-spec <feature-id>
```

**Example:**
```bash
know feature-spec feature:analytics-dashboard
```

**Output includes:**
- Feature overview
- Related objectives (what user goals it serves)
- Related interfaces (where it appears)
- All actions associated with feature
- All components required
- Business logic references
- Acceptance criteria
- State mutations
- Complete dependency tree
- Implementation gaps (if any)

### Generate Sitemap

```bash
# Generate sitemap of all interfaces
know sitemap
```

**Output:**
- All interface entities
- Their relationships
- Navigation structure
- API endpoints vs UI screens

## Understanding Generated Specs

### Spec Structure

Generated specs follow dependency chains:

```
Feature: analytics-dashboard
├─ Description: Real-time analytics visualization
├─ Dependencies:
│  └─ action:export-data
│     └─ component:data-exporter
│        └─ component:file-writer
├─ References:
│  ├─ business_logic:export_data_logic
│  ├─ acceptance_criteria:analytics_criteria
│  └─ data-models:analytics_model
└─ Completeness: 100%
```

### Reference Extraction

Specs automatically extract references mentioned in entity descriptions:

**Entity description:**
```
"Export analytics data (see business_logic:export_data_logic and data-models:analytics_model)"
```

**Extracted references:**
- `business_logic:export_data_logic`
- `data-models:analytics_model`

## Dynamic Spec Building

Since spec graphs are dynamic, use discovery commands before generating:

### 1. Discover Entity Structure

```bash
# What type of entity?
know rules describe entities

# Get specific type details
know rules describe feature
know rules describe action
```

### 2. Find Target Entity

```bash
# List all entities of type
know list-type feature

# Search for specific entity
know get feature:analytics-dashboard
```

### 3. Check Dependencies

```bash
# See what entity depends on
know uses feature:analytics-dashboard

# See full dependency tree
know uses feature:analytics-dashboard --recursive
```

### 4. Verify Completeness

```bash
# Check if entity has complete dependencies
know completeness feature:analytics-dashboard

# Find gaps
know gap-analysis feature:analytics-dashboard
```

### 5. Generate Spec

```bash
# Generate the spec
know spec feature:analytics-dashboard

# Or for detailed feature spec
know feature-spec feature:analytics-dashboard
```

## Generating Specs for Multiple Entities

### All Features

```bash
# List all features
know list-type feature

# Generate spec for each
for feature in $(know list-type feature | tail -n +3); do
  echo "=== $feature ==="
  know spec feature:$feature
  echo
done
```

### All Actions

```bash
# List and generate
know list-type action | tail -n +3 | while read action; do
  know spec action:$action > specs/actions/${action}.md
done
```

### Build Order Generation

```bash
# Generate specs in dependency order
know build-order | while read entity; do
  know spec $entity > specs/${entity//:/_}.md
done
```

## Reference Discovery for Specs

### Find Available References

```bash
# List all reference types
know rules describe references

# Get details on specific type
know rules describe business_logic
know rules describe data-models
know rules describe acceptance_criteria
```

### Check Reference Usage

```bash
# See which references are used
know ref-usage

# Find specific reference in graph
know get business_logic:export_data_logic
```

### Include References in Specs

When generating specs, references mentioned in entity descriptions are automatically included. To add references:

1. Discover reference types: `know rules describe references`
2. Add reference to spec-graph.json under `references` section
3. Update entity description to mention it: `"see business_logic:export_logic"`
4. Generate spec: reference will be included

## Generating API Documentation

### Find API Endpoints

```bash
# List all interfaces
know list-type interface

# Filter for API endpoints (if using naming convention)
know list-type interface | grep api
```

### Generate API Spec

```bash
# Generate spec for API interface
know spec interface:user-auth-api

# Include dependencies
know uses interface:user-auth-api --recursive
```

### Extract API References

API specs often reference:
- `endpoints` - API definitions
- `api_contracts` - Request/response schemas
- `error_states` - Error handling
- `validation_rules` - Input validation

```bash
# Discover these reference types
know rules describe endpoints
know rules describe api_contracts
```

## Generating UI Documentation

### Find UI Interfaces

```bash
# List interfaces
know list-type interface

# Get UI screens (filter by naming or check descriptions)
know get interface:fleet-dashboard
```

### Generate UI Spec

```bash
know feature-spec feature:dashboard-feature
```

### Extract UI References

UI specs often reference:
- `content` - User-facing text
- `labels` - Button/field labels
- `styles-css` - Styling
- `layouts-css` - Layout patterns
- `patterns-css` - Interaction patterns

```bash
# Discover these reference types
know rules describe labels
know rules describe patterns-css
```

## Spec Export Patterns

### Markdown Export

```bash
# Generate spec and save
know spec feature:analytics > docs/features/analytics.md

# Generate all feature specs
mkdir -p docs/features
for f in $(know list-type feature | tail -n +3); do
  know feature-spec $f > docs/features/$(echo $f | sed 's/:/-/').md
done
```

### JSON Export

Spec graph is already JSON:

```bash
# Full graph
cat .ai/spec-graph.json

# Specific entity (using jq)
jq '.entities.feature."analytics-dashboard"' .ai/spec-graph.json

# With dependencies
know uses feature:analytics --recursive | jq -R . | jq -s .
```

## Integration with LLM Workflows

### Generating Requirements

```bash
# 1. List available entities
know rules describe entities

# 2. Explore existing requirements
know list-type requirement

# 3. Check dependency structure
know rules after requirement
# Output: interface, component

# 4. Generate spec for requirement
know spec requirement:low-latency-teleoperation

# 5. See what implements it
know used-by requirement:low-latency-teleoperation --recursive
```

### Generating Implementation Plans

```bash
# 1. Get feature spec
know feature-spec feature:new-feature

# 2. Check completeness
know completeness feature:new-feature

# 3. Find gaps
know gap-analysis feature:new-feature

# 4. Get build order
know build-order | grep new-feature

# 5. Generate specs for each dependency
know uses feature:new-feature --recursive | while read dep; do
  know spec $dep
done
```

## Statistics and Metrics

### Graph Statistics

```bash
# Overall graph metrics
know stats
```

Shows:
- Entity counts by type
- Reference counts by category
- Total dependencies
- Graph size metrics

### Implementation Metrics

```bash
# Implementation status
know gap-summary
```

Shows:
- Entity counts across types
- Completion percentages
- Missing dependencies

## Advanced Generation

### Custom Spec Templates

Generated specs can be customized by:

1. Examining entity structure: `know get entity:path`
2. Checking dependencies: `know uses --recursive`
3. Extracting references from descriptions
4. Combining with reference details
5. Building custom output format

### Batch Generation

```bash
# Generate all specs by type
for type in feature action component; do
  mkdir -p specs/$type
  know list-type $type | tail -n +3 | while read entity; do
    know spec $type:$entity > specs/$type/${entity}.md
  done
done
```

### Conditional Generation

```bash
# Only generate for complete entities
know list-type feature | tail -n +3 | while read feat; do
  completeness=$(know completeness feature:$feat | grep "Completeness:" | awk '{print $2}')
  if [ "$completeness" = "100%" ]; then
    know feature-spec feature:$feat > specs/complete/${feat}.md
  fi
done
```

## Best Practices

1. **Validate before generating**: Run `know validate` to ensure graph is correct
2. **Check completeness**: Use `know completeness` to ensure full dependency chains
3. **Use feature-spec for features**: Provides richer context than basic `spec`
4. **Follow dependencies**: Use `deps --recursive` to understand full context
5. **Include references**: Mention references in entity descriptions for auto-inclusion
6. **Discover dynamically**: Use `know rules describe` to discover available types
7. **Verify gaps**: Run `know gap-analysis` before generating implementation specs

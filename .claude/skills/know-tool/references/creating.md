# Creating and Modifying Spec Graphs

## Discovery: What Can I Add?

```bash
# List all available entity types
know rules describe entities

# List all available reference types
know rules describe references

# List all meta sections
know rules describe meta

# Get details on specific type
know rules describe feature
know rules describe business_logic
```

## Adding Entities

### 1. Check Entity Type Details

```bash
# Understand the entity type first
know rules describe <entity-type>

# See what it can depend on
know rules after <entity-type>

# See what can depend on it
know rules before <entity-type>
```

### 2. Add the Entity

```bash
know add <type> <key> '{"name": "Display Name", "description": "What it does"}'
```

**Examples:**
```bash
know add feature analytics-dashboard '{"name": "Analytics Dashboard", "description": "Real-time analytics visualization"}'

know add action export-data '{"name": "Export Data", "description": "User exports analytics to CSV"}'

know add component data-exporter '{"name": "Data Exporter", "description": "Handles CSV export generation"}'
```

**Rules:**
- Keys use kebab-case (analytics-dashboard, not analytics_dashboard)
- Only `name` and `description` fields allowed
- Description should be clear and concise

### 3. Verify Addition

```bash
know get <type>:<key>
know list-type <type>
```

## Adding Dependencies

### 1. Check Dependency Rules

```bash
# What can this type depend on?
know rules after feature
# Output: action

# What can depend on this type?
know rules before component
# Output: action, component
```

### 2. Add the Dependency

```bash
know link <from-entity> <to-entity>
```

**Examples:**
```bash
# Feature depends on action
know link feature:analytics-dashboard action:export-data

# Action depends on component
know link action:export-data component:data-exporter

# Component depends on component (allowed!)
know link component:data-exporter component:file-writer
```

### 3. Verify Dependency

```bash
# See direct dependencies
know uses feature:analytics-dashboard

# See full dependency tree
know uses feature:analytics-dashboard --recursive

# See what depends on an entity
know used-by component:data-exporter
```

## Working with References

References provide implementation details but don't participate in the dependency graph.

### 1. Discover Reference Types

```bash
# List all reference categories
know rules describe references

# Get details on specific reference type
know rules describe business_logic
know rules describe data-models
know rules describe acceptance_criteria
```

### 2. Add References Directly to spec-graph.json

References are added by editing `.ai/spec-graph.json` under the `references` section:

```json
{
  "references": {
    "business_logic": {
      "export_data_logic": {
        "pre_conditions": ["User has data to export", "User has permissions"],
        "workflow": [
          "Validate export parameters",
          "Query database for data",
          "Format as CSV",
          "Stream to user download"
        ],
        "post_conditions": ["File downloaded successfully"],
        "error_handling": ["Handle timeout", "Handle large datasets"]
      }
    }
  }
}
```

### 3. Reference from Entity Descriptions

Link references in entity descriptions:

```bash
know add action export-data '{
  "name": "Export Data",
  "description": "User exports analytics (see business_logic:export_data_logic)"
}'
```

## Working with Meta Sections

Meta contains project-level information.

### 1. Discover Meta Structure

```bash
# List all meta sections
know rules describe meta

# Get structure for specific section
know rules describe phases
know rules describe project
know rules describe decisions
```

### 2. Edit Meta in spec-graph.json

Meta sections are edited directly in `.ai/spec-graph.json` under `meta`:

```json
{
  "meta": {
    "project": {
      "name": "My Project",
      "tagline": "Does cool things",
      "brand_promise": "Reliable and fast"
    },
    "phases": [
      {
        "id": "1_foundation",
        "name": "Foundation",
        "description": "Core infrastructure",
        "parallelizable": false,
        "requirements": ["requirement:core-api"]
      }
    ]
  }
}
```

## Complete Feature Addition Workflow

```bash
# 1. Discover available types
know rules describe entities
know rules describe references

# 2. Understand target entity type
know rules describe feature
know rules after feature    # Shows: action

# 3. Add the feature
know add feature new-analytics '{"name": "Advanced Analytics", "description": "ML-powered insights"}'

# 4. Check what feature can depend on (action)
know rules describe action
know rules after action     # Shows: component

# 5. Add or find action
know list-type action       # See existing actions
know add action analyze-data '{"name": "Analyze Data", "description": "Run ML analysis"}'

# 6. Connect feature to action
know link feature:new-analytics action:analyze-data

# 7. Add components
know add component ml-engine '{"name": "ML Engine", "description": "Runs ML models"}'

# 8. Connect action to component
know link action:analyze-data component:ml-engine

# 9. Add business logic reference (edit spec-graph.json)
# Add to references.business_logic.analyze_data_logic

# 10. Update action description to reference it
# Update action:analyze-data description to mention business_logic:analyze_data_logic

# 11. Verify complete chain
know uses feature:new-analytics --recursive

# 12. Validate
know validate
```

## Modifying Existing Entities

Entities are modified by editing `.ai/spec-graph.json` directly:

```json
{
  "entities": {
    "feature": {
      "analytics-dashboard": {
        "name": "Analytics Dashboard - Updated",
        "description": "New description here"
      }
    }
  }
}
```

## Removing Dependencies

```bash
know unlink feature:old-feature action:obsolete-action
```

## Removing Entities

Currently requires manual editing of `.ai/spec-graph.json`. Remove from:
1. `entities` section
2. `graph` section (all references to it)

## Suggestions and Discovery

```bash
# Get suggestions for what an entity can connect to
know suggest feature:new-feature

# See build order for implementation
know build-order

# Find orphaned references
know ref-orphans

# Get suggestions for connecting orphans
know ref-suggest
```

## Best Practices

1. **Always check rules first**: Use `know rules describe` before adding entities
2. **Validate incrementally**: Run `know validate` after each change
3. **Follow dependency chains**: Use `know uses --recursive` to see full context
4. **Use meaningful keys**: Descriptive kebab-case keys (real-time-telemetry, not rtt)
5. **Reference details**: Put implementation details in references, not entity descriptions
6. **Check completeness**: Use `know gap-analysis` to find missing connections

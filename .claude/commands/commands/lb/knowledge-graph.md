# Knowledge Graph Generator

Generate a comprehensive knowledge-map.json for the current project using hybrid JSON graph approach.

## Usage
```bash
/knowledge-graph [--validate] [--stats] [--output=filename]
```

## Description
Creates a structured knowledge map that captures the entire project as a graph database in pure JSON format. This enables powerful relationship queries while maintaining universal JSON tooling compatibility.

## Implementation

The command will:

1. **Analyze current project structure** - Scan for screens, components, features, schema definitions, requirements, and classify each into graph `dimensions`
2. **Generate hybrid graph JSON** - Create entities, relationships, indexes, and pre-computed views  
3. **Validate consistency** - Copy graph query tools and run integrity checks
4. **Check for duplicity** - Detect duplicate entities, descriptions, and redundant relationships
5. **Output structured knowledge map** - Save to knowledge-map.json with CLI-parseable format

## Graph Schema

```json
{
  "meta": {
    "version": "1.0.0",
    "format": "json-graph", 
    "description": "Project knowledge map with graph relationships",
    "generated_at": "timestamp",
    "project_root": "/path/to/project",
    "project": {
      "name": "STRING",
      "abbreviation": "STRING",
      "tagline": "STRING",
      "brand_promise": "STRING",
      "deployment": "OBJECT<deployment_info>",
      "out_of_scope": "ARRAY<STRING>"
    },
    "dimensions": {
      "strategy": "Why the work exists and sequencing priorities",
      "platform": "Runtime surfaces and infrastructure commitments",
      "stakeholder": "People/systems served and their expectations"
      /* extend with additional dimensions as needed */
    },
    "views": {
      "delivery_flow": {
        "layers": [
          "strategy", "platform", "stakeholder", "experience",
          "capability", "component", "presentation", "data", "implementation"
        ],
        "notes": "Default sequencing used in documentation and tooling"
      },
      "user_value": {
        "layers": ["stakeholder", "experience", "capability", "strategy"],
        "notes": "Example alternate perspective"
      }
    }
  },
  "references": {
    "descriptions": {
      "shared-technical-desc": "Technical descriptions used across multiple entities",
      "versioned-feature-desc": "Feature descriptions that evolve through versions",
      "ui-system-desc": "Design system descriptions shared by UI components"
    },
    "technical_architecture": {
      "api_gateway": "API gateway configuration and settings",
      "message_broker": "Message broker setup and configuration",
      "database": "Primary database configuration",
      "cache_layer": "Cache layer setup and configuration"
    },
    "endpoints": {
      "api_endpoints": "REST and WebSocket API endpoint definitions",
      "service_endpoints": "Microservice communication endpoints"
    },
    "libraries": {
      "frontend_libraries": "UI framework and component libraries",
      "backend_libraries": "Server-side libraries and frameworks",
      "shared_libraries": "Common libraries used across platforms"
    },
    "protocols": {
      "communication_protocols": "Inter-service communication protocols",
      "data_formats": "Data serialization and transmission formats",
      "authentication": "Authentication and authorization protocols"
    },
    "ui": {
      "design_system": "Brand guidelines, colors, typography, spacing",
      "components": "UI component specifications and usage",
      "patterns": "Design patterns and implementation guidelines"
    }
  },
  "entities": {
    "users": { 
      "entity_id": {
        "id": "STRING",
        "type": "user", 
        "name": "STRING",
        "description": "STRING (inline for unique content) OR description_ref: STRING (reference for shared content)",
        "dimensions": ["stakeholder"]
      }
    },
    "platforms": { 
      "entity_id": {
        "id": "STRING",
        "type": "platform",
        "name": "STRING", 
        "description_ref": "STRING",
        "dimensions": ["platform"]
      }
    },
    "screens": { 
      "entity_id": {
        "id": "STRING",
        "type": "screen",
        "name": "STRING",
        "description_ref": "STRING",
        "priority": "ENUM[P0,P1,P2]",
        "dimensions": ["experience"]
      }
    },
    "components": { 
      "entity_id": {
        "id": "STRING",
        "type": "component", 
        "name": "STRING",
        "description_ref": "STRING",
        "dimensions": ["component"]
      }
    },
    "features": { 
      "entity_id": {
        "id": "STRING",
        "type": "feature",
        "name": "STRING", 
        "current_version": "STRING",
        "dimensions": ["capability"],
        "evolution": {
          "v1": {
            "status": "ENUM[implemented,planned]",
            "description_ref": "STRING",
            "capabilities": "ARRAY<STRING>",
            "priority": "ENUM[P0,P1,P2]"
          },
          "v2": {
            "status": "ENUM[implemented,planned]", 
            "description_ref": "STRING",
            "capabilities": "ARRAY<STRING>",
            "priority": "ENUM[P0,P1,P2]",
            "roadmap_milestone": "STRING"
          }
        }
      }
    },
    "requirements": { 
      "entity_id": {
        "id": "STRING",
        "type": "requirement",
        "name": "STRING",
        "specification": "STRING",
        "criticality": "ENUM[critical,high,medium,low]",
        "dimensions": ["stakeholder"]
      }
    },
    "functionality": {
      "entity_id": {
        "id": "STRING",
        "type": "functionality",
        "name": "STRING",
        "description_ref": "STRING",
        "acceptance_criteria": {
          "performance": "ARRAY<STRING>",
          "functional": "ARRAY<STRING>",
          "reliability": "ARRAY<STRING>"
        },
        "dimensions": ["capability"]
      }
    },
    "ui_components": {
      "entity_id": {
        "id": "STRING",
        "type": "ui_component",
        "name": "STRING",
        "description_ref": "STRING",
        "dimensions": ["presentation"]
      }
    },
    "schema": {
      "example-model": {
        "type": "model",
        "name": "STRING",
        "description": "STRING",
        "attributes": {
          "id": "UUID",
          "name": "STRING",
          "status": "ENUM[active,inactive,pending]",
          "created-at": "TIMESTAMP",
          "metadata": "JSON"
        },
        "dimensions": ["data"]
      },
      "another-model": {
        "type": "model",
        "name": "STRING",
        "description": "STRING",
        "attributes": {
          "entity-id": "UUID",
          "type": "STRING",
          "properties": "OBJECT",
          "relationships": "ARRAY<STRING>"
        },
        "dimensions": ["data"]
      }
    }
  },
  "external_dependencies": {
    "external-service-id": {
      "id": "STRING",
      "type": "ENUM[library,service,api,database]",
      "name": "STRING", 
      "version": "STRING",
      "provider": "STRING",
      "source": "STRING",
      "critical": "BOOLEAN",
      "fallback_strategy": "STRING",
      "dimensions": ["implementation"]
    }
  },
  "project": {
    "roadmap": {
      "feature:example-feature": {
        "status": "ENUM[not_started,planned,in_progress,testing,completed,blocked,cancelled]",
        "priority": "ENUM[P0,P1,P2,P3]",
        "blockers": "ARRAY<STRING>",
        "dependencies": "ARRAY<entity_reference>",
        "completion_criteria": "ARRAY<STRING>"
      }
    },
    "milestones": {
      "milestone-id": {
        "target_date": "DATE",
        "required_features": "ARRAY<feature_reference>",
        "status": "ENUM[planned,on_track,at_risk,delayed,completed]",
        "risk_factors": "ARRAY<STRING>"
      }
    },
    "strategic": {
      "version-id": {
        "objective": "STRING",
        "priority": "ENUM[P0,P1,P2,P3]",
        "timeline": "STRING",
        "features": "ARRAY<STRING>",
        "built_on": "STRING"
      }
    },
    "risks": {
      "critical_validation_requirements": "ARRAY<STRING>",
      "high_risk_integration_constraints": "ARRAY<STRING>",
      "performance_requirements_constraints": "ARRAY<STRING>",
      "scalability_constraints": "ARRAY<STRING>"
    }
  },
  "graph": {
    "entity:id": {
      "depends_on": [
        "entity:child1",
        "entity:child2", 
        "feature:example-feature",
        "model:example-model",
        "requirement:example-requirement",
        "service:example-service",
        "ui_component:example-theme"
      ]
    }
  }
}
```

## Key Design Principles

- **Single Source of Truth**: All relationships stored ONLY in graph section, never in entities
- **Clean Entity Separation**: Entities contain only static metadata (id, type, name, description OR description_ref)
- **View-Agnostic Entities**: Each entity declares `dimensions` so alternate mental models reuse the same records
- **Smart Content References**: Use references ONLY for shared/versioned content, inline unique descriptions
- **Versioned Evolution**: Features evolve through versions (v1→v2) rather than duplicate entities
- **No Redundancy**: Eliminated capabilities/permissions/features arrays from entities
- **Pure Dependency Model**: Universal relationship semantic:
  - Single `depends_on` array per entity (no outbound/inbound nesting)
  - Everything is fundamentally a dependency relationship
  - 50% smaller JSON (eliminates bidirectional redundancy)
  - Simpler queries (flat array vs nested objects)

## Conceptual Separation

- **`entities` = WHAT** (domain objects and their identity)
  - What screens exist: "Fleet Dashboard", "Mission Control"
  - What features exist: "Real-Time Telemetry", "Predictive Maintenance"
  - What users exist: "Owner", "Operator", "Teleoperator"
  - What components exist: "Fleet Status Map", "Robot Controls"
  - Business domain concepts (stable, conceptual)

- **`references` = HOW** (implementation details and specifications)
  - How UI looks: colors, typography, spacing in `references.ui`
  - How systems connect: API endpoints, protocols in `references.technical_architecture`
  - How things are built: libraries, frameworks in `references.libraries`
  - How things are described: centralized content in `references.descriptions`
  - Technical implementation details (changeable, concrete)

- **`graph` = WHERE** (relationships and connections)
  - Connects the WHATs together through relationships
  - Maps business concepts to each other
  - Enables traversal and dependency analysis
  - View presets (`meta.views`) reorder these relationships for different mental models without duplicating data

This separation creates maintainable architecture where business analysts work with entities (WHAT), developers work with references (HOW), and the graph connects everything together (WHERE).

## Validation Features

- **Reference Integrity**: All entity references resolve correctly
- **Bidirectional Consistency**: Outbound/inbound relationships match
- **Content Library Coverage**: No orphaned content references  
- **Circular Dependency Detection**: Identifies problematic dependency cycles
- **Duplicity Detection**: Identifies duplicate entities, descriptions, and relationships
- **Redundancy Detection**: Ensures no relationship data exists in both entities and graph
- **Graph Query Testing**: Validates traversal operations work correctly
- **Schema Consistency**: Entity schema definitions align with graph relationships

## CLI Integration

Generated knowledge map enables commands like:
```bash
# Extract specific entities
jq '.entities.screens."fleet-dashboard"' knowledge-map.json
jq '.entities.schema."robot-fleet"' knowledge-map.json

# Query user dependencies (screens, features, requirements)
jq '.graph."user:owner".depends_on[]' knowledge-map.json

# Find who depends on web-platform (reverse lookup)
jq -r '.graph | to_entries[] | select(.value.depends_on[]? == "platform:web-platform") | .key' knowledge-map.json

# Find all dependencies of fleet dashboard
jq '.graph."screen:fleet-dashboard".depends_on[]' knowledge-map.json

# Find what depends on dark-theme UI component  
jq -r '.graph | to_entries[] | select(.value.depends_on[]? == "ui_component:dark-theme") | .key' knowledge-map.json

# Access technical architecture references
jq '.references.technical_architecture' knowledge-map.json
jq '.references.libraries.ui_framework' knowledge-map.json
jq '.references.ui.colors' knowledge-map.json

# Get entity descriptions from references
jq '.references.descriptions."fleet-dashboard-desc"' knowledge-map.json

# Get schema definitions with attributes
jq '.entities.schema."robot-fleet".attributes' knowledge-map.json

# Query versioned feature evolution
jq '.entities.features.analytics.evolution.v2.capabilities[]' knowledge-map.json

# List entities by type (computed on-demand)
jq '.entities.screens | keys[]' knowledge-map.json
jq '.entities.features | keys[]' knowledge-map.json
jq '.entities.ui_components | keys[]' knowledge-map.json
jq '.entities.functionality | keys[]' knowledge-map.json

# Find versioned features planned for V2
jq '.entities.features | to_entries[] | select(.value.evolution.v2.roadmap_milestone) | .key' knowledge-map.json

# Query functionality with acceptance criteria
jq '.entities.functionality."telemetry-streaming".acceptance_criteria' knowledge-map.json

# Trace dependency chains
./json-graph-query.sh deps feature:real-time-telemetry

# Impact analysis  
./json-graph-query.sh impact model:robot-fleet

# User access analysis
./json-graph-query.sh user user:owner
# Run the same traversal through an alternate view (update script to accept --view)
./json-graph-query.sh deps feature:analytics --view user_value
```

> NOTE: Add a ticket to extend `know/lib/query-graph.sh` and related tooling with a `--view` flag so these presets become first-class filters.

## Output Files

- `knowledge-map.json` - Main graph database file
- `.claude/scripts/json-graph-query.sh` - Local graph query tool (copied from ~/ai/scripts/)
- `knowledge-graph-validation.log` - Consistency check results

## Benefits

- **Graph Database Power**: Multi-hop traversal, pattern matching, dependency analysis, UI relationships
- **Single Source of Truth**: All relationships in graph section, zero redundancy
- **Centralized References**: Technical architecture, endpoints, libraries, protocols, and UI design system in one place
- **Versioned Evolution**: Features evolve through versions rather than duplicates
- **View Presets**: Multiple mental models share the same `depends_on` relationships via `meta.views`
- **Universal Tooling**: Works with any JSON parser, jq, IDEs  
- **Schema Definitions**: Typed model attributes for code generation and validation
- **Git Friendly**: Readable diffs, mergeable conflicts
- **CLI Integration**: Enable `./cli screen dashboard | claude` workflows
- **Zero Infrastructure**: No database setup, just JSON files
- **Clean Architecture**: Pure entity metadata + pure graph relationships + centralized references
- **Maximum Simplicity**: No views, no query caching, no pre-computation overhead

This approach achieves ~85% of graph database capabilities while maintaining the simplicity and universality of JSON with zero redundancy. The graph structure IS the query documentation - clean, minimal, and powerful.

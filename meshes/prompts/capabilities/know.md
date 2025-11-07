# Know Capability

You have access to the know CLI for managing two complementary knowledge graphs.

## Two Graphs

TX uses two knowledge graphs that cross-reference each other:

### Spec-Graph (Product Architecture)

**File**: `.ai/spec-graph.json`
**Purpose**: What needs to be built
**Access**: `tx tool know <command>` (default graph)
**Graph Created**: Know tool creates this file on first use if it doesn't exist
**Validation**: Know tool validates all operations against `.ai/product-dependency-rules.json`

**Entity Types**:
- `product` - The product being built
- `feature` - High-level features (e.g., "user authentication")
- `component` - UI/functional components (e.g., "LoginForm")
- `action` - User actions (e.g., "submit login")
- `user` - System personas (admin, customer, etc.)
- `objective` - User goals
- `requirement` - Functional/non-functional specifications
- `interface` - User interface screens/pages

**Entity Schema**: Entities only have `name` and `description` keys

**References**: All other details stored as references:
- `acceptance_criterion` - Success criteria
- `business_logic` - Workflows and rules
- `technical_architecture` - Infrastructure components
- `data-model` - Detailed schemas
- `code-module` - Links to code-graph modules

**Metadata**: Workflow info (status, priority, tags) stored in metadata section of graph file

### Code-Graph (Implementation Architecture)

**File**: `.ai/code-graph.json`
**Purpose**: How it's implemented
**Access**: `tx tool know -g .ai/code-graph.json <command>` (full path required)
**Graph Created**: Know tool creates this file on first use if it doesn't exist
**Validation**: Know tool validates all operations against `.ai/code-dependency-rules.json`

**Entity Types**:
- `module` - Source files (e.g., `module:auth-service`)
- `package` - Code organization (e.g., `package:commands`)
- `layer` - Architectural layers (primitives, infrastructure, services, commands)
- `namespace` - Scopes that group related symbols
- `interface` - Contracts/protocols/traits
- `class` - Classes/structs/objects
- `function` - Functions/methods/procedures

**Entity Schema**: Entities only have `name` and `description` keys

**References**: All implementation details stored as references:
- `source-file` - File paths, language, exports, imports, LOC
- `external-dep` - npm/pip/cargo packages with versions
- `product-component` - Links to spec-graph components
- `execution-trace` - Step-by-step execution flow
- `call-graph` - Function call relationships
- `side-effect` - File I/O, state mutations, processes
- `error-path` - Exception handling strategies
- `api-surface` - Public API exports
- `test-suite` - Test coverage info
- `code-metric` - Complexity, maintainability metrics

**Metadata**: Workflow info (status, tags) stored in metadata section of graph file

## Graph File Structure

Both graphs use the same JSON structure with four main sections:

```json
{
  "meta": {
    "project": {
      "name": "Project Name",
      "description": "Project description"
    },
    "phases": []
  },
  "entities": {
    "features": {
      "feature-id": {
        "name": "Feature Name",
        "description": "Feature description"
      }
    },
    "actions": {},
    "components": {}
  },
  "references": {
    "acceptance_criterion": {
      "feature:feature-id": {
        "criteria": ["Must do X", "Must handle Y"]
      }
    },
    "code-module": {
      "component:login-form": {
        "module": "module:login-form",
        "graph_path": ".ai/code-graph.json"
      }
    }
  },
  "graph": {
    "feature:feature-id": {
      "depends_on": ["action:action-id", "component:component-id"]
    },
    "action:action-id": {
      "depends_on": ["component:component-id"]
    }
  }
}
```

**Section Breakdown:**

1. **`meta`** - Project metadata, phases, global settings
2. **`entities`** - Entity definitions (only `name` and `description`)
3. **`references`** - Detailed information and cross-graph links
4. **`graph`** - Dependency relationships (`depends_on` edges)

**Important**: Entities are referenced in `graph` section using `type:id` format (e.g., `feature:user-auth`, `module:auth-service`)

## Commands

### Query Entities

```bash
# Spec-graph (default)
tx tool know query '{"type":"feature"}'
tx tool know query '{"status":"not-started"}'
tx tool know query '{"type":"component","priority":"P0"}'

# Code-graph (full path required)
tx tool know -g .ai/code-graph.json query '{"type":"module"}'
tx tool know -g .ai/code-graph.json query '{"status":"complete"}'
```

### Add Entities

```bash
# Add to spec-graph (entities only have name and description)
tx tool know add feature user-auth '{"name":"User Auth","description":"User authentication system"}'
tx tool know add component login-form '{"name":"LoginForm","description":"Login form UI component"}'

# Add to code-graph (full path required)
tx tool know -g .ai/code-graph.json add module auth-service '{"name":"Auth Service","description":"Handles user authentication"}'
tx tool know -g .ai/code-graph.json add package services '{"name":"Services","description":"Service layer modules"}'
```

### Add Dependencies

```bash
# Spec-graph dependencies
tx tool know add-dep feature:user-auth component:login-form
tx tool know add-dep component:login-form action:submit-login

# Code-graph dependencies (full path required)
tx tool know -g .ai/code-graph.json add-dep module:login-form module:auth-service
tx tool know -g .ai/code-graph.json add-dep module:auth-service external-dep:bcrypt
```

### Query Dependencies

```bash
# What does this depend on?
tx tool know deps feature:user-auth
tx tool know -g .ai/code-graph.json deps module:auth-service

# What depends on this? (reverse)
tx tool know dependents component:button
tx tool know -g .ai/code-graph.json dependents module:logger
```

### Build Order (Topological Sort)

```bash
# Get implementation order from spec-graph
tx tool know build-order

# Returns components in dependency order:
# 1. action:submit-login (no deps)
# 2. component:login-form (depends on action)
# 3. feature:user-auth (depends on component)
```

### Update Entities

```bash
# Update entity (name/description only)
tx tool know update component:login-form '{"description":"Updated login form with OAuth support"}'
tx tool know update feature:user-auth '{"name":"User Authentication"}'

# Update code-graph entities (full path required)
tx tool know -g .ai/code-graph.json update module:auth-service '{"description":"Updated auth service with OAuth2"}'
```

### Validation & Health

```bash
# Check graph health
tx tool know health  # spec-graph (default)
tx tool know -g .ai/code-graph.json health  # code-graph (full path required)

# Detect circular dependencies
tx tool know cycles

# Check entity completeness
tx tool know completeness feature:user-auth
```

### Statistics

```bash
# Spec-graph stats
tx tool know stats
# Output: products: 1, features: 5, components: 12, actions: 8

# Code-graph stats (full path required)
tx tool know -g .ai/code-graph.json stats
# Output: modules: 45, packages: 8, layers: 4
```

### List Entities

```bash
# List all entities
tx tool know list

# List by type
tx tool know list-type features
tx tool know list-type components
tx tool know -g .ai/code-graph.json list-type module
```

## Cross-Graph Queries

### Link Product to Code

When you create a component in spec-graph, link it to the implementing module in code-graph:

```bash
# 1. Add component to spec-graph
tx tool know add component login-form '{"name":"LoginForm","technology":"React"}'

# 2. Add module to code-graph (full path required)
tx tool know -g .ai/code-graph.json add module login-form '{"name":"LoginForm","file":"src/components/LoginForm.jsx"}'

# 3. Link them via references
# In spec-graph, add code-module reference:
jq '.references["code-module"]["component:login-form"] = {"module":"module:login-form","graph_path":".ai/code-graph.json"}' .ai/spec-graph.json

# In code-graph, add product-component reference:
jq '.references["product-component"]["module:login-form"] = {"component":"component:login-form","graph_path":".ai/spec-graph.json"}' .ai/code-graph.json
```

### Query Cross-Graph Links

```bash
# Find code module for product component
jq '.references["code-module"]["component:login-form"]' .ai/spec-graph.json
# Returns: {"module":"module:login-form","graph_path":".ai/code-graph.json"}

# Find product component for code module
jq '.references["product-component"]["module:login-form"]' .ai/code-graph.json
# Returns: {"component":"component:login-form","graph_path":".ai/spec-graph.json"}
```

### Workflow: Using Both Graphs Together

**Phase 1: Product Definition** (spec-graph)
```bash
# Add product and features
tx tool know add product taskflow '{"name":"TaskFlow"}'
tx tool know add feature time-tracking '{"name":"Time Tracking","priority":"P0"}'
```

**Phase 2: Architecture** (spec-graph)
```bash
# Add components
tx tool know add component timer-widget '{"name":"TimerWidget"}'
tx tool know add-dep feature:time-tracking component:timer-widget
```

**Phase 3: Implementation Planning** (both graphs)
```bash
# Check build order from spec-graph
tx tool know build-order

# Create modules in code-graph (full path required)
tx tool know -g .ai/code-graph.json add module timer-component '{"file":"src/components/Timer.jsx"}'
tx tool know -g .ai/code-graph.json add module timer-service '{"file":"lib/services/timer.js"}'

# Link product → code
# (Add cross-references as shown above)
```

**Phase 4: Implementation** (code-graph)
```bash
# Add dependencies (full path required)
tx tool know -g .ai/code-graph.json add-dep module:timer-component module:timer-service

# Track status (full path required)
tx tool know -g .ai/code-graph.json update module:timer-service '{"status":"complete"}'
```

**Phase 5: Validation** (both graphs)
```bash
# Check spec-graph health
tx tool know health

# Check code-graph health (full path required)
tx tool know -g .ai/code-graph.json health

# Verify cross-references
jq '.references["code-module"]' .ai/spec-graph.json
jq '.references["product-component"]' .ai/code-graph.json
```

## Best Practices

### Spec-Graph
- **Start with features** - Break down product into features first
- **Add components next** - Design components that implement features
- **Use build-order** - Let topological sort guide implementation
- **Update status** - Track progress (not-started → in-progress → complete)
- **Set priorities** - P0 (must-have), P1 (should-have), P2 (nice-to-have)

### Code-Graph
- **Mirror structure** - Modules should map to components
- **Document behavior** - Use execution-trace, side-effect, error-path references for critical modules
- **Track dependencies** - Both internal (module → module) and external (module → npm package)
- **Layer awareness** - Respect architectural layers (primitives → infrastructure → services → commands)

### Cross-Graph
- **Always link** - Every component should reference its implementing module
- **Query both** - Use both graphs for complete picture (WHAT + HOW)
- **Validate frequently** - Run health checks on both graphs after major changes
- **Keep in sync** - When component status changes, update corresponding module

## Examples

### Example 1: Adding a Feature End-to-End

```bash
# 1. Spec-graph: Add feature
tx tool know add feature user-auth '{"name":"User Authentication","priority":"P0","status":"not-started"}'

# 2. Spec-graph: Add components
tx tool know add component login-form '{"name":"LoginForm","technology":"React","status":"not-started"}'
tx tool know add component auth-button '{"name":"AuthButton","technology":"React","status":"not-started"}'

# 3. Spec-graph: Add dependencies
tx tool know add-dep feature:user-auth component:login-form
tx tool know add-dep feature:user-auth component:auth-button

# 4. Code-graph: Add modules (full path required)
tx tool know -g .ai/code-graph.json add module login-form '{"name":"LoginForm","file":"src/components/LoginForm.jsx","status":"not-started"}'
tx tool know -g .ai/code-graph.json add module auth-service '{"name":"AuthService","file":"lib/auth/service.js","status":"not-started"}'

# 5. Code-graph: Add dependencies (full path required)
tx tool know -g .ai/code-graph.json add-dep module:login-form module:auth-service
tx tool know -g .ai/code-graph.json add-dep module:auth-service external-dep:bcrypt

# 6. Cross-link
# (Add references as shown in Cross-Graph Queries section)

# 7. Get build order
tx tool know build-order
# Returns: auth-button, login-form, user-auth (dependency order)
```

### Example 2: Tracking Implementation Progress

```bash
# Start implementation (full path required)
tx tool know -g .ai/code-graph.json update module:auth-service '{"status":"in-progress"}'

# Complete module (full path required)
tx tool know -g .ai/code-graph.json update module:auth-service '{"status":"complete"}'

# Update spec-graph component
tx tool know update component:login-form '{"status":"complete"}'

# Check feature status
tx tool know deps feature:user-auth
# See which components are complete/in-progress

# If all components complete, update feature
tx tool know update feature:user-auth '{"status":"complete"}'
```

### Example 3: Validating Architecture

```bash
# Run health checks
tx tool know health
tx tool know -g .ai/code-graph.json health

# Check for circular dependencies
tx tool know cycles
tx tool know -g .ai/code-graph.json cycles

# Validate cross-references
jq '.references["code-module"] | length' .ai/spec-graph.json
# Should match number of components

jq '.references["product-component"] | length' .ai/code-graph.json
# Should match number of modules linked to components
```

## Quick Reference

| Task | Spec-Graph Command | Code-Graph Command |
|------|-------------------|-------------------|
| Query | `tx tool know query '{...}'` | `tx tool know -g .ai/code-graph.json query '{...}'` |
| Add | `tx tool know add feature id '{...}'` | `tx tool know -g .ai/code-graph.json add module id '{...}'` |
| Deps | `tx tool know add-dep from to` | `tx tool know -g .ai/code-graph.json add-dep from to` |
| Update | `tx tool know update entity '{...}'` | `tx tool know -g .ai/code-graph.json update entity '{...}'` |
| List | `tx tool know list-type features` | `tx tool know -g .ai/code-graph.json list-type module` |
| Order | `tx tool know build-order` | N/A (use spec-graph) |
| Health | `tx tool know health` | `tx tool know -g .ai/code-graph.json health` |
| Stats | `tx tool know stats` | `tx tool know -g .ai/code-graph.json stats` |

## Important: Entity Schema Rules

**Entities are simple**:
- Only have `name` and `description` keys
- Example: `{"name":"LoginForm","description":"Login form component"}`

**References for detailed info**:
- All other details stored as references (not in entities)
- Examples: acceptance_criterion, business_logic, technical_architecture, data-model
- References have flexible schemas tailored to specific needs

**Metadata section**:
- Workflow info (status, priority, tags) stored in metadata section of graph file
- Not added via know commands (yet)
- Queried via graph file structure

## IMPORTANT: Know Tool Alpha Software

**Know is alpha software. This means:**
- ✅ **Expect bugs** - Surface any confusing behavior immediately to the user
- ✅ **Know creates graph files** - On first use, know creates `.ai/spec-graph.json` or `.ai/code-graph.json` if they don't exist
- ✅ **Know validates operations** - All add/update/add-dep operations validated against `.ai/product-dependency-rules.json` and `.ai/code-dependency-rules.json`
- ✅ **Full paths required** - Always use `-g .ai/spec-graph.json` or `-g .ai/code-graph.json` (not `-g spec`)
- ✅ **Entity schema enforced** - Entities can only have name/description
- ⚠️ **Report confusing CLI output** - If validation errors are cryptic, ask user for clarification
- ⚠️ **Report unexpected behavior** - If know doesn't create files, doesn't validate, or behaves unexpectedly

**Common issues to watch for:**
- Validation errors that aren't clear about what's wrong
- Graph files not being created on first use
- Dependency rules not being enforced
- Cross-graph references breaking
- Trying to add extra fields directly to entities (only name/description allowed)

---
name: know-tool
description: Master the know CLI tool for managing specification graphs. Use when working with spec-graph.json, understanding graph structure, querying entities/references/meta, managing dependencies, or learning graph architecture. Teaches dependency rules, entity types, and graph operations.
---

# Know Tool - Specification Graph Mastery

## What is the Specification Graph?

The specification graph (`.ai/know/spec-graph.json`) is a directed acyclic graph (DAG) representing software systems as interconnected nodes with explicit dependencies. Everything is a node, relationships are explicit, nothing is implied.

**Three node types:**

1. **Entities** - Structural nodes that participate in dependencies (user, feature, component, etc.)
2. **References** - Terminal nodes with implementation details (business_logic, data-models, etc.)
3. **Meta** - Project metadata (phases, assumptions, decisions, qa_sessions)

**Key principle:** The graph IS the source of truth. All relationships are explicit.

## Phases in meta.phases

The `meta.phases` section tracks feature lifecycle and scheduling:

**Phase Types:**
- `I, II, III` - Scheduling phases (immediate, next, future)
- `pending` - Not yet scheduled
- `done` - Completed and archived

**Phase Status:**
- `incomplete` - Feature added but not started
- `in-progress` - Active development
- `review-ready` - Implementation complete, awaiting review
- `complete` - Finished (in done phase)

**Phase Lifecycle:**
```
/know:add    → pending phase, status: incomplete
/know:build  → status: in-progress → review-ready
/know:done   → done phase, status: complete
```

## Core Mental Model

### Single Product Chain

```
Project → User → Objective → Feature → Action → Component → Operation
```

Flows from who uses it, through what they want, to how the system delivers it. `requirement` and `interface` are reference types, not entities.

### Dependency Rules

Dependencies are strict and unidirectional:
- Only entities participate in dependencies
- References are terminal nodes (no dependencies)
- Graph must remain a DAG (no cycles)

## Command Groups

Know CLI uses a flat structure with auto-detection:

| Command | Purpose |
|---------|---------|
| `know get <type:key>` | Get entity or reference (auto-detects) |
| `know list [--type TYPE]` | List entities or references (auto-detects) |
| `know search <pattern>` | Search all text content (supports regex) |
| `know add <type> <key> [key2 ...]` | Add one or more entities/references (auto-detects) |
| `know link <from> <to> [to2 ...]` | Add one or more dependencies |
| `know unlink <from> <to> [to2 ...]` | Remove one or more dependencies |
| `know nodes` | Node operations: deprecate, merge, rename, delete, cut, clone, update |
| `know meta` | Get, set, and delete meta sections (project, phases, decisions) |
| `know graph` | Traverse, uses, used-by, connect, clean, suggest, diff, migrate, coverage, cross connect, cross coverage |
| `know graph coverage` | Show % of spec entities reachable from root users |
| `know graph cross connect [feature]` | Auto-connect spec features/components to code via token matching |
| `know graph cross coverage` | Show spec↔code link coverage (% with code-link refs) |
| `know check` | Validate, health, stats, gaps, orphans, cycles, completeness |
| `know gen` | Specs, feature-specs, docs, traces, rules, codemap, code-graph, sitemap |
| `know feature` | Lifecycle: status, connect, review, done, impact, validate, contracts, coverage |
| `know req` | Requirements: add, list, status, block, complete |
| `know op` | Op-level progress: start, done, next, reset, status |
| `know phases` | Phase management: list, add, move, status, remove |
| `know init` | Initialize know workflow (installs graph protection hooks) |

## Using know gen rules Commands

These commands expose the dependency structure for LLMs:

```bash
# Understand any type
know gen rules describe feature
know gen rules describe business_logic
know gen rules describe phases

# See dependency rules
know gen rules before component    # What can depend on component?
know gen rules after feature        # What can feature depend on?

# Visualize the structure
know gen rules graph                # See the full dependency map
```

**Always start with `know gen rules` commands before manipulating the graph.**

## Essential Commands

### Discovery & Exploration
```bash
know list                           # List all entities
know list --type feature            # List entities of type (auto-detects entity vs reference)
know list --type business_logic     # List references of type (auto-detects)
know get feature:real-time-telemetry   # Get entity (auto-detects)
know get business_logic:login          # Get reference (auto-detects)

# Search
know search "authentication"                        # Plain text search (case-insensitive)
know search "auth.*login" --regex                   # Regex search
know search "API" --section references              # Search only references
know search "user" --field description              # Search specific field
know search "Feature.*" -rc                         # Regex, case-sensitive

# Dependencies
know graph uses feature:real-time-telemetry          # What does this entity use? (dependencies)
know graph used-by component:websocket-manager       # What uses this entity? (dependents)
know graph up feature:x                              # Alias for 'uses' (go up dependency chain)
know graph down component:y                          # Alias for 'used-by' (go down chain)

# Cross-Graph Navigation (spec ↔ code)
know graph traverse feature:auth --direction impl    # Show code implementations
know graph traverse module:auth --direction spec     # Show spec feature
know graph traverse feature:profile                  # Auto-detects direction

# Statistics
know graph check stats                    # Graph statistics (entity counts, dependencies)
know graph check completeness feature:x   # Completeness score for an entity
```

### Modification
```bash
know add feature new-feature '{"name":"...", "description":"..."}'       # Add single entity
know add feature feat-a feat-b feat-c -f data.json                      # Add multiple (shared data from file)
know add documentation new-doc '{"title":"...", "url":"..."}'            # Add reference (auto-detects)
know meta set project key '{"value":"..."}'                              # Set meta value
know meta get project                                                    # Get meta section
know meta delete phases I                                                # Delete meta key (prompts)
know meta delete requirements auth-login -y                              # Delete meta key (skip prompt)
know link feature:auth action:login                                      # Add single dependency
know link feature:auth action:login action:logout component:session      # Add multiple at once
know unlink feature:auth action:login action:logout                      # Remove multiple at once
```

### Validation
```bash
know graph check validate                 # Must run after changes (includes fix commands in errors)
know graph check health                   # Comprehensive check
know graph check cycles                   # Find circular dependencies
```

### Requirements (`know req`)
```bash
know req list feature:auth              # List requirements with status
know req add feature:auth req-name '{"description":"..."}' # Add requirement
know req status feature:auth req-name in-progress          # Update status
know req block feature:auth req-name --by "reason"         # Mark blocked
know req complete feature:auth req-name                    # Mark complete
```

**Status values:** pending, in-progress, blocked, complete, verified

### Op-Level Progress (`know op`)
```bash
know op status feature:auth             # Show op status for a feature
know op next feature:auth               # Print the next op number
know op start feature:auth              # Mark current op as in-progress
know op done feature:auth               # Mark current op as complete with commits
know op reset feature:auth              # Reset an op to pending
```

### Feature Lifecycle (`know feature`)
```bash
know graph cross connect feature:auth            # Create bidirectional spec ↔ code linkage
know feature connect auth module:x module:y      # Link feature to multiple code entities at once
know feature review feature:auth        # Review for completion: validate graph, check coverage
know feature done feature:auth          # Complete: tag commits, update phase, archive
know feature impact entity:x            # Show features depending on an entity or file
know feature validate feature:auth      # Check if codebase changes warrant revisiting
know feature contract feature:auth      # Display contract info
know feature validate-contracts         # Validate for drift between contracts
know feature coverage feature           # Aggregate coverage from feature level
know feature coverage feature --detail  # Per-component breakdown
```

### Node Operations (`know nodes`)
```bash
# Deprecation
know nodes deprecate entity:id --reason "..." [--replacement entity:new]
know nodes undeprecate entity:id
know nodes deprecated             # List all deprecated entities
know nodes deprecated --overdue   # Only entities past removal date

# Modification
know nodes update entity:id '{"name":"New Name"}'  # Update properties
know nodes rename entity:id new-key                # Rename entity key (shows confirmation)
know nodes rename entity:id new-key -y             # Skip confirmation
know nodes clone entity:id new-key                 # Clone with all dependencies
know nodes clone entity:id new-key --no-upstream  # Clone without incoming deps

# Removal (works with entities AND references)
know nodes delete feature:old              # Remove entity, clean up dependencies
know nodes delete feature:old action:bar   # Remove multiple at once
know nodes delete data-model:old-schema    # Remove reference, clean up dependencies
know nodes delete component:temp -y        # Skip confirmation
know nodes cut entity:id                   # Remove node only, leave deps orphaned
know nodes cut reference:id -y             # Skip confirmation

# Merging
know nodes merge from:entity into:entity      # Merge entities, transfer deps (shows confirmation)
know nodes merge from:entity into:entity -y   # Skip confirmation
know nodes merge from:entity into:entity --keep  # Keep source after merge

# Graph Operations
know link feature:x action:y action:z    # Add one or more dependencies
know unlink feature:x action:y action:z  # Remove one or more (shows confirmation)
know unlink feature:x action:y -y        # Skip confirmation
```

**Important:** All destructive operations (`delete`, `cut`, `rename`, `merge`, `unlink`) now show detailed confirmation prompts by default. Use `-y` or `--yes` to skip confirmation in scripts.

**Note:** Validation errors include fix commands. For example:
```
✗ Invalid dependency: feature:x → component:y. feature can only depend on: action
  Fix: know unlink feature:x component:y
```

### Analysis
```bash
know graph check gap-analysis feature:x  # Find missing dependencies
know graph check gap-missing             # List missing connections in chains
know graph check gap-summary             # Overall implementation status
know graph check orphans                 # Find unused references
know graph check usage                   # Reference usage statistics
know graph suggest                 # Suggest connections for orphaned references
know graph clean                   # Clean up unused references (dry run)
know graph clean --remove --execute # Actually remove unused references
know graph build-order             # Topological sort
know graph connect entity:x        # Suggest valid connections for an entity
```

### Generation (`know gen`)
```bash
know gen spec entity:x              # Generate spec for a single entity
know gen feature-spec feature:x     # Generate detailed feature specification
know gen docs feature:x             # Generate .md files from graph for a feature
know gen trace entity:x             # Trace entity across product-code boundary
know gen trace-matrix               # Show requirement traceability matrix
know gen trace-matrix -t component  # Trace specific entity type
know gen sitemap                    # Generate sitemap of all interfaces
know gen codemap                    # Generate code structure map
know gen code-graph                 # Generate code-graph from codemap
```

### Migration (`know graph migrate`)
```bash
know graph migrate                  # Check graph structure against current rules
know graph migrate --format json    # Structured output for LLM consumption
know graph migrate-rules /path/to/new-rules.json  # Analyze impact of rules change
know graph migrate-rules /path/to/new-rules.json --format json --verbose
```

### Advanced
```bash
know graph diff graph1.json graph2.json  # Compare two graph files
know init                                # Initialize know workflow in a project
```

### Initialization & Protection

**`know init`** sets up the complete know workflow:

```bash
know init                    # Run in project root
know init --project-dir /path/to/project
```

**What it installs:**
1. Slash commands → `.claude/commands/know/`
2. know-tool skill → `.claude/skills/know-tool/`
3. Agents → `.claude/agents/`
4. Directory structure → `.ai/know/`
5. Project template → `.ai/know/project.md`
6. **Graph protection hook** → `.claude/hooks/protect-graph-files.sh`

**Graph Protection Hook:**

The hook automatically blocks direct Read/Edit/Write access to `*-graph.json` files, enforcing use of the `know` CLI:

```
❌ Direct Edit access to graph files is not allowed

Graph file: .ai/know/spec-graph.json

⚠️  Use the know CLI instead:
   • Read: know get <entity-id>
   • List: know list
   • Edit: know add <type> <key> <data>
   • Link: know link <from> <to>
   • Validate: know graph check validate
```

**Why this matters:** Direct file editing can corrupt the graph structure. The hook ensures all modifications go through validated CLI commands.

**Configuration:** The hook is installed in `.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Read|Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-graph-files.sh"
      }]
    }]
  }
}
```

## Reference Files

For detailed information, read these reference files:

- **[creating.md](references/creating.md)** - Guide to creating entities and references
- **[generating.md](references/generating.md)** - Specification generation patterns
- **[validating.md](references/validating.md)** - Graph validation and health checks
- **[qa-steps.md](references/qa-steps.md)** - QA testing patterns

## Quick Workflow Pattern

When adding a new feature:

```bash
# 1. Understand the type
know gen rules describe feature

# 2. Add the entity
know add feature new-feature '{"name":"...", "description":"..."}'

# 3. Check what it can depend on
know gen rules after feature

# 4. Connect dependencies
know link feature:new-feature action:trigger-action

# 5. Validate
know graph check validate
know graph uses feature:new-feature --recursive
```

## Phase Management

**Phase** = Roman numerals (I, II, III) - WHEN to do this feature (planning waves)
**Status** = in-progress, complete, planned - current state of the work

Phase is the plan, status is the territory. A feature can be `phase: III` (planned for wave 3) but `status: in-progress` (started early).

```bash
know phases                          # Alias for phases list
know phases list                     # Show all features organized by phase
know phases add <phase> <entity>     # Add feature to phase (e.g., know phases add I feature:auth)
know phases move <entity> <phase>    # Move feature to different phase
know phases status <entity> <status> # Update status (planned, in-progress, complete)
know phases remove <entity>          # Remove entity from all phases
```

**Output includes:**
- Phase metadata (shortname, name, description) from `meta.phases_metadata`
- Features within each phase
- Requirement completion counts (from `meta.requirements`)
- Status icons (✅ complete, 🔄 in-progress, 📋 planned)
- Summary totals

**Example output:**
```
Phase I (Foundation)
  🔄 feature:auth (3/5) - Authentication system

Phase II (Features)
  📋 feature:api-gateway (0/4) - API routing

Phase III (Polish)
  📋 feature:dark-mode (--) - No requirements yet
```

**Note:** "--" indicates no requirements exist yet for that feature.

## Feature Status Tracking

**Virtual flags** computed from graph state (not stored, derived):

```bash
know feature status feature:auth        # Show all three status flags
know phases list                        # Shows status icons inline
```

### Status Flags

1. **📋 Planned** - Feature exists in `meta.phases` (any phase)
   - Set by: `/know:add` or `/know:plan` adding to phases
   - Computed: Check if feature_id in any phase

2. **✅ Implemented** - Code-graph links exist for this feature
   - Set by: `/know:build` creating bidirectional spec↔code links
   - Computed: Check for `code-link` references pointing to this feature
   - Auto-detected via graph traversal
   - **Deprecated reference types:** `graph-link`, `implementation`, `product-component` are deprecated. Use `code-link` instead.

3. **✅ Reviewed** - Git commit with `[feature:id]` merged to main
   - Set by: Merging to main with feature tag in commit message
   - Computed: `git log --grep "\[feature:auth\]" main`
   - Pattern: `feat: implement auth [feature:auth]` in commit message

### Workflow Integration

```bash
/know:add     → meta.phases[pending][feature:x]   → 📋 planned
/know:build   → creates code-links                → ✅ implemented
git merge     → [feature:x] in commit msg         → ✅ reviewed
/know:done    → removes from phases, archives     → done
```

### Example Output

```
$ know feature status feature:auth

Feature Status: feature:auth

✅ Planned: Yes
   Phase: I
   Status: in-progress

✅ Implemented: Yes
   Modules: module:auth-handler, module:session-store

✅ Reviewed: Yes
   Commit: abc123f
   Date: 2026-02-13

✓ Feature is fully complete!
```

**Important:** Always include `[feature:name]` in merge commit messages to enable automatic reviewed status detection.

## Requirements vs Todo.md

**Requirements replace todo.md** for progress tracking:
- Requirements are stored in `meta.requirements`
- Each feature links to requirement entities via depends_on
- Manage with `know req` commands (add, list, status, block, complete)
- Query all: `know req list feature:x` or `know meta get requirements`

## Implementation Patterns

### Discover Reference Types On Demand
```bash
know gen rules describe references      # List all reference types with descriptions
know gen rules describe <type>          # Deep dive on any type (entity or reference)
know gen rules after <entity-type>      # What can this entity depend on?
know gen rules before <entity-type>     # What can depend on this entity?
```

Run these before adding references. The rules file is the canonical source for what types exist and what they mean.

### Cross-Graph Reference Type: `code-link`

`code-link` is the current reference type for linking spec and code graphs:

| Graph | Schema |
|-------|--------|
| spec-graph | `{ modules, classes, packages, status }` |
| code-graph | `{ feature, component, status }` |

**Usage:** Cross-graph link between spec entities (feature/component) and code entities (module/class).

**Deprecated:** `graph-link`, `implementation`, and `product-component` are deprecated cross-graph reference types. Use `code-link` instead.

### Permissions (Access Control)
The `permission` reference type links users to features for access control:

```json
"references": {
  "permission": {
    "admin-full-access": "*",
    "editor": ["feature:user-management", "feature:content-editor"],
    "viewer": ["feature:dashboard", "feature:reports"],
    "trusted-user": ["*", "!feature:admin-panel", "!feature:billing"]
  }
}
```

Users depend on permissions to define what they can access:
```json
"graph": {
  "user:admin": {"depends_on": ["permission:admin-full-access"]},
  "user:trusted": {"depends_on": ["permission:trusted-user"]}
}
```

**Permission values:**
- `"*"` - All features
- `["feature:x", "feature:y"]` - Specific features only
- `["*", "!feature:x"]` - All features except those negated with `!`

### External Artifact IDs
When a reference has a rendering in an external tool (Figma, Pencil, Storybook), store the external ID on the reference. This creates spec-to-design traceability.
- `figma_id` — Figma node or frame ID
- `pen_file` — Pencil `.pen` file path
- `storybook_id` — Storybook story identifier
- `external_url` — Generic link to external artifact

Applies to any reference type with an external rendering, not just interfaces.

### Core Patterns
1. **Screen → interface reference** with route, identifiers, and external design ID when a rendering exists
2. **Data-bearing feature → data-model reference.** Features describe behavior; data-models describe shape
3. **Multi-screen journey → sequence reference.** One per journey, not per screen
4. **Spec change → verify design. Design change → verify spec.** Never update one in isolation
5. **Requirements describe what.** Decompose how into typed references (data-model, business_logic, sequence, api_contract)
6. **Verify connectivity after every addition.** `know graph uses` + `know graph used-by` + `know graph check orphans`
7. **Keep implementation details out of requirements.** That detail belongs in design artifact references
8. **Extract shared references.** Do not duplicate field definitions — one reference, multiple links

## Critical Rules for LLMs

1. **NEVER directly read/edit graph files** - Always use `know` CLI commands (enforced by hooks)
2. **Always validate after modifications** - Run `know graph check validate`
3. **Respect entity vs reference distinction** - Entities participate in dependencies, references don't
4. **Follow dependency rules** - Use `know gen rules` to check before adding dependencies
5. **Maintain DAG properties** - No cycles allowed, check with `know graph check cycles`
6. **Use full paths** - Always use `type:key` format (e.g., `feature:real-time-telemetry`)
7. **Never add dependencies to entity objects** - Only in the `graph` section
8. **Check completeness** - Use `know graph check gap-analysis` to ensure full dependency chains
9. **Use search for discovery** - `know search <pattern>` is faster than reading the entire graph
10. **Confirm destructive operations** - Use `-y` flag to skip confirmation in automated scripts
11. **Run write operations sequentially** - The graph file is not concurrency-safe. Running `know unlink`, `know add`, `know link`, or any other write command in parallel (e.g., with `&` in bash) causes race conditions where the last writer overwrites earlier changes. Always chain write commands with `&&` or run them in a single sequential script.

## Installation Note

If `know` command is not found, run `python3 know/know.py` from the project root. See project INSTALL.md for setup.

---

**Remember:** The graph is dependency-driven. Use `know gen rules` to understand structure before making changes. Always validate after modifications.

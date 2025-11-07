# Know Tool - Brain's Guide

**Note**: The know capability is injected into your prompt. This reference covers Brain-specific usage patterns and workflows.

## Brain as Knowledge Layer

**Important**: You serve as the **knowledge layer** for other meshes that need product/architecture information.

**Meshes with `brain: true` config:**
- These meshes query YOU instead of directly accessing graphs
- They send `type: ask` messages requesting product/architecture data
- You run `tx tool know` commands and send back `type: ask-response` with results

**Example**: UI-ensemble coordinator asks:
```markdown
---
to: brain/brain
from: ui-ensemble/coordinator
type: ask
---

Please query spec-graph for all features and their priorities.
```

**You respond:**
```markdown
---
to: ui-ensemble/coordinator
from: brain/brain
type: ask-response
---

Found 5 features:
- feature:auth (P0) - User authentication
- feature:dashboard (P0) - Main dashboard
- feature:reports (P1) - Reporting system
...
```

**Why this pattern?**
- Centralizes graph access through brain
- Brain can enrich data with context from artifacts
- Other meshes don't need know capability injection
- Cleaner separation of concerns

## Your Relationship with Know

**Know handles structured technical architecture** (the graphs):
- Product features, components, dependencies (spec-graph)
- Code modules, layers, implementation details (code-graph)

**Your artifacts handle experiential knowledge** (the learnings):
- `patterns.json` - What worked/failed and why
- `overview.md` - Project goals, state, progress
- `history.md` - Success patterns and approaches
- `not-done.md` - Incomplete work tracking

**Boundary**: Know tells you WHAT exists and HOW it's structured. You tell agents WHY decisions were made and WHAT patterns to apply.

## Hierarchical Relationships

Understanding the flow helps you formulate better plans:

**Product Graph (Spec)**:
```
users → objectives → features → actions → components
```

**Code Graph**:
```
layers → packages → modules → external-deps
```

When planning, respect these hierarchies - features depend on components, modules depend on other modules.

## Brain-Specific Workflows

### 1. Initial Project Assessment

When you first analyze a codebase or need to understand current state:

```bash
# Product architecture health
tx tool know health
tx tool know stats
tx tool know list-type features

# Code architecture health
tx tool know -g .ai/code-graph.json health
tx tool know -g .ai/code-graph.json stats
tx tool know -g .ai/code-graph.json list-type module

# Cross-references validation
jq '.references["code-module"]' .ai/spec-graph.json
jq '.references["product-component"]' .ai/code-graph.json
```

**Record findings** in `overview.md` and `not-done.md`.

### 2. Formulating Development Plans

When agents ask you to create implementation plans:

**Step 1**: Query existing architecture
```bash
# What exists?
tx tool know list-type features
tx tool know get feature:target-feature

# What are the dependencies?
tx tool know deps feature:target-feature
tx tool know dependents component:shared-component
```

**Step 2**: Check implementation order
```bash
# Get topological sort
tx tool know build-order
```

**Step 3**: Analyze code structure
```bash
# What modules exist?
tx tool know -g .ai/code-graph.json list-type module

# What depends on what?
tx tool know -g .ai/code-graph.json deps module:target
tx tool know -g .ai/code-graph.json dependents module:shared
```

**Step 4**: Combine with your experiential knowledge
- Check `patterns.json` for proven approaches
- Reference `history.md` for similar past work
- Consult `not-done.md` for known gaps

**Step 5**: Formulate granular plan
- Sequence using dependency order from `build-order`
- Apply patterns from your artifacts
- Include rationale based on past learnings

### 3. Providing Context to Agents

When agents request context about a feature or module:

```bash
# Product view
tx tool know get feature:target
tx tool know deps feature:target

# Code view
tx tool know -g .ai/code-graph.json get module:target

# Behavioral details (direct jq for references)
jq '.references["execution-trace"]["module:target"]' .ai/code-graph.json
jq '.references["side-effect"]["module:target"]' .ai/code-graph.json
jq '.references["error-path"]["module:target"]' .ai/code-graph.json
```

**Synthesize**:
- Architectural facts from know
- Patterns and learnings from your artifacts
- Warnings from past failures

### 4. Validating Architecture Changes

After agents report completed work or propose changes:

```bash
# Validate consistency
tx tool know health
tx tool know cycles

# Check completeness
tx tool know completeness feature:changed

# Verify cross-graph links
jq '.references["code-module"]["component:new"] | has("module")' .ai/spec-graph.json
```

**Update artifacts** based on outcomes - record patterns, update not-done.md, add to history.md.

### 5. Tracking Implementation Progress

Monitor project health and progress:

```bash
# Query status (via jq, since metadata not in know commands yet)
jq '.entities.features | to_entries | map(select(.value.status == "in-progress"))' .ai/spec-graph.json

# Check dependencies for blocked work
tx tool know deps feature:blocked

# Identify bottlenecks
tx tool know dependents component:critical
```

## Advanced Patterns

### Cross-Graph Traceability

When you need to understand product → code mappings:

```bash
# Find implementing module for component
jq '.references["code-module"]["component:login-form"]' .ai/spec-graph.json
# Returns: {"module":"module:login-form","graph_path":".ai/code-graph.json"}

# Find product component for module
jq '.references["product-component"]["module:login-form"]' .ai/code-graph.json
# Returns: {"component":"component:login-form","graph_path":".ai/spec-graph.json"}
```

Use this when:
- Agents ask "what implements this feature?"
- Formulating plans that need code-level details
- Validating that components have implementations

### Behavioral Analysis

For critical modules, examine execution flow and side effects:

```bash
# How does it execute?
jq '.references["execution-trace"]["module:spawn-command"]' .ai/code-graph.json

# What side effects?
jq '.references["side-effect"]["module:spawn-command"]' .ai/code-graph.json

# How does it handle errors?
jq '.references["error-path"]["module:spawn-command"]' .ai/code-graph.json
```

Use this when:
- Formulating plans for complex features
- Providing context about risky operations
- Identifying technical constraints

### Dependency Analysis for Planning

When planning feature implementations:

```bash
# What must be built first?
tx tool know build-order

# What depends on this? (reverse lookup)
tx tool know dependents component:base-component

# Check for circular dependencies
tx tool know cycles
```

**Integrate with patterns.json**: If history shows "building dependencies first reduces bugs by 60%", prioritize that in your plan.

## Best Practices for Brain

### When Building Graphs

1. **Incremental** - Add entities as you discover them through codebase analysis
2. **Validate often** - Run `health` after adding entities/dependencies
3. **Cross-link thoroughly** - Every component should link to its module
4. **Document behavior** - Add execution-trace, side-effect, error-path for critical modules

### When Querying Graphs

1. **Start broad** - Use `list-type` and `stats` to understand scope
2. **Drill down** - Use `get` and `deps` for specific entities
3. **Validate assumptions** - Use `health` and `cycles` to check consistency
4. **Cross-reference** - Check both graphs for complete picture

### When Providing Guidance

1. **Ground in architecture** - Reference specific entities (`feature:auth`, `module:logger`)
2. **Show dependencies** - Use `deps` and `dependents` to explain order
3. **Apply patterns** - Combine know facts with patterns.json learnings
4. **Include rationale** - Explain WHY based on history.md

### When Formulating Plans

1. **Assess first** - Query know to understand current state
2. **Check order** - Use `build-order` for implementation sequence
3. **Apply learnings** - Reference patterns.json for proven approaches
4. **Be granular** - Each step should be concrete and actionable
5. **Validate plan** - Ensure sequence respects dependencies

## Integration with Your Artifacts

**Know gives you structure**, your artifacts give you wisdom:

| Knowledge Type | Source | Example |
|----------------|--------|---------|
| What exists | Know (graphs) | "feature:auth has 3 components" |
| What depends on what | Know (graphs) | "login-form depends on auth-service" |
| What worked before | Your artifacts (history.md) | "OAuth2 approach succeeded in 2 days" |
| What to avoid | Your artifacts (patterns.json) | "Don't store credentials in localStorage" |
| What's incomplete | Your artifacts (not-done.md) | "Password reset UI missing backend" |
| Why decisions made | Your artifacts (overview.md) | "Using JWT for scalability" |

**Synthesis**: When agents ask for guidance, combine:
- Facts from know (structure, dependencies)
- Patterns from your artifacts (what works)
- Context from your memory (why, when, lessons learned)

## Common Queries Reference

```bash
# Health checks
tx tool know health
tx tool know -g .ai/code-graph.json health

# Statistics
tx tool know stats
tx tool know -g .ai/code-graph.json stats

# List entities
tx tool know list-type features
tx tool know -g .ai/code-graph.json list-type module

# Dependencies
tx tool know deps feature:target
tx tool know dependents component:shared

# Build order
tx tool know build-order

# Cycles detection
tx tool know cycles

# Cross-graph links
jq '.references["code-module"]' .ai/spec-graph.json
jq '.references["product-component"]' .ai/code-graph.json

# Behavioral references
jq '.references["execution-trace"]' .ai/code-graph.json
jq '.references["side-effect"]' .ai/code-graph.json
jq '.references["error-path"]' .ai/code-graph.json
```

---

**Remember**: Know provides the architectural skeleton. Your artifacts provide the experiential muscle. Together, they make you an effective strategic advisor.

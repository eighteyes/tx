---
name: Know: Connect Graphs
description: Connect disconnected entities and cross-link spec-graph with code-graph
category: Know
tags: [know, connect, coverage, cross-link]
---
Connect disconnected entities and cross-link spec-graph with code-graph.

**Arguments**: `$ARGUMENTS` — optional scope: `spec`, `cross`, or entity ID to start from (e.g., `/know:connect spec`, `/know:connect cross`, `/know:connect feature:auth`)

# Graph Connection Workflow

Your goal is to:
1. Improve spec-graph **coverage percentage** by connecting disconnected entities to root users
2. Create **cross-graph connections** between spec-graph features and code-graph modules (bidirectional linking)

## Process Overview

1. **Measure Current Coverage**
   - Run: `know graph coverage`
   - Note the current coverage percentage

2. **Identify Connection Targets**
   - **First**: Review floating entities and remove any that don't belong
   - **Then**: Connect **disconnected chains** (entities not reachable from users)
   - Prioritize by type: features → actions → components
   - Note: Floating components at the leaf level are fine (they're depended on by actions)

3. **Connect Entities Systematically**

   For each disconnected entity:

   a. **Understand the Entity**
      - Read its name and description from spec-graph.json
      - Understand what it does

   b. **Ask User for Context** (use AskUserQuestion)
      - "Which user(s) need {entity-name}?"
      - "Which objective(s) does {entity-name} support?"
      - "Which feature(s) should use {entity-name}?" (for components/actions)

   c. **Create the Link(s)**
      - Use `know -g .ai/know/spec-graph.json link <from> <to1> [<to2> <to3>...]` — pass all targets in one call
      - Cross-link freely: an entity can depend on multiple parents, and a node can be shared across different branches (e.g. both feature:A and feature:B can link the same action or component)
      - Validate: `know -g .ai/know/spec-graph.json validate`

4. **Track Progress**
   - After each connection, re-run coverage check with `know graph coverage`
   - Show: "Coverage: {old}% → {new}%"
   - Continue until coverage >= 80% or all logical connections made

5. **Final Validation**
   - Run: `know graph coverage`
   - Run: `know -g .ai/know/spec-graph.json validate` (note: may show warnings for existing schema violations)
   - Show final coverage percentage

## Connection Rules (follow dependency-rules.json)

- **user** → objective
- **objective** → feature, action
- **feature** → component, action
- **action** → component
- **component** → (leaf nodes, no dependencies in spec graph)

## Example Workflow

```
1. Check coverage: 40%
2. Found: 5 irrelevant features (auth, database, api, ui, test-phase-feature)
3. Ask user: "Do these belong in know-cli?" → No
4. Remove irrelevant features
5. Check coverage: 46.7% ✓
6. Found: 3 disconnected feature chains
7. Ask user: "Which objectives do these features support?"
8. User: schema-agnostic-know supports all 4 objectives; graph-viz supports 2
9. Batch link: know link feature:schema-agnostic-know objective:a objective:b objective:c objective:d
10. Batch link: know link feature:graph-viz objective:b objective:c
11. Cross-link: action:parse-graph is shared — link it from both features:
    know link feature:schema-agnostic-know action:parse-graph
    know link feature:graph-viz action:parse-graph
12. Check coverage: 100% ✓
```

## Reference Orphan Check

After achieving entity coverage, check for orphaned references:

```bash
# Find references with no parent entity depending on them
know -g .ai/know/spec-graph.json check orphans

# Show reference usage stats
know -g .ai/know/spec-graph.json check usage
```

For each orphaned reference:
1. Identify which feature or action should depend on it
2. Connect it: `know link feature:<name> <ref-type>:<ref-key>`
3. If the reference is stale, remove it: `know nodes delete <ref-type>:<ref-key> -y`

## Important Notes (Spec-Graph Connection)

- **Remove irrelevant entities first** before connecting (ask user to confirm)
- Use AskUserQuestion for ambiguous connections (don't guess)
- Only create dependencies allowed by dependency-rules.json
- Track coverage % improvement in todo list
- Components at the leaf level can remain floating (they're depended on by actions)
- Stop when coverage >= 80% OR no more logical connections possible
- Validation may show warnings for existing schema violations - focus on coverage metric

---

# Cross-Graph Connection (Spec ↔ Code)

Connect spec-graph features to code-graph modules for implementation tracking.

## Process Overview

1. **Identify Unlinked Features**
   - Check which features lack implementation links
   - Run: `know -g .ai/know/spec-graph.json feature status <feature-id>`
   - Look for features with "Implemented: No"

2. **Map Features to Code Modules**
   - Ask user: "Which modules/packages implement feature:<name>?"
   - Identify relevant code-graph entities (modules, packages, classes)

3. **Create Bidirectional Links**

   For each feature→module connection:

   **Step 1: Create code-link reference in spec-graph**
   ```bash
   # Spec-graph side
   know -g .ai/know/spec-graph.json add code-link <feature>-code '{"modules":["module:<key>"],"classes":[],"status":"complete"}'
   know -g .ai/know/spec-graph.json link feature:<name> code-link:<feature>-code
   ```

   **Step 2: Create code-link in code-graph**
   ```bash
   # Code-graph side
   know -g .ai/know/code-graph.json add code-link <module>-spec '{"feature":"feature:<name>","component":"component:<component-name>","status":"complete"}'
   know -g .ai/know/code-graph.json link module:<key> code-link:<module>-spec
   ```

4. **Verify Connection**
   ```bash
   # Check implementation status updated (requires code-link refs to exist)
   know -g .ai/know/spec-graph.json feature status feature:<name>
   # Should show: ✅ Implemented: Yes

   # Verify bidirectional traversal
   know -g .ai/know/spec-graph.json graph traverse feature:<name> --direction impl
   know -g .ai/know/code-graph.json graph traverse module:<name> --direction spec
   ```

## Cross-Graph Connection Rules

**Spec-graph side:**
- Feature depends on `code-link:<feature>-code` reference
- `code-link` reference contains `modules` array, `classes` array, and `status`

**Code-graph side:**
- `code-link` reference points to:
  - `feature`: The spec feature ID
  - `component`: The spec component ID (optional)
  - `status`: "complete" | "in-progress" | "planned"

## Example Cross-Graph Workflow

```
# Feature: Authentication System
# Code modules: auth-handler, session-store

1. Add code-link reference in spec-graph:
   know -g .ai/know/spec-graph.json add code-link auth-code \
     '{"modules":["module:auth-handler","module:session-store"],"classes":[],"status":"complete"}'

2. Link feature to code-link:
   know -g .ai/know/spec-graph.json link feature:auth code-link:auth-code

3. Add code-links in code-graph:
   know -g .ai/know/code-graph.json add code-link auth-handler-spec \
     '{"feature":"feature:auth","component":"component:auth-manager","status":"complete"}'
   know -g .ai/know/code-graph.json link module:auth-handler code-link:auth-handler-spec

   know -g .ai/know/code-graph.json add code-link session-store-spec \
     '{"feature":"feature:auth","component":"component:session-handler","status":"complete"}'
   know -g .ai/know/code-graph.json link module:session-store code-link:session-store-spec

4. Verify:
   know -g .ai/know/spec-graph.json feature status feature:auth
   # ✅ Implemented: Yes (requires code-link refs to exist)
   # Modules: module:auth-handler, module:session-store
```

## Connection Priority

1. **Spec-graph coverage** (connect entities to users) - Do this first
2. **Cross-graph linking** (connect features to code) - Do this second
3. **Validation** - Run on both graphs

## Your Task

Choose workflow based on context:

**If improving spec-graph coverage:**
- Start with spec-graph connection workflow (above)
- Track coverage % improvement

**If linking features to code:**
- Start with cross-graph connection workflow
- Track features with "Implemented: No" status
- Create bidirectional links for each feature

**If doing both:**
1. Complete spec-graph coverage first (>= 80%)
2. Then create cross-graph links for all features

---
r5 - Updated to use code-link type and know graph cross connect/coverage commands
r4 - Added cross-graph connection workflow (spec ↔ code bidirectional linking)
r3 - Updated to use `know coverage` command instead of python script
r2 - Updated terminology to "coverage", added removal step, clarified leaf components
r1 - Initial version with coverage-driven connection workflow

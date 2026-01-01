# Graph Connection Workflow

Your goal is to improve the spec-graph's **coverage percentage** by connecting disconnected entities to the root users via dependency chains.

## Process Overview

1. **Measure Current Coverage**
   - Run: `know -g .ai/spec-graph.json coverage`
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

   c. **Create the Link**
      - Use `know -g .ai/spec-graph.json link <from> <to>` to create dependency
      - Validate: `know -g .ai/spec-graph.json validate`

4. **Track Progress**
   - After each connection, re-run coverage check with `know -g .ai/spec-graph.json coverage`
   - Show: "Coverage: {old}% → {new}%"
   - Continue until coverage >= 80% or all logical connections made

5. **Final Validation**
   - Run: `know -g .ai/spec-graph.json coverage`
   - Run: `know -g .ai/spec-graph.json validate` (note: may show warnings for existing schema violations)
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
7. Ask user: "Which objectives does feature:schema-agnostic-know support?"
8. User: All 4 objectives
9. Link objectives → feature:schema-agnostic-know
10. Repeat for remaining features
11. Check coverage: 100% ✓
```

## Important Notes

- **Remove irrelevant entities first** before connecting (ask user to confirm)
- Use AskUserQuestion for ambiguous connections (don't guess)
- Only create dependencies allowed by dependency-rules.json
- Track coverage % improvement in todo list
- Components at the leaf level can remain floating (they're depended on by actions)
- Stop when coverage >= 80% OR no more logical connections possible
- Validation may show warnings for existing schema violations - focus on coverage metric

## Your Task

Start the connection workflow now. Use TodoWrite to track:
- Current coverage: {X}%
- Target coverage: 80%
- Entities to review/connect: {list}

Begin with:
1. Identifying and removing irrelevant entities
2. Connecting highest-priority disconnected chains

---
r3 - Updated to use `know coverage` command instead of python script
r2 - Updated terminology to "coverage", added removal step, clarified leaf components
r1 - Initial version with coverage-driven connection workflow

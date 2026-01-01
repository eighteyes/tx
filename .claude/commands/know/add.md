---
name: Know: Add Feature
description: 5-step workflow to add a feature to spec-graph with HITL clarification
category: Know
tags: [know, feature, overview]
---

**Prerequisites**
- Activate the know-tool skill for graph operations

**Workflow**

## 1. Identify
- Extract feature name from conversation or prompt user if not provided
- Verify uniqueness in `.ai/know/features/`
- Use kebab-case for feature names

## 2. Clarify (HITL)
Ask user essential questions using AskUserQuestion:
- What does this feature do? (1-2 sentence description)
- Which user(s) need this feature? (from spec-graph users)
- Which objective(s) does this feature support? (from spec-graph objectives)
- Any known components needed? (optional, can defer to /know:build)

## 3. Scaffold
- Create directory `.ai/know/features/<feature-name>/`
- Create files from templates:
  - `overview.md` - Populated with answers from Clarify step
  - `todo.md` - Empty checklist
  - `plan.md` - Empty implementation plan
  - `spec.md` - Empty spec file
- Replace `{feature_name}` placeholder in all templates

## 4. Register
Add feature to spec-graph using answers from step 2:
- `know -g .ai/spec-graph.json add feature <name> '{"name":"...","description":"..."}'`
- `know -g .ai/spec-graph.json link objective:<name> feature:<name>` for each objective
- `know -g .ai/spec-graph.json phases add pending feature:<name>`

## 5. Connect
- Run `/know:connect` to validate graph coverage
- Ensure new feature is reachable from root users
- If coverage < 100%, assist with connecting disconnected entities
- Guide user: "Feature added! Run `/know:build <feature-name>` to begin development"

**Example Usage**
```
User: /know:add user-authentication
Assistant:
  1. Identify: feature name = "user-authentication"
  2. Clarify: Asks user what it does, which objectives it supports
  3. Scaffold: Creates .ai/know/features/user-authentication/ with templates
  4. Register: Adds feature to spec-graph, links to objectives
  5. Connect: Validates coverage, guides to /know:build
```

**Notes**
- Always ask clarifying questions before scaffolding (step 2)
- Link features to objectives immediately (avoids disconnected chains)
- Let `/know:build` handle detailed component architecture
- Use `/know:connect` to maintain graph coverage

---
`r4` - Consolidated to 5 steps with HITL clarification flow
`r3` - Added /know:connect step to ensure graph coverage
`r2`

---
name: Know: Add Feature
description: Scaffold a new feature overview with linked workflow files and create stub graph entries
category: Know
tags: [know, feature, overview]
---

**Prerequisites**
- Activate the know-tool skill for graph operations

**Workflow**

1. Extract the feature name from the conversation or prompt the user if not provided
2. Create directory `.ai/know/<feature-name>/`
3. Scaffold files from templates:
   - `overview.md` - User request + QA + requirements
   - `todo.md` - Checklist (links to plan.md)
   - `plan.md` - Implementation steps (links to spec.md)
   - `spec.md` - Empty file for `know spec` output
4. Replace `{feature_name}` placeholder in all templates with the actual feature name
5. Use know-tool skill to create stub graph entries in `spec-graph.json` for the feature (add placeholder entities/references)
6. Guide the user to:
   - Fill out `overview.md` with requirements
   - Update `todo.md` with implementation tasks
   - Create implementation plan in `plan.md`
   - Run `know spec <entity-id>` for each component to build the spec

**Example Usage**
```
User: /know-add user-authentication
Assistant: Creates .ai/know/user-authentication/ with all workflow files
```

**Notes**
- Use kebab-case for feature names
- Ensure feature name is unique in `.ai/know/`
- Add stub entities immediately to spec-graph.json
- Validate graph after creating stubs

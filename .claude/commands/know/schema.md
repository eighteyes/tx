---
name: Know: Create Schema
description: Design a custom schema for domain-specific graph modeling with the know tool
category: Know
tags: [know, schema, design, memory, knowledge-graph]
---

**Main Objective**

Guide an LLM through designing a custom schema (entity types, dependency rules, reference types) for modeling a specific domain using the know graph engine.

**Prerequisites**
- Understanding of the domain you want to model
- Knowledge of what entities and relationships exist in that domain

**Usage**

```
/know:schema <schema-name>
```

**Workflow**

### 1. Initialization

**Steps**:
1. Create schema directory if it doesn't exist: `schemas/`
2. Check if schema already exists at `schemas/<schema-name>.json`
3. If exists, ask: "Schema exists. Overwrite? [Yes/No]"
4. Display schema purpose explanation

**Display to user**:
```
Creating schema: <schema-name>

A schema defines:
- Entity types: The "nouns" in your domain (e.g., person, task, concept)
- Dependency rules: What entities can depend on others (enforces graph structure)
- Reference types: Reusable data not part of the entity graph

Think about your domain:
- What are the core entities (things)?
- How do they relate to each other?
- What supporting data do you need?
```

### 2. Define Entity Types

**Use AskUserQuestion iteratively**:

1. **Ask for first entity type**:
   - Question: "What is the first entity type in your domain? (e.g., 'person', 'task', 'concept')"
   - Header: "Entity Types"
   - Collect as text input

2. **For each entity, collect details**:
   - Question: "Describe what '<entity-type>' represents in your domain"
   - Collect description as text

3. **Required fields**:
   - Question: "What fields are REQUIRED for '<entity-type>'? (comma-separated, e.g., 'name, description, date')"
   - Collect as text, parse into array
   - Note: 'name' and 'description' are always required by default

4. **Optional fields**:
   - Question: "What fields are OPTIONAL for '<entity-type>'? (comma-separated)"
   - Collect as text, parse into array

5. **Continue adding entities**:
   - Question: "Add another entity type? [Yes/No]"
   - If Yes: Repeat from step 1
   - If No: Proceed to dependency rules

**Minimum**: Require at least 2 entity types

### 3. Define Dependency Rules

**Display current entity types**:
```
Entity types defined:
1. <entity-type-1>: <description>
2. <entity-type-2>: <description>
...
```

**For each entity type**:
1. Question: "What entity types can '<entity-type>' depend on? (Select multiple)"
   - Header: "Dependencies"
   - Options: All other entity types + "none"
   - multiSelect: true
   - Collect selections

2. **Validate cycles**:
   - Check for simple cycles (A → B → A)
   - Warn if detected: "Cycle detected: X → Y → X. This may create complex graphs. Continue? [Yes/No]"

3. **Build dependency matrix** as you go

### 4. Define Reference Types

**Explain references**:
```
Reference types are reusable data nodes that entities can depend on.
Examples:
- external-link: URLs to external resources
- file-path: Paths to files
- code-snippet: Code examples
- quote: Exact text quotes
- tag: Categorical labels
```

**Collect references**:
1. Question: "Define reference types for this schema? [Yes/No]"
2. If Yes, for each reference:
   - Question: "What is the reference type name? (e.g., 'external-link', 'file-path')"
   - Question: "What does this reference type represent?"
   - Question: "Add another reference type? [Yes/No]"

### 5. Review and Validate Schema

**Display complete schema for review**:
```
Schema: <schema-name>

Entity Types:
- <entity-type-1>: <description>
  Required: <fields>
  Optional: <fields>
  Can depend on: <other-entity-types>

- <entity-type-2>: <description>
  ...

Reference Types:
- <ref-type-1>: <description>
- <ref-type-2>: <description>

Validation:
✓ Entity types defined: X
✓ Dependency rules defined: Y
✓ No orphan entity types (all can be reached)
⚠ Cycle detected in: [list if any]
```

**Validate**:
1. All entity types have at least one dependency path
2. No completely isolated entity types
3. Warn about cycles but allow them
4. Check for common mistakes:
   - Entity type depending on itself only
   - Missing bidirectional relationships for related concepts

**Ask for confirmation**:
- Question: "Save this schema? [Yes/No/Edit]"
- If Edit: Go back to step 2 (allow editing entity types or dependencies)
- If No: Exit without saving
- If Yes: Proceed to save

### 6. Save Schema File

**Create schema JSON**:
```json
{
  "schema_name": "<schema-name>",
  "schema_version": "1.0",
  "created": "YYYY-MM-DD",
  "description": "Auto-generated schema for <domain>",

  "entity_types": {
    "<entity-type-1>": {
      "description": "<description>",
      "required_fields": ["name", "description", ...],
      "optional_fields": [...]
    },
    ...
  },

  "dependency_rules": {
    "<entity-type-1>": ["<entity-type-2>", "<entity-type-3>"],
    "<entity-type-2>": ["<entity-type-1>"],
    ...
  },

  "reference_types": {
    "<ref-type-1>": "<description>",
    ...
  },

  "meta": {
    "domain": "<inferred-from-entities>",
    "complexity": "<simple|moderate|complex>",
    "use_cases": []
  }
}
```

**Save to**:
- `schemas/<schema-name>.json`

### 7. Initialize Sample Graph (Optional)

**Ask user**:
- Question: "Create a sample graph using this schema? [Yes/No]"
- If Yes:
  - Create `graphs/<schema-name>-sample.json`
  - Initialize with schema metadata:
  ```json
  {
    "meta": {
      "name": "<schema-name> Sample Graph",
      "schema_path": "schemas/<schema-name>.json",
      "schema_version": "1.0",
      "created": "YYYY-MM-DD"
    },
    "entities": {},
    "references": {},
    "graph": {}
  }
  ```

### 8. Generate Usage Guide

**Create `schemas/<schema-name>-USAGE.md`**:
```markdown
# <Schema Name> Schema Usage Guide

**Created:** YYYY-MM-DD
**Schema File:** `schemas/<schema-name>.json`

## Entity Types

### <entity-type-1>
<description>

**Required Fields:**
- name: Entity name
- description: Entity description
- <other-required>: <purpose>

**Optional Fields:**
- <optional>: <purpose>

**Can Depend On:** <entity-types>

**Example:**
```bash
know -g graphs/my-graph.json add <entity-type-1> example-name \
  '{"name":"Example","description":"An example entity","<field>":"value"}'
```

[... repeat for each entity type]

## Reference Types

### <ref-type-1>
<description>

**Example:**
```json
"references": {
  "<ref-type-1>": {
    "example-ref": {
      "description": "Example reference",
      "data": "..."
    }
  }
}
```

## Common Patterns

### Pattern 1: [Describe common usage pattern]
```bash
# Example commands
know add <entity> <name> '{...}'
know link <from> <to>
```

## Getting Started

1. Create a graph using this schema:
```bash
cp graphs/<schema-name>-sample.json graphs/my-<domain>.json
```

2. Add your first entity:
```bash
know -g graphs/my-<domain>.json add <entity-type> my-first \
  '{"name":"My First","description":"..."}'
```

3. Validate your graph:
```bash
know -g graphs/my-<domain>.json validate
```

## Visualization

Your graph structure:
```
[ASCII diagram showing entity relationships based on dependency rules]
```
```

### 9. Confirmation and Next Steps

**Display summary**:
```
Schema created successfully!

Files created:
✓ schemas/<schema-name>.json - Schema definition
✓ schemas/<schema-name>-USAGE.md - Usage guide
✓ graphs/<schema-name>-sample.json - Sample graph (if requested)

Next steps:
1. Review the schema: cat schemas/<schema-name>.json
2. Read usage guide: cat schemas/<schema-name>-USAGE.md
3. Try it out:
   - Use sample graph: know -g graphs/<schema-name>-sample.json add <entity-type> test-entity '{...}'
   - Create your own: cp graphs/<schema-name>-sample.json graphs/my-graph.json
4. Validate: know -g graphs/my-graph.json validate

Examples:
  know -g graphs/my-graph.json add <entity-1> example '{"name":"Example","description":"Test"}'
  know -g graphs/my-graph.json link <entity-1>:example <entity-2>:other
  know -g graphs/my-graph.json deps <entity-1>:example
```

---

## Example: Conversation Memory Schema

**Input Session**:
```
User: /know:schema conversation-memory
Assistant: Creating schema: conversation-memory

          [Guides through entity type collection]

          Question: "What is the first entity type in your domain?"
User: conversation

          Question: "Describe what 'conversation' represents in your domain"
User: A conversation session with a user

          Question: "What fields are REQUIRED for 'conversation'?"
User: name, description, date

          Question: "What fields are OPTIONAL for 'conversation'?"
User: participants, topics, outcomes

          Question: "Add another entity type?"
User: [Selects Yes]

          Question: "What is the next entity type?"
User: person

          [Continues collecting: concept, decision, preference]

          [Moves to dependency rules]

          Question: "What entity types can 'conversation' depend on?"
User: [Selects: person, concept, decision]

          Question: "What entity types can 'decision' depend on?"
User: [Selects: concept, person, preference]

          [Continues for all entity types]

          [Review phase]

          Schema: conversation-memory

          Entity Types:
          - conversation: A conversation session with a user
            Required: name, description, date
            Optional: participants, topics, outcomes
            Can depend on: person, concept, decision

          - person: A person mentioned in conversations
            Required: name, description
            Optional: role, preferences, relationship
            Can depend on: preference, concept

          - concept: An idea or topic discussed
            Required: name, description
            Optional: category, understanding_level
            Can depend on: concept

          - decision: A decision made during conversation
            Required: name, description, date
            Optional: rationale, alternatives
            Can depend on: concept, person, preference

          - preference: User preference learned
            Required: name, value
            Optional: context, confidence
            Can depend on: concept

          Reference Types:
          - external-link: URL to external resource
          - quote: Exact quote from conversation
          - file-path: Path to related file

          Validation:
          ✓ Entity types defined: 5
          ✓ Dependency rules defined: 5
          ✓ No orphan entity types (all reachable)
          ✓ No cycles detected

          Question: "Save this schema?"
User: [Selects Yes]

          Question: "Create a sample graph using this schema?"
User: [Selects Yes]

          Schema created successfully!

          Files created:
          ✓ schemas/conversation-memory.json
          ✓ schemas/conversation-memory-USAGE.md
          ✓ graphs/conversation-memory-sample.json

          Next steps:
          1. Review: cat schemas/conversation-memory.json
          2. Try it: know -g graphs/conversation-memory-sample.json add conversation first-chat \
                      '{"name":"First Chat","description":"Initial conversation","date":"2024-12-13"}'
          3. Validate: know -g graphs/conversation-memory-sample.json validate
```

---

## Outputs

- `schemas/<schema-name>.json` - Schema definition file
- `schemas/<schema-name>-USAGE.md` - Usage guide with examples
- `graphs/<schema-name>-sample.json` - Initialized sample graph (optional)

---

## Schema File Structure

**Generated schema JSON**:
```json
{
  "schema_name": "conversation-memory",
  "schema_version": "1.0",
  "created": "2024-12-13",
  "description": "Auto-generated schema for conversation tracking",

  "entity_types": {
    "conversation": {
      "description": "A conversation session with a user",
      "required_fields": ["name", "description", "date"],
      "optional_fields": ["participants", "topics", "outcomes"]
    },
    "person": {
      "description": "A person mentioned in conversations",
      "required_fields": ["name", "description"],
      "optional_fields": ["role", "preferences", "relationship"]
    }
  },

  "dependency_rules": {
    "conversation": ["person", "concept", "decision"],
    "person": ["preference", "concept"],
    "concept": ["concept"],
    "decision": ["concept", "person", "preference"],
    "preference": ["concept"]
  },

  "reference_types": {
    "external-link": "URL to external resource",
    "quote": "Exact quote from conversation",
    "file-path": "Path to related file"
  }
}
```

---

## Notes

- **Schema-driven**: Know will validate graphs against your custom schema
- **Flexible domains**: Design schemas for any domain (conversations, research, projects, habits)
- **Iterative design**: Can edit and refine schemas, then migrate graphs
- **Validation**: Schema validates entity types, dependencies, and structure
- **Reusable**: Share schemas across projects or with other LLMs
- **Graph portability**: Graphs reference schema path, can be validated anywhere
- **Version control**: Schemas and graphs are JSON, git-friendly
- **No code changes**: Know tool works with any valid schema
- **Domain examples**:
  - **Conversation memory**: Track chats, people, decisions, preferences
  - **Research notes**: Papers, concepts, authors, citations
  - **Habit tracking**: Habits, triggers, outcomes, streaks
  - **Project management**: Tasks, milestones, dependencies, people
  - **Learning**: Topics, resources, progress, connections
  - **Life goals**: Goals, sub-goals, actions, blockers

---

## Integration with Know Commands

After creating a schema, use standard know commands:

```bash
# Use your custom schema
know -g graphs/my-memory.json add conversation chat-001 \
  '{"name":"Schema Discussion","description":"Discussed generalizing know","date":"2024-12-13"}'

# Add related entities
know -g graphs/my-memory.json add concept schema-abstraction \
  '{"name":"Schema Abstraction","description":"Making know schema-agnostic"}'

# Link them
know -g graphs/my-memory.json link conversation:chat-001 concept:schema-abstraction

# Query relationships
know -g graphs/my-memory.json deps conversation:chat-001
know -g graphs/my-memory.json used-by concept:schema-abstraction

# Validate against your schema
know -g graphs/my-memory.json validate
```

**Note**: Current know tool needs schema-awareness added. This command generates schemas ready for when know becomes schema-agnostic.

---
`r1`

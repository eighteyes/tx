---
name: Know: Add Feature
description: 5-step workflow to add a feature to spec-graph with HITL clarification
category: Know
tags: [know, feature, overview]
---
Add a feature to spec-graph with guided 5-step clarification workflow.

**Prerequisites**
- Activate the know-tool skill for graph operations

**Workflow**

## 1. Identify
- Extract feature name from conversation or prompt user if not provided
- Verify uniqueness in `.ai/know/features/`
- Use kebab-case for feature names

## 2. QA Generation (Parallel Task Agents)

Before asking the user anything, generate deep questions about the feature using parallel Task agents.

**Context to gather first:**
- Check spec-graph for existing users and objectives: `know -g .ai/know/spec-graph.json list --type user` and `know -g .ai/know/spec-graph.json list --type objective`
- Note any existing features for cross-reference context

**Launch 4 agents in a SINGLE message** (one Task tool call each):

**Agent 1 — Actions & Operations** (→ `action:*`, `operation:*` entities)
> "You are helping build a spec-graph for a software feature called '[name]'. Generate 5 questions whose answers will directly become `action` and `operation` graph entities. An `action` is a discrete thing a user does (e.g. upload-file, generate-report, approve-request). An `operation` is something a component does internally (e.g. validate-token, parse-csv, write-record). Ask about: what specific steps does the user take in this feature from start to finish, what does each step trigger in the system, what sub-steps make up the most complex user action, what failure paths branch off each step, and what state changes each action produces. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 2 — Components & Responsibilities** (→ `component:*` entities)
> "You are helping build a spec-graph for a software feature called '[name]'. Generate 5 questions whose answers will directly become `component` graph entities. A `component` is a distinct system responsibility that handles one concern (e.g. auth-handler, file-processor, notification-sender, report-builder). Ask about: what are the distinct implementation responsibilities this feature requires, which responsibilities are isolated enough to be named components, what does each component receive as input and produce as output, which components would be reused by other features, and which components have side effects (network calls, file writes, emails). Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 3 — Data Models & Interface References** (→ `data-model:*`, `interface:*`, `api_contract:*` references)
> "You are helping build a spec-graph for a software feature called '[name]'. Generate 5 questions whose answers will directly become `data-model`, `interface`, and `api_contract` reference entries. Ask about: what is the primary data entity this feature creates or modifies and what are its key fields, what does the main API endpoint look like (path, method, request fields, response shape), what does the UI screen or form look like (what fields, labels, and states does the user see), what data must be validated before it is accepted, and what data does this feature expose to other parts of the system. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 4 — Rules, Config & Constraints** (→ `business_logic:*`, `configuration:*`, `security-spec:*`, `constraint:*`, `acceptance_criterion:*` references)
> "You are helping build a spec-graph for a software feature called '[name]'. Generate 5 questions whose answers will directly become `business_logic`, `configuration`, `security-spec`, `constraint`, and `acceptance_criterion` reference entries. Ask about: what are the non-obvious domain rules that govern this feature's behavior (approval gates, conditional logic, state machine rules), what runtime configuration or environment settings does it require, who is allowed to use this feature and under what conditions, what are the hard invariants that must never be violated, and what does 'this feature works correctly' look like from the user's point of view. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Collect all agent results** into `.ai/know/features/<feature-name>/qa.md`:

```markdown
# QA: [feature-name]
_Each answer maps to a graph entity or reference. See type hints per section._

## Actions & Operations  [→ action:*, operation:*]
1. ...
2. ...

## Components & Responsibilities  [→ component:*]
6. ...
7. ...

## Data Models & Interfaces  [→ data-model:*, interface:*, api_contract:*]
11. ...
12. ...

## Rules, Config & Constraints  [→ business_logic:*, configuration:*, security-spec:*, constraint:*, acceptance_criterion:*]
16. ...
17. ...

---
_Answers:_
```

**Present the qa.md contents to the user** in chat:
> "I've generated [N] questions about `[feature-name]`. Answer as many as you can — paste answers after each question in the file, or respond here. I'll incorporate your answers before building the spec."

**After user responds**: Parse answers from chat or the updated file. Proceed to Step 3 with those answers. If the user answers partially, note which areas are unresolved and proceed with what's available — flag gaps in `overview.md`.

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
- `know -g .ai/know/spec-graph.json add feature <name> '{"name":"...","description":"..."}'`
- `know -g .ai/know/spec-graph.json graph link objective:<name> feature:<name>` for each objective
- `know -g .ai/know/spec-graph.json phases add pending feature:<name>`

**Cross-Graph Setup** (prepare for implementation tracking):
```bash
# Placeholder code-link in spec-graph (filled during /know:build)
know -g .ai/know/spec-graph.json add code-link <name>-code '{"modules":[],"classes":[],"packages":[],"status":"planned"}'
know -g .ai/know/spec-graph.json link feature:<name> code-link:<name>-code

# Reverse pointer in code-graph
know -g .ai/know/code-graph.json add code-link <name>-spec '{"feature":"feature:<name>","component":"","status":"planned"}'
```

**Note:** Actual module references are added during Phase 5 of `/know:build`.

## 4b. Reference Enrichment (HITL)

After registering the feature, ask the user which reference types apply. This ensures the graph captures specs beyond structural entities.

**First, present this checklist** and ask the user to select all that apply:

| # | Type | Use it when... |
|---|------|----------------|
| 1 | `configuration` | Feature has runtime settings or environment config |
| 2 | `data-model` | Feature defines or uses a data schema |
| 3 | `business_logic` | Feature has non-trivial rules or workflows |
| 4 | `acceptance_criterion` | Feature has specific success criteria |
| 5 | `interface` | Feature has a UI screen or page |
| 6 | `api_contract` | Feature exposes or consumes an API endpoint |
| 7 | `security-spec` | Feature has auth, permissions, or security requirements |
| 8 | `constraint` | Feature has hard limits or invariants |

**To see all available reference types:**
```bash
know -g .ai/know/spec-graph.json graph check ref-types
know -g .ai/know/spec-graph.json graph check ref-types --filter <term>
```

**For each selected type**, ask for the value and create the reference:
```bash
know -g .ai/know/spec-graph.json add <type> <feature>-<type-short> '{"description":"..."}'
know -g .ai/know/spec-graph.json link feature:<name> <type>:<feature>-<type-short>
```

**Do not skip this step.** A feature with no reference dependencies is likely under-specified.

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
  4b. Enrich: Asks user which reference types apply, adds them
  5. Connect: Validates coverage, guides to /know:build
```

**Notes**
- Always ask clarifying questions before scaffolding (step 2)
- Link features to objectives immediately (avoids disconnected chains)
- Let `/know:build` handle detailed component architecture
- Use `/know:connect` to maintain graph coverage

---
`r7` - Step 2: replaced sparse HITL with 4 parallel Task agents → qa.md (min 16 questions), iterate before scaffold
`r6` - Reference Enrichment phase (4b): HITL checklist + know graph check ref-types; updated cross-graph setup to code-link
`r5` - Added cross-graph setup (implementation references and graph-link stubs)
`r4` - Consolidated to 5 steps with HITL clarification flow
`r3` - Added /know:connect step to ensure graph coverage
`r2`

---
name: Know: Interactive Planning
description: Walk through QA-based planning workflow to build complete product vision and spec-graph
category: Know
tags: [know, planning, qa, vision]
---

**Main Objective**

Guide user through interactive QA sessions to build a complete product vision with technical decisions, generating both documentation artifacts and populating spec-graph.json.

**Prerequisites**
- Activate the know-tool skill for graph operations

**Exploration Strategy**
When existing code is found, use parallel exploration to understand the codebase:
- **Explore agent**: Discovers codebase nuances, patterns, and architecture (use `thoroughness: "medium"`)
- **Custom Task agents**: Create specialized agents for specific analysis tasks
- **Launch in parallel**: Use SINGLE message with multiple Task tool calls for speed
- The `/know:prepare` command should leverage parallel exploration extensively

**Maturity Assessment**

Before starting, assess project maturity to determine which modes to run:

1. **Check for code**: Look for src/, lib/, main application files
2. **Check for spec-graph.json**: Exists? How many entities?
3. **Check for documentation**: .ai/know/product/, flows/, models/

**Decision Tree:**

```
IF code exists AND no spec-graph:
  → Inform: "Found code but no spec-graph"
  → Ask: "Run /know:prepare first to analyze code and create graphs?"
  → If YES: Delegate to /know:prepare, then continue with QA refinement
  → If NO: Start from Discovery mode

IF code exists AND sparse spec-graph (< 5 total entities OR missing user/objective):
  → Ask: "Spec-graph exists but incomplete. Enrich from code first?"
  → If YES: Delegate to /know:prepare
  → If NO: Continue with QA sessions

IF no code AND no spec-graph:
  → Start from ALL modes (greenfield planning)

IF no code AND has spec-graph:
  → Skip to Architect → PM modes (planned but not built)

IF code AND complete spec-graph (>10 entities, has users/objectives/features):
  → Ask: "What do you want to improve/add?"
  → Run specific modes or use /know:add for new features
```

**Planning Modes**

Each mode follows this pattern:
1. Generate QA questions based on current state
2. Write questions to `.ai/know/qa/[mode-name].md`
3. Interactive QA session with user
4. Generate mode artifacts (markdown files)
5. Generate corresponding spec-graph entities
6. **Confirm with user before writing to spec-graph**
7. Validate graph
8. Save QA session results

---

### Mode 1: Start (Intent & Scope)

**When to run**: Greenfield projects, no existing documentation

**Questions to ask**:
- What is the intent? (bare minimum, MVP, v1, enterprise)
- Which modes should be enabled/skipped?
- What problem does this solve?
- Who is this for?

**Outputs**:
- Files:
  - `.ai/know/input.md` - Initial user prompt
  - `.ai/know/revised-input.md` - Refined vision
- Spec-graph: None directly (informs subsequent modes)

---

### Mode 2: Discovery (Collaborative Decision Making)

**When to run**: New projects, or when user/objective entities missing

**Questions to ask** (5-10 questions):
- Who are the primary users/personas?
- What are their core objectives?
- What is the critical path through the system?
- What user stories define success?
- What features are must-have vs nice-to-have?
- What are the key requirements?
- What business processes need to be supported?

**Outputs**:
- Files:
  - `.ai/know/qa/discovery.md` - QA session log
  - `.ai/know/product/user-stories.md`
  - `.ai/know/product/requirements.md`
  - `.ai/know/product/features.md`
  - `.ai/know/product/critical-path.md`
  - `.ai/know/flows/user.md` - User journey diagram
  - `.ai/know/flows/system.md` - System interaction diagram
  - `.ai/know/flows/biz.md` - Business process diagram

- Spec-graph entities (WITH CONFIRMATION):
  - `user:*` entities (e.g., user:developer, user:end-user)
  - `objective:*` entities (e.g., objective:manage-data, objective:generate-reports)
  - Initial `feature:*` entities (high-level features)
  - Dependencies: `user → objective`, `objective → feature`

---

### Mode 3: Architect (Components & Data Models)

**When to run**: After Discovery, or when component entities missing

**Questions to ask** (5-10 questions):
- What are the core data models/entities?
- How do components interact?
- What are the integration points?
- How should errors be handled?
- What security/auth requirements exist?
- How should state be managed?
- What are the data flows?

**Outputs**:
- Files:
  - `.ai/know/qa/architect.md` - QA session log
  - `.ai/know/tech-ideas.md` - Architecture options
  - `.ai/know/models/[model-name].md` - Data model specs
  - `.ai/know/components/[component-name].md` - Component specs
  - `.ai/know/flows/control.md` - Execution flow
  - `.ai/know/flows/data.md` - Data flow
  - `.ai/know/flows/error.md` - Error handling
  - `.ai/know/flows/auth.md` - Security flow
  - `.ai/know/flows/event.md` - Event flow
  - `.ai/know/flows/integration.md` - Integration flow
  - `.ai/know/flows/state.md` - State management
  - `.ai/know/flows/logic.md` - Business logic
  - `.ai/know/stack.md` - Final tech stack decisions

- Spec-graph entities (WITH CONFIRMATION):
  - `component:*` entities (e.g., component:auth-handler, component:data-processor)
  - `action:*` entities (e.g., action:login, action:export-report)
  - `operation:*` entities (e.g., operation:validate-token, operation:parse-csv)
  - `interface:*` entities (e.g., interface:api-gateway)
  - `requirement:*` entities (e.g., requirement:auth, requirement:audit)
  - Dependencies: `feature → action → component → operation`

- Spec-graph references:
  - `business_logic:*` - Business rules
  - `data-models:*` - Core data structures
  - `tech-stack:*` - Technology choices

---

### Mode 4: API (if needed)

**When to run**: Web services, REST/GraphQL APIs, or when interface entities sparse

**Questions to ask**:
- What are the core endpoints/routes?
- What request/response formats?
- What authentication/authorization?
- What versioning strategy?
- What rate limiting/quotas?

**Outputs**:
- Files:
  - `.ai/know/qa/api.md` - QA session log
  - `.ai/know/api/[segment-name].md` - API specs per segment

- Spec-graph entities (WITH CONFIRMATION):
  - `interface:*` entities (e.g., interface:rest-api, interface:graphql-endpoint)
  - Dependencies: `interface → action`

---

### Mode 5: UI (if needed)

**When to run**: User-facing applications, or when UI navigation unclear

**Questions to ask**:
- What are the main screens/views?
- How do users navigate?
- What interactions are critical?
- What accessibility requirements?
- What responsive/mobile needs?

**Outputs**:
- Files:
  - `.ai/know/qa/ui.md` - QA session log
  - `.ai/know/ui.md` - UI specification

- Spec-graph entities (WITH CONFIRMATION):
  - `interface:*` entities for screens (e.g., interface:dashboard, interface:settings)
  - Dependencies: `interface → action`

---

### Mode 6: Prototyping (if needed)

**When to run**: Novel/risky requirements need validation

**Questions to ask**:
- What requirements are novel or untested?
- What technical risks exist?
- What assumptions need validation?
- What experiments would de-risk?

**Outputs**:
- Files:
  - `.ai/know/qa/prototyping.md` - QA session log
  - `.ai/know/experiments.md` - Validation experiments

- Spec-graph: Updates to `requirement:*` with risk notes

---

### Mode 7: Quality (Testing Strategy)

**When to run**: After architecture defined, before PM

**Questions to ask**:
- What is the critical path to test?
- What integration points need coverage?
- What edge cases exist?
- What performance requirements?
- What security testing needed?

**Outputs**:
- Files:
  - `.ai/know/qa/quality.md` - QA session log
  - `.ai/know/testing.md` - Test plan

- Spec-graph references:
  - `test-strategy:*` - Testing approach per component

---

### Mode 8: Documentation

**When to run**: After architecture and PM complete

**Questions to ask**:
- Who needs documentation? (end users, developers, operators)
- What should INSTALL.md cover?
- What should DEVELOPMENT.md cover?
- What should DEPLOY.md cover?

**Outputs**:
- Files:
  - `.ai/know/qa/documentation.md` - QA session log
  - `.ai/know/docs/INSTALL.md`
  - `.ai/know/docs/DEVELOPMENT.md`
  - `.ai/know/docs/DEPLOY.md`
  - `.ai/know/docs/[other].md`

- Spec-graph: None directly

---

### Mode 9: Project Management

**When to run**: Final mode, after all technical decisions made

**Questions to ask**:
- What is the build order?
- How should work be phased? (I, II, III)
- What are the acceptance criteria per feature?
- What dependencies exist between features?

**Outputs**:
- Files:
  - `.ai/know/qa/pm.md` - QA session log
  - `.ai/know/plan/1-[task].md`, `.ai/know/plan/2-[task].md`, etc. - Granular implementation tasks
  - `.ai/know/todo.md` - Checklist with links
  - `.ai/know/file-index.md` - Proposed file structure

- Spec-graph updates (WITH CONFIRMATION):
  - Populate `meta.phases_metadata` with phase definitions:
    ```json
    "phases_metadata": {
      "I": {"name": "Foundation", "description": "Core architecture"},
      "II": {"name": "Features", "description": "Main functionality"},
      "III": {"name": "Polish", "description": "Optimizations"}
    }
    ```
  - Populate `meta.phases` with I, II, III phases
  - Assign features to phases with status "incomplete"
  - Verify all features have dependencies

---

### Mode 10: Delivery (Final Validation)

**When to run**: After all modes complete

**Workflow**:
1. Validate both spec-graph.json and code-graph.json (if exists)
2. Run gap-analysis to find missing dependencies
3. Verify critical path is fully mapped
4. Review all `.ai/know/flows/` files for accuracy
5. Generate final project.md from graphs
6. Present completion summary to user

**Outputs**:
- Files:
  - `.ai/know/project.md` - Derived from spec-graph queries
- Validation: Clean graph validation, no errors

---

## Workflow Execution

1. **Assess maturity** (use decision tree above)
2. **Determine required modes** based on assessment
3. **For each required mode**:
   a. Generate QA questions (5-10 per mode)
   b. Write questions to `.ai/know/qa/[mode-name].md`
   c. **Interactive QA session**: Present questions, collect answers
   d. Update `.ai/know/revised-input.md` with learnings
   e. Generate mode artifacts (markdown files in `.ai/know/`)
   f. Generate spec-graph entities/references
   g. **Show user what will be added to spec-graph**
   h. **Ask for confirmation before writing**
   i. Update spec-graph.json
   j. Validate graph: `know -g .ai/spec-graph.json validate`
   k. Save QA session with answers to `.ai/know/qa/[mode-name].md`
4. **Final delivery mode** - validate and generate project.md

## Key Principles

- **No time estimates** - Focus on what, not when
- **Graph is source of truth** - Files document, graph defines relationships
- **Confirmation before graph writes** - User reviews entities before adding
- **Iterative and resumable** - Can stop/resume at any mode
- **Quality over speed** - Better to ask more questions than make wrong assumptions
- **Delegate to /know:prepare** - Don't duplicate code analysis work

## Example Usage

```
User: /know:plan
Assistant: Assessing project maturity...
          Found code in src/ but no spec-graph.json

          I recommend running /know:prepare first to analyze your code
          and create initial graphs. Then we can refine with QA sessions.

          Run /know:prepare first? [Yes/No]
```

## Notes

- Uses know-tool skill extensively
- Creates comprehensive `.ai/know/` directory structure
- Populates spec-graph.json progressively
- Suitable for greenfield planning or refining existing projects
- Can skip modes based on maturity assessment

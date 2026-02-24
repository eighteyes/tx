---
name: Know: Interactive Planning
description: Walk through QA-based planning workflow to build complete product vision and spec-graph
category: Know
tags: [know, planning, qa, vision]
---
Interactive QA-based planning to build product vision and populate spec-graph.

**Main Objective**

Guide user through interactive QA sessions to build a complete product vision with technical decisions, generating both documentation artifacts and populating spec-graph.json.

**Prerequisites**
- Activate the know-tool skill for graph operations

**Graph Operations (CRITICAL)**

All spec-graph modifications MUST use know CLI commands. Never edit spec-graph.json directly.

**Adding Features** - Use `/know:add`:
```
/know:add <feature-name>
```
This triggers the full feature workflow: duplicate check → HITL clarification → scaffolding → registration → graph linking.

**Scaffolding Code-Link Placeholders**

**After adding each feature and component to the spec-graph, create placeholder code-link refs:**

```bash
# Feature placeholder (status: planned — AI fills in during /know:build)
know -g .ai/know/spec-graph.json add code-link <feature>-code '{"modules":[],"classes":[],"packages":[],"status":"planned"}'
know -g .ai/know/spec-graph.json link feature:<name> code-link:<feature>-code

# Component placeholder (repeat for each component)
know -g .ai/know/spec-graph.json add code-link <component>-code '{"modules":[],"classes":[],"packages":[],"status":"planned"}'
know -g .ai/know/spec-graph.json link component:<name> code-link:<component>-code
```

These placeholders ensure `know graph cross coverage` shows 0% instead of missing entities.
Track coverage: `know graph cross coverage --spec-only`

**Adding Other Entities** - Use `know add`:
```bash
know -g .ai/know/spec-graph.json add user <key> '{"name":"...","description":"..."}'
know -g .ai/know/spec-graph.json add objective <key> '{"name":"...","description":"..."}'
know -g .ai/know/spec-graph.json add component <key> '{"name":"...","description":"..."}'
know -g .ai/know/spec-graph.json add action <key> '{"name":"...","description":"..."}'
know -g .ai/know/spec-graph.json add operation <key> '{"name":"...","description":"..."}'
know -g .ai/know/spec-graph.json add interface <key> '{"name":"...","description":"..."}'
know -g .ai/know/spec-graph.json add requirement <key> '{"name":"...","description":"..."}'
```

**Linking Dependencies** - Use `know link`:
```bash
know -g .ai/know/spec-graph.json link user:developer objective:manage-data
know -g .ai/know/spec-graph.json link objective:manage-data feature:data-import
know -g .ai/know/spec-graph.json link feature:data-import action:upload-file
know -g .ai/know/spec-graph.json link action:upload-file component:file-processor
```

**Validation** - Always validate after modifications:
```bash
know -g .ai/know/spec-graph.json validate
```

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

---

## QA Batch Generation (Before Any Mode)

After the maturity assessment, generate a deep question bank before running any modes. This front-loads the discovery work and avoids drip-feeding 5 questions at a time across 10 sessions.

**Target: 35+ questions covering all software dimensions.**

**Step 1 — Gather context for agents:**
```bash
# If spec-graph exists:
know -g .ai/know/spec-graph.json list --type user
know -g .ai/know/spec-graph.json list --type objective
know -g .ai/know/spec-graph.json list --type feature
know -g .ai/know/spec-graph.json check stats
```
Also read `.ai/know/input.md` and any existing README/docs.

**Step 2 — Launch 8 Task agents in a SINGLE message** (parallel):

**Agent 1 — Users & Objectives** (→ `user:*`, `objective:*` entities)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `user` and `objective` graph entities. A `user` entity is a distinct persona with a name like `user:developer`, `user:admin`, `user:end-user`. An `objective` is what that user wants to accomplish, named like `objective:manage-data`, `objective:monitor-status`. Ask about: who are the distinct types of people using this system, what does each user type want to accomplish (their top 1-2 objectives), how do their goals or access levels differ, what does success look like for each user type, and are there secondary or system-level actors (e.g. cron jobs, webhooks) that need modeling. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 2 — Features** (→ `feature:*` entities)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `feature` entities. A `feature` is a named system capability that serves user objectives, like `feature:user-auth`, `feature:data-import`, `feature:report-generation`. Ask about: what are the top-level capabilities this system must provide, which capabilities are distinct enough to be separate named features, which features are essential vs optional for v1, which objectives does each feature serve, and are any features prerequisites for others. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 3 — Actions** (→ `action:*` entities)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `action` entities. An `action` is a discrete, named thing a user does within a feature, like `action:login`, `action:upload-file`, `action:approve-request`, `action:export-report`. Ask about: for each major feature, what specific things does a user do step by step, what triggers each action (button click, form submit, schedule), what is the primary action of each feature, what are the supporting or secondary actions, and are any actions shared across multiple features. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 4 — Components** (→ `component:*` entities)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `component` entities. A `component` is a distinct implementation responsibility, like `component:auth-handler`, `component:file-processor`, `component:report-builder`, `component:notification-sender`. Ask about: what are the distinct implementation responsibilities this system needs, which responsibilities are isolated enough to be named components, what does each component receive as input and produce as output, which components are shared infrastructure vs feature-specific, and which components have side effects (external calls, writes, notifications). Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 5 — Data Models** (→ `data-model:*` references)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `data-model` reference entries. Ask about: what are the primary data entities (name each and list 3-5 key fields), what are the relationships between those entities (one-to-one, one-to-many, many-to-many), what data must be persisted vs can be computed on the fly, which data entity is the most central and what is its lifecycle (created → updated → deleted/archived), and what data is owned by one feature vs shared across features. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 6 — Interfaces & API Contracts** (→ `interface:*`, `api_contract:*` references)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `interface` and `api_contract` reference entries. Ask about: what are the main screens or views (name each and describe its primary content and user goal), what are the main API endpoints (path, method, key request/response fields), what data does each screen display and where does it come from, what forms exist and what fields do they contain, and how does the system expose or consume any external APIs. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 7 — Business Logic & Security** (→ `business_logic:*`, `security-spec:*` references)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `business_logic` and `security-spec` reference entries. Ask about: what are the non-obvious domain rules that govern system behavior (validation rules, approval gates, state machine transitions), who can access each feature and under what conditions (role-based, ownership-based), what data is sensitive and how must it be handled or protected, what audit trail or activity log is required, and what are the edge cases in the most complex user workflow. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 8 — Configuration & Constraints** (→ `configuration:*`, `constraint:*`, `acceptance_criterion:*` references)
> "You are helping build a spec-graph for a project described as: '[project description]'. Generate 5 questions whose answers will directly become `configuration`, `constraint`, and `acceptance_criterion` reference entries. Ask about: what runtime settings or environment variables does the system need, what feature flags or toggles are anticipated, what are the hard invariants that must never be violated (data integrity rules, required fields, state preconditions), what does a working v1 look like from each user's perspective (acceptance criteria), and what are the deployment or environment assumptions. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Step 3 — Collect and write to `.ai/know/qa/plan-questions.md`:**

```markdown
# Plan QA: [project name]
_Each answer maps to a graph entity or reference. See type hints per section._

## 1. Users & Objectives  [→ user:*, objective:*]
1. ...

## 2. Features  [→ feature:*]
6. ...

## 3. Actions  [→ action:*]
11. ...

## 4. Components  [→ component:*]
16. ...

## 5. Data Models  [→ data-model:*]
21. ...

## 6. Interfaces & API Contracts  [→ interface:*, api_contract:*]
26. ...

## 7. Business Logic & Security  [→ business_logic:*, security-spec:*]
31. ...

## 8. Configuration & Constraints  [→ configuration:*, constraint:*, acceptance_criterion:*]
36. ...

---
_Answers:_
```

**Step 4 — Present to user:**
> "I've generated [N] questions about your project across 8 domains. Please answer as many as you can — paste answers after each question in the file, or answer in chat. The more you answer, the less I'll need to guess later."

Show the full file contents in chat.

**Step 5 — Iterate:**
- After user responds: read answers, update qa.md with inline responses
- If significant gaps remain in any domain: generate 3-5 follow-up questions for that domain only
- Once answers are sufficient, proceed to Planning Modes (modes use answers; they do NOT re-ask covered questions)

---

**Planning Modes**

Modes now focus on **graph-building and artifact generation** — not question-asking. QA is complete before modes run. Each mode:
1. Reads answers from `.ai/know/qa/plan-questions.md`
2. Generates mode artifacts from those answers
3. Adds entities to spec-graph using know CLI
4. Validates and links

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
- **Are there reference materials?** (research papers, specifications, API docs, standards, prior art)

**Surface Assumptions**:
Before proceeding to Architect mode, state any assumptions about scope, technical approach, or existing system behavior.
For each assumption: confidence ≥95% → state and proceed. <95% → ask user.
*Assumption economics: -5 if wrong, +1 if right, 0 if ask.*
  - Research papers this is based on?
  - Industry standards or RFCs to follow?
  - API documentation to integrate with?
  - Similar projects to learn from?

**Outputs**:
- Files:
  - `.ai/know/qa/discovery.md` - QA session log
  - `.ai/know/product/user-stories.md`
  - `.ai/know/product/requirements.md`
  - `.ai/know/product/features.md`
  - `.ai/know/product/critical-path.md`
  - **`.ai/know/references.md`** - Research papers, specs, API docs, prior art (if provided)
  - `.ai/know/flows/user.md` - User journey diagram
  - `.ai/know/flows/system.md` - System interaction diagram
  - `.ai/know/flows/biz.md` - Business process diagram

- Spec-graph entities (WITH CONFIRMATION):
  - `user:*` entities (e.g., user:developer, user:end-user)
  - `objective:*` entities (e.g., objective:manage-data, objective:generate-reports)
  - Initial `feature:*` entities (high-level features)
  - Dependencies: `user → objective`, `objective → feature`
  - **`references.documentation`** entries for research papers, specs, API docs (if provided)

- **Graph Commands to Execute**:
  ```bash
  # Add users
  know -g .ai/know/spec-graph.json add user developer '{"name":"Developer","description":"..."}'
  know -g .ai/know/spec-graph.json add user end-user '{"name":"End User","description":"..."}'

  # Add objectives
  know -g .ai/know/spec-graph.json add objective manage-data '{"name":"Manage Data","description":"..."}'

  # Link users to objectives
  know -g .ai/know/spec-graph.json link user:developer objective:manage-data

  # Add features via /know:add (triggers full workflow)
  /know:add data-import
  /know:add user-auth

  # Validate
  know -g .ai/know/spec-graph.json validate
  ```

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

- **Graph Commands to Execute**:
  ```bash
  # Add components
  know -g .ai/know/spec-graph.json add component auth-handler '{"name":"Auth Handler","description":"..."}'
  know -g .ai/know/spec-graph.json add component data-processor '{"name":"Data Processor","description":"..."}'

  # Add actions
  know -g .ai/know/spec-graph.json add action login '{"name":"Login","description":"..."}'
  know -g .ai/know/spec-graph.json add action export-report '{"name":"Export Report","description":"..."}'

  # Add operations
  know -g .ai/know/spec-graph.json add operation validate-token '{"name":"Validate Token","description":"..."}'

  # Add interfaces
  know -g .ai/know/spec-graph.json add interface api-gateway '{"name":"API Gateway","description":"..."}'

  # Add requirements
  know -g .ai/know/spec-graph.json add requirement auth '{"name":"Authentication","description":"..."}'

  # Link the chain: feature → action → component → operation
  know -g .ai/know/spec-graph.json link feature:user-auth action:login
  know -g .ai/know/spec-graph.json link action:login component:auth-handler
  know -g .ai/know/spec-graph.json link component:auth-handler operation:validate-token

  # Validate
  know -g .ai/know/spec-graph.json validate
  ```

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

- **Graph Commands to Execute**:
  ```bash
  # Add API interfaces
  know -g .ai/know/spec-graph.json add interface rest-api '{"name":"REST API","description":"..."}'
  know -g .ai/know/spec-graph.json add interface graphql-endpoint '{"name":"GraphQL Endpoint","description":"..."}'

  # Link interfaces to actions
  know -g .ai/know/spec-graph.json link interface:rest-api action:login
  know -g .ai/know/spec-graph.json link interface:rest-api action:export-report

  # Validate
  know -g .ai/know/spec-graph.json validate
  ```

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

- **Graph Commands to Execute**:
  ```bash
  # Add UI interfaces (screens)
  know -g .ai/know/spec-graph.json add interface dashboard '{"name":"Dashboard","description":"Main overview screen"}'
  know -g .ai/know/spec-graph.json add interface settings '{"name":"Settings","description":"User preferences screen"}'

  # Link screens to actions they enable
  know -g .ai/know/spec-graph.json link interface:dashboard action:view-reports
  know -g .ai/know/spec-graph.json link interface:settings action:update-profile

  # Validate
  know -g .ai/know/spec-graph.json validate
  ```

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
3. **Run QA Batch Generation** (see section above) — generates 35+ questions across 8 domains
4. **Present questions, collect answers, iterate** — before any graph writes
5. **For each required mode** (using answers from step 4):
   a. Read relevant answers from `.ai/know/qa/plan-questions.md`
   b. Generate mode artifacts (markdown files in `.ai/know/`)
   c. **Prepare graph commands** (see "Graph Commands to Execute" in each mode)
   d. **Show user the exact commands to be executed**
   e. **Ask for confirmation before executing**
   f. **Execute commands**:
      - For features: `/know:add <feature-name>` (full workflow; qa.md already answered)
      - For other entities: `know -g .ai/know/spec-graph.json add <type> <key> '{...}'`
      - For dependencies: `know -g .ai/know/spec-graph.json link <from> <to>`
   g. Validate graph: `know -g .ai/know/spec-graph.json validate`
6. **Final delivery mode** - validate and generate project.md

## Key Principles

- **No time estimates** - Focus on what, not when
- **Graph is source of truth** - Files document, graph defines relationships
- **Use know CLI for all graph operations** - Never edit spec-graph.json directly
- **Use /know:add for features** - Triggers full workflow with scaffolding
- **Confirmation before graph writes** - User reviews commands before execution
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

---
`r2` - QA Batch Generation phase: 8 parallel Task agents → 35+ questions → plan-questions.md → iterate; modes now consume answers instead of re-asking; Workflow Execution updated
`r1` - Added explicit Graph Operations section with know CLI commands; added "Graph Commands to Execute" examples to Modes 2-5; updated Workflow Execution to specify /know:add for features vs know CLI for other entities

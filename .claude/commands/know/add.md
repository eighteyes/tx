---
name: Know: Add Feature
description: 5-step workflow to add a feature to spec-graph with HITL clarification
category: Know
tags: [know, feature, overview]
---
Add a feature to spec-graph with guided 5-step clarification workflow.

**Arguments**: `$ARGUMENTS` — feature name in kebab-case (e.g., `/know:add user-authentication`)

**Prerequisites**
- Activate the know-tool skill for graph operations

**Workflow**

## 1. Identify
- Extract feature name from `$ARGUMENTS` or prompt user if not provided
- Use kebab-case for feature names
- Check if feature already exists:
  - `know get feature:<name>` — exists in graph?
  - `ls .ai/know/features/<name>/` — active feature dir?
  - `ls .ai/know/archive/<name>/` — archived?
- **If feature exists → Append Mode** (see Step 1b)
- **If new → continue to Step 2**

## 1b. Append Mode (existing feature)

When appending to an existing feature, the goal is to add new scope — actions, components, references — to a feature that already has graph presence.

**Minimal scaffolding for archived features:**
If the feature was archived, create only what's needed for the addition:
```bash
mkdir -p .ai/know/features/<name>/changes
# Create a fresh todo.md for the new work only
```
Do NOT restore the full archive. The archive is history; the feature dir is active work.

**If feature dir already exists** (not archived), use it as-is.

**Set status to in-progress:**
```bash
know meta set phases.<phase>.feature:<name>.status in-progress
```
Phase stays where it is. Status reflects current reality.

**Then continue to Step 2** with this context change: QA agents should ask "What are you adding to `<name>`?" not "What does `<name>` do?" Load existing graph context first:
```bash
know get feature:<name>
know graph uses feature:<name>
```
Pass existing entities to QA agents so they don't re-ask what's already captured.

**In Step 4 (Register):** skip 4a (feature entity already exists), skip 4e (cross-graph already set up). Only run 4b–4d to add new entities/references and link them to the existing feature.

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

**Agent 3 — Data Models & Interface References** (→ `data-model:*`, `interface:*`, `api-contract:*` references)
> "You are helping build a spec-graph for a software feature called '[name]'. Generate 5 questions whose answers will directly become `data-model`, `interface`, and `api-contract` reference entries. Ask about: what is the primary data entity this feature creates or modifies and what are its key fields, what does the main API endpoint look like (path, method, request fields, response shape), what does the UI screen or form look like (what fields, labels, and states does the user see), what data must be validated before it is accepted, and what data does this feature expose to other parts of the system. Format as a numbered list. Do NOT ask about scale, load, or performance."

**Agent 4 — Rules, Config & Constraints** (→ `business-logic:*`, `configuration:*`, `security-spec:*`, `constraint:*`, `acceptance-criterion:*` references)
> "You are helping build a spec-graph for a software feature called '[name]'. Generate 5 questions whose answers will directly become `business-logic`, `configuration`, `security-spec`, `constraint`, and `acceptance-criterion` reference entries. Ask about: what are the non-obvious domain rules that govern this feature's behavior (approval gates, conditional logic, state machine rules), what runtime configuration or environment settings does it require, who is allowed to use this feature and under what conditions, what are the hard invariants that must never be violated, and what does 'this feature works correctly' look like from the user's point of view. Format as a numbered list. Do NOT ask about scale, load, or performance."

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

## Data Models & Interfaces  [→ data-model:*, interface:*, api-contract:*]
11. ...
12. ...

## Rules, Config & Constraints  [→ business-logic:*, configuration:*, security-spec:*, constraint:*, acceptance-criterion:*]
16. ...
17. ...

---
_Answers:_
```

**Present questions as interactive multichoice** using AskUserQuestion:

For each section, group the generated questions into an AskUserQuestion call with `multiSelect: true`. Each question becomes a selectable option the user can pick (indicating "this is relevant / I want to answer this"). Include "Other" automatically for custom input.

**Example AskUserQuestion flow:**
1. Present Actions & Operations questions as multichoice: "Which of these aspects apply to your feature?"
2. Present Components & Responsibilities questions as multichoice
3. Present Data Models & Interfaces questions as multichoice
4. Present Rules, Config & Constraints questions as multichoice

For each selected question, follow up with a focused prompt asking the user to elaborate on just that item. This replaces the free-text qa.md dump with a guided, interactive conversation.

**After user responds**: Collect answers from the multichoice selections and follow-up responses. Save to `.ai/know/features/<feature-name>/qa.md`. Proceed to Step 3 with those answers. If the user answers partially, note which areas are unresolved — these become `open-question` references in Step 4.

## 3. Scaffold
- Create directory `.ai/know/features/<feature-name>/`
- Create files from templates:
  - `overview.md` - Populated with answers from Clarify step
  - `todo.md` - Empty checklist
  - `plan.md` - Empty implementation plan
  - `spec.md` - Empty spec file
- Replace `{feature_name}` placeholder in all templates

## 4. Register

Add feature to spec-graph. **Use full QA answers as entity descriptions** — not one-liners.

### 4a. Feature Entity
```bash
know add feature <name> '{"name":"...","description":"<full description from QA, not a summary>"}'
know graph link objective:<name> feature:<name>   # for each objective
know phases add pending feature:<name>
```

### 4b. Entities from QA Answers

For each answered question from Step 2, create the corresponding entity or reference with the **full answer text as the description**. The QA sections map directly:

| QA Section | Graph target | Description source |
|---|---|---|
| Actions & Operations | `action:*`, `operation:*` entities | User's answer about steps, triggers, sub-steps |
| Components & Responsibilities | `component:*` entities | User's answer about responsibilities, I/O, reuse |
| Data Models & Interfaces | `data-model:*`, `interface:*`, `api-contract:*` references | User's answer about schemas, endpoints, UI |
| Rules, Config & Constraints | `business-logic:*`, `constraint:*`, `acceptance-criterion:*` etc. | User's answer about rules, invariants, success criteria |

**Example — answered question becomes a rich entity:**
```bash
# BAD: one-liner description
know add action submit-credentials '{"name":"Submit Credentials","description":"User submits login form"}'

# GOOD: full QA answer as description
know add action submit-credentials '{"name":"Submit Credentials","description":"User enters email and password, clicks submit. System validates format client-side before sending POST /auth/login. On success, receives JWT token and redirects to dashboard. On failure, shows inline error without clearing password field. Rate-limited to 5 attempts per minute per IP."}'
```

Link all created entities to the feature:
```bash
know link feature:<name> action:<a1> action:<a2> component:<c1>  # batch
```

### 4c. Open Questions (unanswered/uncertain QA items)

Any QA question the user skipped, answered partially, or flagged as uncertain becomes an `open-question` reference linked to the entity it would inform:

```bash
# Question about data schema was unanswered
know add open-question <name>-data-schema '{"description":"What fields does the primary data entity require? What are the validation rules per field?"}'
know link feature:<name> open-question:<name>-data-schema

# Question about auth rules was uncertain
know add open-question <name>-permission-model '{"description":"Who can access this feature? Is it role-based or attribute-based? What happens on unauthorized access?"}'
know link action:<relevant-action> open-question:<name>-permission-model
```

**Link open questions to the most specific entity they block**, not just the feature. If a question is about a component's behavior, link it to that component.

### 4d. Reference Enrichment (HITL)

Ask the user which additional reference types apply beyond what was captured from QA. This catches specs that the QA questions didn't cover.

**Present this checklist** (skip types already created in 4b):

| # | Type | Use it when... |
|---|------|----------------|
| 1 | `configuration` | Feature has runtime settings or environment config |
| 2 | `data-model` | Feature defines or uses a data schema |
| 3 | `business-logic` | Feature has non-trivial rules or workflows |
| 4 | `acceptance-criterion` | Feature has specific success criteria |
| 5 | `interface` | Feature has a UI screen or page |
| 6 | `api-contract` | Feature exposes or consumes an API endpoint |
| 7 | `security-spec` | Feature has auth, permissions, or security requirements |
| 8 | `constraint` | Feature has hard limits or invariants |
| 9 | `prompt` | Feature includes AI/LLM prompts (system prompts, templates, instructions) |

**To see all available reference types:**
```bash
know check ref-types                    # table with descriptions
know check ref-types --filter <term>    # filter by name or description
know gen rules describe references      # list type names
know gen rules describe <type>          # detail on a specific type
```

**For each selected type**, ask for the value and create the reference:
```bash
know add <type> <feature>-<type-short> '{"description":"..."}'
know link feature:<name> <type>:<feature>-<type-short>
```

**Do not skip this step.** A feature with no reference dependencies is likely under-specified.

### 4e. Cross-Graph Setup
```bash
# Placeholder code-link in spec-graph (filled during /know:build)
know add code-link <name>-code '{"modules":[],"classes":[],"packages":[],"status":"planned"}'
know link feature:<name> code-link:<name>-code

# Reverse pointer in code-graph
know -g .ai/know/code-graph.json add code-link <name>-spec '{"feature":"feature:<name>","component":"","status":"planned"}'
```

**Note:** Actual module references are added during Phase 5 of `/know:build`.

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
`r11` - Step 1b: append mode for existing features — detect existing/archived, minimal scaffold, scoped QA, skip redundant registration
`r10` - Step 4: codify full QA answers into graph (4b entities, 4c open-questions, 4d enrichment, 4e cross-graph); added open-question reference type
`r9` - Step 2: multichoice QA via AskUserQuestion; Step 4b: added prompt reference type
`r8` - Step 4b: reference lookup now uses `know check ref-types` and `know gen rules describe`
`r7` - Step 2: replaced sparse HITL with 4 parallel Task agents → qa.md (min 16 questions), iterate before scaffold
`r6` - Reference Enrichment phase (4b): HITL checklist + know graph check ref-types; updated cross-graph setup to code-link
`r5` - Added cross-graph setup (implementation references and graph-link stubs)
`r4` - Consolidated to 5 steps with HITL clarification flow
`r3` - Added /know:connect step to ensure graph coverage
`r2`

---
name: Know: Build Feature (7-Phase Workflow)
description: Structured 7-phase workflow for building features with discovery, exploration, design, implementation, and review
category: Know
tags: [know, build, feature-dev, workflow]
---
Build a feature through a structured 7-phase workflow with spec-graph tracking.

**Main Objective**

Guide feature development through a structured 7-phase workflow adapted from Claude Code's feature-dev plugin, integrated with the know ecosystem for spec-graph tracking and documentation.

**Prerequisites**
- Activate the know-tool skill for graph operations

**Exploration Strategy**
- **Use parallel agents** throughout this workflow for speed and depth
- **Explore agent**: Discovers codebase nuances, patterns, and perspectives (use `thoroughness: "medium"` or `"very thorough"`)
- **Custom Task agents**: Create specialized agents with specific objectives
- **Launch in parallel**: Use SINGLE message with multiple Task tool calls to run agents concurrently
- Phases 2, 4, and 6 explicitly require parallel agent launches

**Arguments**: `$ARGUMENTS` — feature name or quoted description (e.g., `/know:build user-auth` or `/know:build "Add user authentication"`)

**Entry Points**

1. **Existing feature**: `/know:build existing-feature` (directory exists at `.ai/know/existing-feature/`)
2. **Inline feature**: `/know:build "Add user authentication"` (no directory yet)

**Initialization Logic**

```
1. Check if feature exists in spec-graph.json:
   IF NOT in graph:
     → Delegate to /know:add (HITL workflow to build proper graph)
     → Wait for completion
     → Continue below

2. Check if feature directory exists (.ai/know/<feature>/):
   IF directory exists:
     → Load context from overview.md, todo.md, plan.md
   ELSE (graph exists, directory doesn't):
     → Create directory: .ai/know/<feature>/
     → Generate overview.md from spec-graph data:
       - name, description from feature entity
       - objectives from graph dependencies
       - users from objective→user chains
     → Create empty todo.md, plan.md
     → Create qa/, architecture/, bugs/, changes/ subdirectories

3. Update meta.phases status to "in-progress"

4. Proceed to Phase 1
```

**Key principle:** Graph is source of truth. Directory is human-level documentation. `/know:build` can work from graph-only state.

---

## 7-Phase Workflow

### Phase 1: Discovery

**Goal**: Clarify requirements and constraints

**Steps**:
1. Read `.ai/know/<feature>/overview.md` if exists
2. Ask clarifying questions:
   - What are the success criteria?
   - What constraints exist?
   - What is out of scope?
   - Who are the users of this feature?
   - What are the edge cases?
3. Update `.ai/know/<feature>/qa/discovery.md` with Q&A
4. Query spec-graph (using **haiku agents**):
   - `know -g .ai/know/spec-graph.json graph uses feature:<name>` - What does this feature depend on?
   - `know -g .ai/know/spec-graph.json graph used-by feature:<name>` - What depends on this feature?
5. Update `.ai/know/<feature>/overview.md` with refined requirements

**Outputs**:
- `.ai/know/<feature>/qa/discovery.md` - Discovery Q&A session
- Updated `.ai/know/<feature>/overview.md`

---

### Phase 2: Codebase Exploration

**Goal**: Understand existing implementation patterns and architecture

**CRITICAL: Use parallel exploration for speed and depth**

**Steps**:
1. **Launch multiple agents in parallel** (single message with multiple Task tool calls):
   - **Explore agent (thoroughness: "medium")**: Discover codebase nuances, patterns, and conventions
   - **Custom Task agents** (2-3 specialized agents):
     - Agent 1: "Find similar features and trace their data flows"
     - Agent 2: "Identify architecture patterns and component boundaries"
     - Agent 3: "Map UI/UX conventions and existing abstractions"
   - Launch ALL agents in a single message for true parallelism
2. **Know-enhanced exploration** (using **haiku agents**):
   - Query code-graph: `know -g .ai/know/code-graph.json list --type module`
   - Find related components via product-component references
   - Query: `know -g .ai/know/code-graph.json graph uses component:<name> --recursive`
3. **Spec-graph exploration** (using **haiku agents**):
   - Query related actions: `know -g .ai/know/spec-graph.json list --type action`
   - Find component dependencies
   - Check data-model references
4. **Search for AI/LLM prompt files** (if feature involves AI):
   - Look for prompt files: `.md`, `.txt`, `.yaml` in `prompts/`, `templates/`, `instructions/` dirs
   - Check for system prompt definitions, prompt templates, or LLM instruction files
   - Note any existing `prompt` references in the spec-graph
5. **Consolidate findings** from all explorers (Explore + custom Task agents)
6. Save to `.ai/know/<feature>/exploration.md`

**Example parallel launch**:
```
Send SINGLE message with:
- Task(subagent_type="Explore", thoroughness="medium", prompt="Explore authentication patterns...")
- Task(subagent_type="general-purpose", prompt="Trace data flow for user sessions...")
- Task(subagent_type="general-purpose", prompt="Identify security middleware patterns...")
```

**Outputs**:
- `.ai/know/<feature>/exploration.md` - Consolidated codebase understanding
- List of files to reference during implementation

---

### Phase 3: Clarifying Questions

**Goal**: Identify and resolve remaining ambiguities

**Steps**:
1. Based on discovery and exploration, identify gaps:
   - Edge cases not yet addressed
   - Error handling approaches
   - Integration points unclear
   - Performance/security considerations
2. Present organized list of questions to user
3. Collect explicit answers (no assumptions)
4. Save to `.ai/know/<feature>/qa/clarification.md`
5. Update spec-graph if new requirements discovered (using **haiku agents**):
   - Add requirement entities if needed
   - Update feature description

**Outputs**:
- `.ai/know/<feature>/qa/clarification.md` - Clarification Q&A
- Updated spec-graph entities (if needed)

---

### Phase 4: Architecture Design

**Goal**: Design implementation approach with trade-off analysis

**CRITICAL: Launch custom Task agents in parallel for multiple perspectives**

**Steps**:
1. **Launch 3 custom Task agents in parallel** (single message with 3 Task tool calls):
   - **Agent 1 (Minimal changes)**: "Design architecture minimizing changes to existing code. Reuse components, avoid refactors. What's the quickest path?"
   - **Agent 2 (Clean architecture)**: "Design ideal architecture ignoring existing code. What's the cleanest, most maintainable approach?"
   - **Agent 3 (Pragmatic balance)**: "Design architecture balancing new patterns with existing code. What's the best trade-off?"
   - Each agent should consult spec-graph and code-graph
   - Launch ALL 3 in a single message for true parallelism
2. **Know-enhanced architecture** - Each agent consults:
   - Spec-graph component dependencies (using **haiku agents**)
   - Data model references from spec-graph
   - Interface definitions
   - Existing component contracts
3. **Consolidate 3 proposals** with trade-off analysis (cost, risk, maintainability, time)
4. **Present recommendation** to user with clear pros/cons
5. **Wait for explicit approval** before proceeding
6. Save chosen architecture to `.ai/know/<feature>/architecture/chosen.md`
7. Save alternatives to `.ai/know/<feature>/architecture/alternatives.md`
8. **Update spec-graph** with architecture (using **haiku agents**, WITH CONFIRMATION):
   - Add/update component entities
   - Add operation entities
   - Link dependencies (feature → action → component → operation)
   - Add references (business-logic, data-models, tech-decisions)

**Outputs**:
- `.ai/know/<feature>/architecture/chosen.md` - Approved architecture
- `.ai/know/<feature>/architecture/alternatives.md` - Other options considered
- Updated spec-graph with architectural entities

---

### Phase 5: Implementation

**Goal**: Build the feature following chosen architecture

**Implementation Workflow**:

1. **Require explicit user approval**: "Ready to implement? [Yes/No]"

2. **Generate XML task spec** (for structured execution):
   ```bash
   know gen spec feature:<name> --format xml > .ai/know/plans/<name>.xml
   ```

   This creates an executable task specification with:
   - **auto** tasks: Can be executed automatically
   - **checkpoint:human-verify** tasks: Require human review after completion
   - **checkpoint:decision** tasks: Require human decision before proceeding
   - **checkpoint:human-action** tasks: Human performs the task

3. **Execute tasks using BuildExecutor**:

   Use the BuildExecutor class to parse and execute the XML spec:

   ```python
   from src.build_executor import BuildExecutor

   # Parse XML spec
   executor = BuildExecutor('.ai/know/plans/<feature>.xml')

   # Display summary
   console.print(executor.get_summary())

   # Get next task
   task = executor.get_next_task()
   ```

   **For each task:**
   - Display task details (operation, files, action, verify, done)
   - If checkpoint task: Stop and wait for user to mark ready
   - If auto task: Execute immediately
   - Track progress in `.ai/know/build-progress.json`

4. **Track and update todo items as you work**:
   - Before starting each task: Read `.ai/know/<feature>/todo.md` to see current checklist
   - Identify which checkbox corresponds to the work you're about to do
   - As you complete each task, edit todo.md to mark it complete
   - Format: Change `- [ ] Task name` to `- [x] Task name`
   - Example: `- [ ] 1. Implement auth handler` becomes `- [x] 1. Implement auth handler`
   - Update immediately after completing each task (don't batch updates)

5. **Checkpoint Handling**:

   When encountering a checkpoint task:
   - Present the task action and verification steps
   - Wait for explicit user confirmation before proceeding
   - Mark task as in-progress: `executor.mark_task_in_progress(task_id)`
   - After user confirms completion, mark complete: `executor.mark_task_completed(task_id)`

6. Update phase status in spec-graph: `"status": "in-progress"` (using **haiku agent**)

7. **Cross-Graph Linking** - As code is written, establish bidirectional spec↔code connections:

   **REQUIRED**: Create code-link refs for every new module/class written during implementation. Do not skip this step.

   **For each new module/package/class:**

   a. **Add to code-graph** with implementation metadata:
   ```bash
   know -g .ai/know/code-graph.json add module <name> '{
     "name": "Module Name",
     "description": "...",
     "file_path": "src/path/to/module.js",
     "implementation_type": "full|partial|stub|aspirational",
     "implementation_status": "complete|in-progress|planned"
   }'
   ```

   **Implementation Types:**
   - `full` - Complete implementation of all functionality
   - `partial` - Some functionality implemented, some pending
   - `stub` - Interface defined, implementation placeholder
   - `aspirational` - Planned but not yet started (preserved during code-graph regeneration)

   b. **Create code-link** in spec-graph linking feature to code entities:
   ```bash
   # Spec-graph: link feature to code entities
   know -g .ai/know/spec-graph.json add code-link <feature>-code '{"modules":["module:<name>"],"classes":[],"status":"in-progress"}'
   know -g .ai/know/spec-graph.json link feature:<name> code-link:<feature>-code
   ```

   c. **Create code-link** in code-graph linking module back to spec:
   ```bash
   # Code-graph: link module back to spec
   know -g .ai/know/code-graph.json add code-link <module>-spec '{"feature":"feature:<name>","component":"component:<component-name>","status":"in-progress"}'
   know -g .ai/know/code-graph.json link module:<name> code-link:<module>-spec
   ```

   d. **Link code entities to components** (if component exists):
   ```bash
   know -g .ai/know/code-graph.json graph link module:<name> component:<component-name>
   ```

   e. **Check cross-graph coverage after linking**:
   ```bash
   # Check cross-graph coverage after linking
   know graph cross coverage --spec-graph .ai/know/spec-graph.json --code-graph .ai/know/code-graph.json
   ```

   f. **Link prompt files** (if feature involves AI/LLM):
   ```bash
   # Create prompt reference linking feature to its prompt files
   know -g .ai/know/spec-graph.json add prompt <feature>-prompt '{"description":"...","file":"prompts/<file>.md"}'
   know -g .ai/know/spec-graph.json link feature:<name> prompt:<feature>-prompt
   ```

   **Aspirational Entities:**
   - Mark planned/future code entities as `"implementation_status": "planned"` and `"aspirational": true`
   - These will be preserved when regenerating code-graph from source code
   - Used for design-ahead: documenting intended architecture before implementation

8. Track implementation in `.ai/know/<feature>/implementation.md`

**Outputs**:
- Implemented code files
- Updated `.ai/know/<feature>/todo.md` with progress
- Updated `.ai/know/<feature>/implementation.md` with notes
- `.ai/know/build-progress.json` - Task execution tracking
- Updated code-graph with new modules
- Phase status: "in-progress" in spec-graph

---

### Phase 6: Quality Review

**Goal**: Validate correctness, quality, and integration

**CRITICAL: Launch custom Task agents in parallel for comprehensive review**

**Steps**:
1. **Launch 3 custom Task agents in parallel** (single message with 3 Task tool calls):
   - **Reviewer 1 (Simplicity)**: "Review for simplicity, DRY violations, over-engineering. Report only high-confidence issues (≥80%)."
   - **Reviewer 2 (Bugs)**: "Review for bugs, edge cases, error handling gaps. Report only high-confidence issues (≥80%)."
   - **Reviewer 3 (Conventions)**: "Review for consistency with existing patterns, naming conventions, architectural violations. Report only high-confidence issues (≥80%)."
   - Launch ALL 3 in a single message for true parallelism
2. **Know-enhanced validation** (using **haiku agents**):
   - Gap analysis: `know -g .ai/know/spec-graph.json graph check gap-analysis feature:<name>`
   - Verify all component dependencies satisfied
   - Check code-graph completeness
   - Validate both graphs: `know graph check validate`
3. Present issues to user with confidence levels
4. User chooses: "Fix now", "Fix later", or "Proceed"
5. Save review to `.ai/know/<feature>/review.md`

**Outputs**:
- `.ai/know/<feature>/review.md` - Quality review findings
- Fixed issues (if "Fix now" chosen)
- Graph validation results

---

### Phase 7: Summary

**Goal**: Document completion and update tracking

**Steps**:
1. Document accomplishments
2. List modified files
3. Note integration points
4. Suggest follow-up tasks
5. **Generate QA_STEPS.md** for end-user testing:
   - Read overview.md (what was requested)
   - Read architecture/chosen.md (what was built)
   - Read implementation.md (how it works)
   - Translate technical implementation into user-facing test steps
   - Create `.ai/know/<feature>/QA_STEPS.md` with:
     - Objective (user perspective)
     - Prerequisites (setup needed)
     - Numbered test steps with expected outcomes
     - Acceptance criteria (clear pass/fail)
   - Use checkbox format for tracking during `/know:review`
6. **Update graphs and regenerate code-graph** (using **haiku agents**):

   a. **Regenerate code-graph automatically**:
   ```bash
   # Scan codebase (detects all modules, classes, functions)
   know gen codemap know/src --output .ai/codemap.json --heat

   # Regenerate code-graph (preserves manual graph-links and aspirational entities)
   know gen code-graph \
     --codemap .ai/codemap.json \
     --existing .ai/know/code-graph.json \
     --output .ai/know/code-graph.json
   ```

   **Note:** If the feature includes AI/LLM prompt files, ensure they are tracked as `prompt` references in the spec-graph. Prompt files (`.md`, `.txt`, `.yaml` in prompt/template dirs) should be linked to the feature via `prompt:<feature>-prompt` references.

   b. **Verify cross-graph links** created during implementation are preserved:
   ```bash
   # Check that feature still shows as implemented
   know -g .ai/know/spec-graph.json feature status feature:<name>
   # Should show: ✅ Implemented: Yes

   # Verify cross-graph links exist
   know graph cross coverage \
     --spec-graph .ai/know/spec-graph.json \
     --code-graph .ai/know/code-graph.json

   # If feature shows 0% spec coverage, run auto-connect before proceeding:
   know graph cross connect feature:<name> \
     --spec-graph .ai/know/spec-graph.json \
     --code-graph .ai/know/code-graph.json
   ```

   **BLOCK RULE**: If `know graph cross coverage` shows 0% spec coverage for this feature → BLOCK phase completion. Run `know graph cross connect feature:<name>` to create links, then re-check.

   c. **Update spec-graph phase status**:
   ```bash
   # Mark as review-ready
   know -g .ai/know/spec-graph.json phases status feature:<name> review-ready
   ```

   d. **Validate both graphs**:
   ```bash
   know -g .ai/know/spec-graph.json graph check validate
   know -g .ai/know/code-graph.json graph check validate
   ```

   e. **Run gap analysis**:
   ```bash
   know -g .ai/know/spec-graph.json graph check gap-summary
   ```
7. Save summary to `.ai/know/<feature>/summary.md`
8. **Inform user**: "Feature complete. Run `/know:review <feature>` to test, or `/know:done` to archive."

**Outputs**:
- `.ai/know/<feature>/summary.md` - Completion summary
- `.ai/know/<feature>/QA_STEPS.md` - End-user test instructions
- Updated spec-graph (feature marked complete/done)
- Validated graphs
- Ready for `/know:review` or `/know:done`

---

## Know Query Agents

**All graph queries use haiku agents for speed and cost efficiency:**

```
Task tool with:
  model: "haiku"
  subagent_type: "general-purpose"
  prompt: "Run this know command and return the output: know -g .ai/know/spec-graph.json graph uses feature:auth"
```

**Common know queries to launch as haiku agents:**
- `know -g .ai/know/spec-graph.json graph uses feature:<name>`
- `know -g .ai/know/spec-graph.json graph used-by feature:<name>`
- `know -g .ai/know/spec-graph.json graph check gap-analysis feature:<name>`
- `know -g .ai/know/spec-graph.json graph check gap-summary`
- `know -g .ai/know/code-graph.json list --type module`
- `know -g .ai/know/code-graph.json graph uses component:<name> --recursive`
- `know graph check validate`

---

## File Structure Created

```
.ai/know/<feature>/
├── overview.md              # Requirements (from /know:add)
├── todo.md                  # Task checklist (updated by /know:review with bugs/changes)
├── plan.md                  # Implementation plan (from /know:add)
├── qa/
│   ├── discovery.md         # Phase 1 Q&A
│   └── clarification.md     # Phase 3 Q&A
├── exploration.md           # Phase 2 findings
├── architecture/
│   ├── chosen.md            # Phase 4 approved design
│   └── alternatives.md      # Phase 4 other options
├── implementation.md        # Phase 5 implementation notes
├── review.md                # Phase 6 quality findings
├── summary.md               # Phase 7 completion summary
├── QA_STEPS.md              # Phase 7 end-user test steps
├── review-results.md        # From /know:review (test execution)
├── review-feedback.md       # From /know:review (summary of issues)
├── bugs/                    # From /know:review (structured bug tracking)
│   ├── 001-description.md
│   └── 002-description.md
├── changes/                 # From /know:review (structured change requests)
│   └── 001-description.md
└── plans/                   # From /know:review (implementation plans for fixes)
    └── review-fixes-YYYYMMDD.md
```

---

## XML Task Specification

The XML spec format (generated with `--format xml`) provides structured, executable task definitions:

**Structure**:
```xml
<spec>
  <meta>
    <feature>feature:auth</feature>
    <name>User Authentication</name>
    <description>...</description>
  </meta>

  <context>
    <feature-context>Requirements and objectives</feature-context>
    <architecture>High-level design approach</architecture>
    <integration>How it connects to existing system</integration>
  </context>

  <dependencies>
    <component>component:auth-handler</component>
    <external-dep>external-dep:jwt</external-dep>
  </dependencies>

  <tasks>
    <task type="checkpoint:human-verify" wave="1">
      <operation>operation:create-auth-module</operation>
      <name>Create Authentication Module</name>
      <files>
        <file>src/auth/handler.js</file>
      </files>
      <action>Detailed implementation instructions...</action>
      <verify>
        <test>npm test -- auth.test.js</test>
        <assertion>All auth tests pass</assertion>
      </verify>
      <done>Module created with passing tests</done>
    </task>
  </tasks>
</spec>
```

**Task Types**:
- **auto** (90%): Execute automatically without user intervention
- **checkpoint:human-verify** (9%): Agent implements, user verifies after completion
- **checkpoint:decision** (0.5%): User makes a decision before proceeding
- **checkpoint:human-action** (0.5%): User performs the task manually

**BuildExecutor API**:
```python
# Initialize
executor = BuildExecutor('.ai/know/plans/feature.xml')

# Get summary
summary = executor.get_summary()  # Returns formatted summary of tasks

# Get next pending task
task = executor.get_next_task()  # Returns None if all complete

# Task structure
{
  'id': 'task-1',
  'type': 'checkpoint:human-verify',
  'wave': 1,
  'operation': 'operation:create-module',
  'name': 'Create Module',
  'files': ['src/module.js'],
  'action': 'Implementation details...',
  'verify': {'test': 'npm test', 'assertion': 'Tests pass'},
  'done': 'Acceptance criteria'
}

# Mark progress
executor.mark_task_in_progress('task-1')
executor.mark_task_completed('task-1')
```

---

## Example Usage

**Existing feature:**
```
User: /know:build user-authentication
Assistant: Found feature at .ai/know/user-authentication/
          Loading context from overview.md...
          Updating phase status to in-progress...

          === Phase 1: Discovery ===
          Let me clarify a few things about user authentication...
```

**Inline feature:**
```
User: /know:build "Add real-time notifications"
Assistant: Feature not found in .ai/know/
          Running /know:add real-time-notifications first...

          [/know:add completes]

          Feature scaffolded. Beginning 7-phase build workflow.

          === Phase 1: Discovery ===
          ...
```

**With XML task execution in Phase 5:**
```
User: /know:build auth
...
          === Phase 5: Implementation ===
          Generating XML task spec...

          ┌─ Task #1: Create Auth Module ──────────────────┐
          │ Type: checkpoint:human-verify | Wave: 1        │
          └────────────────────────────────────────────────┘

          📁 Files:
             • src/auth/handler.js
             • src/auth/middleware.js

          📝 Action:
             Create authentication module with JWT support...
             [detailed implementation steps]

          ✅ Verify:
             Test: npm test -- auth.test.js
             Expected: All tests pass with 100% coverage

          🎯 Done:
             Module created with passing tests

          ──────────────────────────────────────────────────
          ⏸ CHECKPOINT: checkpoint:human-verify

          [Agent implements the task]

          Review the implementation. When ready, confirm to proceed.
```

---

## Notes

- **Graph-first design** - `/know:build` works from spec-graph, with or without `/know:add`
  - If feature in graph but no directory: creates directory from graph data
  - If feature not in graph: delegates to `/know:add` for HITL clarification
  - Directory is human documentation, graph is source of truth
- **Structured workflow** prevents jumping to code prematurely
- **Know integration** ensures spec-graph and code-graph stay synchronized
- **Haiku agents** keep graph queries fast and cost-effective
- **User approval required** at key decision points (architecture, implementation)
- **Resumable** - Can pause and resume at any phase
- **Documentation-driven** - All decisions captured in `.ai/know/<feature>/`
- When complete, use `/know:done` to archive and mark in "done" phase

## Code Graph Regeneration

When regenerating code-graph from source files (e.g., with AST parsers):

**Preserve Aspirational Entities:**
- Before regeneration: `know -g .ai/know/code-graph.json list --type module > aspirational-backup.json`
- Filter for entities with `"aspirational": true` or `"implementation_status": "planned"`
- After regeneration: Re-add aspirational entities that weren't found in source
- Command: `know -g .ai/know/code-graph.json add module <name> <json>`

**Why this matters:**
- Aspirational entities represent planned architecture
- They document design intent before code exists
- Preserving them maintains the spec→code roadmap
- Prevents losing architectural decisions during sync

**Regeneration Strategy:**
```bash
# 1. Backup aspirational entities
know -g .ai/know/code-graph.json search "aspirational.*true" --field aspirational > aspirational.txt

# 2. Regenerate from source (your codemap tool)
./scripts/codemap/generate.sh

# 3. Restore aspirational entities
# (Manual step - read aspirational.txt and re-add planned entities)
```

---
`r5` - Added AI prompt file discovery (Phase 2), prompt reference linking (Phase 5), prompt tracking note (Phase 7)
`r4` - Made cross-graph linking mandatory in Phase 5; added cross-coverage gate to Phase 7; updated to code-link type
`r3` - Graph-first initialization: can work from spec-graph without requiring /know:add first
`r2` - Added implementation types, cross-graph linking, and aspirational entity preservation
`r1` - Initial 7-phase workflow

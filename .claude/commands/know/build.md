---
name: Know: Build Feature (7-Phase Workflow)
description: Structured 7-phase workflow for building features with discovery, exploration, design, implementation, and review
category: Know
tags: [know, build, feature-dev, workflow]
---

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

**Entry Points**

1. **Existing feature**: `/know:build existing-feature` (directory exists at `.ai/know/existing-feature/`)
2. **Inline feature**: `/know:build "Add user authentication"` (no directory yet)

**Initialization Logic**

```
IF feature directory exists (.ai/know/<feature>/):
  → Load context from overview.md, todo.md, plan.md
  → Verify feature exists in spec-graph.json
  → Update meta.phases status to "in-progress"
  → Proceed to Phase 1

ELSE (inline feature description or non-existent feature):
  → Delegate to /know:add to scaffold feature
  → Wait for /know:add completion
  → Load created context
  → Proceed to Phase 1
```

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
   - `know -g .ai/spec-graph.json deps feature:<name>` - What does this feature depend on?
   - `know -g .ai/spec-graph.json used-by feature:<name>` - What depends on this feature?
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
   - Query code-graph: `know -g .ai/code-graph.json list-type module`
   - Find related components via product-component references
   - Query: `know -g .ai/code-graph.json uses component:<name> --recursive`
3. **Spec-graph exploration** (using **haiku agents**):
   - Query related actions: `know -g .ai/spec-graph.json list-type action`
   - Find component dependencies
   - Check data-model references
4. **Consolidate findings** from all explorers (Explore + custom Task agents)
5. Save to `.ai/know/<feature>/exploration.md`

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
   - Add references (business_logic, data-models, tech-decisions)

**Outputs**:
- `.ai/know/<feature>/architecture/chosen.md` - Approved architecture
- `.ai/know/<feature>/architecture/alternatives.md` - Other options considered
- Updated spec-graph with architectural entities

---

### Phase 5: Implementation

**Goal**: Build the feature following chosen architecture

**Steps**:
1. **Require explicit user approval**: "Ready to implement? [Yes/No]"
2. Read all relevant files from exploration phase
3. Follow chosen architecture strictly
4. **Track and update todo items as you work**:
   - Before starting each task: Read `.ai/know/<feature>/todo.md` to see current checklist
   - Identify which checkbox corresponds to the work you're about to do
   - As you complete each task, edit todo.md to mark it complete
   - Format: Change `- [ ] Task name` to `- [x] Task name`
   - Example: `- [ ] 1. Implement auth handler` becomes `- [x] 1. Implement auth handler`
   - Update immediately after completing each task (don't batch updates)
5. Update phase status in spec-graph: `"status": "in-progress"` (using **haiku agent**)
6. As code is written, link modules to spec-graph components:
   - Add to code-graph: `know -g .ai/code-graph.json add module <name> {...}`
   - Link via product-component references
7. Track implementation in `.ai/know/<feature>/implementation.md`

**Outputs**:
- Implemented code files
- Updated `.ai/know/<feature>/todo.md` with progress
- Updated `.ai/know/<feature>/implementation.md` with notes
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
   - Gap analysis: `know -g .ai/spec-graph.json gap-analysis feature:<name>`
   - Verify all component dependencies satisfied
   - Check code-graph completeness
   - Validate both graphs: `know validate`
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
6. **Update spec-graph** (using **haiku agents**):
   - Mark feature phase as "complete" (or move to "done" if fully deployed)
   - Update code-graph with all new modules
   - Validate both graphs
   - Run gap-summary: `know -g .ai/spec-graph.json gap-summary`
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
  prompt: "Run this know command and return the output: know -g .ai/spec-graph.json deps feature:auth"
```

**Common know queries to launch as haiku agents:**
- `know -g .ai/spec-graph.json deps feature:<name>`
- `know -g .ai/spec-graph.json used-by feature:<name>`
- `know -g .ai/spec-graph.json gap-analysis feature:<name>`
- `know -g .ai/spec-graph.json gap-summary`
- `know -g .ai/code-graph.json list-type module`
- `know -g .ai/code-graph.json uses component:<name> --recursive`
- `know validate`

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

---

## Notes

- **Structured workflow** prevents jumping to code prematurely
- **Know integration** ensures spec-graph and code-graph stay synchronized
- **Haiku agents** keep graph queries fast and cost-effective
- **User approval required** at key decision points (architecture, implementation)
- **Resumable** - Can pause and resume at any phase
- **Documentation-driven** - All decisions captured in `.ai/know/<feature>/`
- When complete, use `/know:done` to archive and mark in "done" phase

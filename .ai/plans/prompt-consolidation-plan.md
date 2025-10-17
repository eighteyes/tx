# Prompt Consolidation Plan

**Created:** 2025-10-17
**Purpose:** Eliminate duplicated instructions across 76 agent prompts by creating shared documentation
**Analysis Source:** `agent-prompt-pattern-analysis.md`

---

## Problem Statement

Analysis of all 76 agent prompts revealed **massive duplication**:
- ~5,000+ lines of duplicated instructional content
- Same concepts explained 40-76 times across different prompts
- Maintenance nightmare - updating one pattern requires changing dozens of files
- Inconsistencies creeping in due to copy/paste variations

## Goal

Create a **single source of truth** for common concepts that all agent prompts can reference.

**Target Outcomes:**
- Reduce duplicated content by 90% (~5,000 lines → ~500 lines in shared docs)
- Reduce average prompt length by 60% (250 lines → 100 lines)
- Improve maintainability - update once, applies everywhere
- Ensure consistency across all agents
- Simplify creating new agents

---

## Phase 1: High-Impact Extractions (Priority 1)

Create these shared documentation files first - they eliminate the most duplication.

### 1. `meshes/docs/cognitive-styles.md`

**Duplication:** 76/76 agents (100%)
**Lines Saved:** ~600+

**Content:**
- Define all 9 cognitive archetypes once:
  - Aegis the Synthesizer
  - Cipher the Analyst
  - Drift the Explorer
  - Ember the Pragmatist
  - Scry the Skeptic
  - Sift the Empiricist
  - Cleave the Fragmenter
  - Codex the Specialist
  - Forge the Builder
- Standard traits for each archetype
- When to use each cognitive style

**Prompt Update:**
```markdown
You embody **Cipher the Analyst**. See [cognitive-styles.md](#cipher-the-analyst) for cognitive traits.
```

### 2. `meshes/docs/message-format.md`

**Duplication:** 60/76 agents (79%)
**Lines Saved:** ~900+

**Content:**
- Standard frontmatter fields and their meanings
- Common frontmatter patterns:
  - `from:` - Source agent
  - `to:` - Target (mesh, agent, core)
  - `type:` - Message types (task, task-complete, ask, respond, etc.)
  - `task-status:` - Status values
  - `priority:` - Priority levels
- Specialized frontmatter by mesh type:
  - Research: `debate_file:`, `gate:`, `round:`
  - MAP: `iteration:`, `request-id:`
  - Test: `test:` field preservation
- Routing patterns and examples

**Prompt Update:**
```markdown
## Message Format
See [message-format.md](../docs/message-format.md) for frontmatter structure.

**Agent-specific fields:**
- `custom_field`: [purpose]
```

### 3. `meshes/docs/workflow-patterns.md`

**Duplication:** 50/76 agents (66%)
**Lines Saved:** ~1,000+

**Content:**
- Inbox/outbox mechanics
- Workflow types:
  - Sequential (pass-through)
  - Parallel (independent)
  - Convergence (conditional loop)
  - Self-iteration
  - Conditional branching
- How to route messages to next agent
- How to complete workflow (to: mesh)
- Position in workflow (e.g., "Agent 3/5")

**Prompt Update:**
```markdown
## Workflow
This agent uses **sequential** workflow. See [workflow-patterns.md](../docs/workflow-patterns.md#sequential) for mechanics.

**Position:** 3/5 in doc-generator workflow
**Previous agent:** concept-extractor
**Next agent:** example-generator
```

### 4. `meshes/docs/file-system.md`

**Duplication:** 40/76 agents (53%)
**Lines Saved:** ~600+

**Content:**
- Standard directory structure
- Allowed directories:
  - Agent workspace: `.ai/tx/mesh/{mesh}/agents/{agent}/`
  - Shared workspace: `.ai/tx/mesh/{mesh}/shared/`
  - Full codebase read access
- Message directories (inbox, outbox, complete)
- Common file naming conventions

**Prompt Update:**
```markdown
## File System
See [file-system.md](../docs/file-system.md) for directory structure.
```

### 5. `meshes/docs/workspace-patterns.md`

**Duplication:** 40/76 agents (53%)
**Lines Saved:** ~400+

**Content:**
- Workspace layouts by mesh type:
  - Research workspace pattern
  - Test workspace pattern
  - Interactive prototyper pattern
  - MAP workspace pattern
  - Doc generator pattern
- When to use shared vs. agent-specific directories

**Prompt Update:**
```markdown
## Workspace
See [workspace-patterns.md](../docs/workspace-patterns.md#research) for your workspace layout.
```

**Phase 1 Total Impact:** ~3,500 lines eliminated

---

## Phase 2: Medium-Impact Extractions (Priority 2)

### 6. `meshes/docs/capabilities/` directory

**Duplication:** 45/76 agents (59%)
**Lines Saved:** ~900+

Create separate files for each capability:

#### `capabilities/ask.md`
- Complete ask workflow
- When to use ask
- Message format for ask
- Waiting for responses
- MAP Human Consultant detailed ask protocol

#### `capabilities/respond.md`
- How to respond to ask messages
- Response format
- Referencing original question

#### `capabilities/search.md`
- Search capability usage
- Finding GitHub repos, docs, discussions
- Search best practices

#### `capabilities/spawn.md`
- How to spawn new meshes dynamically
- When to use spawn
- Mesh lifecycle management

**Prompt Update:**
```markdown
## Capabilities
You have access to:
- **ask** - See [capabilities/ask.md](../docs/capabilities/ask.md)
- **search** - See [capabilities/search.md](../docs/capabilities/search.md)
```

### 7. `meshes/docs/completion-patterns.md`

**Duplication:** 65/76 agents (86%)
**Lines Saved:** ~650+

**Content:**
- Standard completion: `tx done`
- Final agent completion (to: mesh)
- Intermediate agent routing (to: next-agent)
- Conditional completion (converged vs. continue)
- Test agent completion (route to sender)

**Prompt Update:**
```markdown
## Completion
See [completion-patterns.md](../docs/completion-patterns.md#final-agent).
```

### 8. `meshes/docs/tools/` directory

**Duplication:** 30/76 agents (39%)
**Lines Saved:** ~450+

#### `tools/tx-commands.md`
- All tx commands documented
- tx done, tx spawn, tx status, tx tool
- When to use each

#### `tools/evaluation.md`
- Evaluation tool suite
- Peer review, consensus, debate tools

**Prompt Update:**
```markdown
## Tools
See [tools/tx-commands.md](../docs/tools/tx-commands.md) for available commands.
```

### 9. `meshes/docs/research/debate-system.md`

**Duplication:** 3/76 agents (4% but 100% duplicated among those 3)
**Lines Saved:** ~240+

**Content:**
- Complete debate.json documentation
- Claim/challenge lifecycle
- Convergence criteria
- Round limits and resolution
- Used by: deep-researcher, research-disprover, validator

**Prompt Update:**
```markdown
## Debate Tracking
See [research/debate-system.md](../docs/research/debate-system.md) for complete documentation.
```

**Phase 2 Total Impact:** ~2,240 lines eliminated

---

## Phase 3: Templates and Standards (Priority 3)

### 10. Error Handling Patterns

**Duplication:** 35/76 agents (46%)
**Lines Saved:** ~350+

Create `meshes/docs/error-handling.md`:
- When to ask for help
- Handling blockers
- Escalation paths
- Error scenarios

### 11. Convergence Patterns

**Duplication:** 10/76 agents (13%)
**Lines Saved:** ~200+

Create `meshes/docs/convergence-patterns.md`:
- Research convergence criteria
- Gate convergence (validation gates)
- Test convergence
- Iteration limits

### 12. Agent Prompt Template

Create `meshes/docs/agent-prompt-template.md`:

```markdown
# [Agent Name]

You embody [Archetype Name]. See [cognitive-styles.md](#archetype-anchor).

## Your Role
[Agent-specific description - this is unique per agent]

## Workspace
See [workspace-patterns.md](../docs/workspace-patterns.md#pattern-type).

## Message Format
See [message-format.md](../docs/message-format.md).

**Agent-specific frontmatter fields:**
- `field1`: [purpose]

## Workflow
This agent uses [workflow-type]. See [workflow-patterns.md](../docs/workflow-patterns.md#workflow-type).

**Workflow details:**
- Position: X/N
- Previous agent: [name]
- Next agent: [name]

## Capabilities
You have access to:
- **capability1** - See [capabilities/capability1.md](../docs/capabilities/capability1.md)

## Completion
See [completion-patterns.md](../docs/completion-patterns.md#agent-type).

## [Agent-Specific Sections]
[All unique logic and instructions go here]

## Quality Standards
[Agent-specific criteria]

## Remember
[Agent-specific reminders]
```

---

## Implementation Strategy

### Step 1: Create Shared Documentation (1-2 days)

1. Create directory structure:
   ```bash
   mkdir -p meshes/docs/capabilities
   mkdir -p meshes/docs/tools
   mkdir -p meshes/docs/research
   ```

2. Implement Phase 1 docs first (highest impact)
3. Then Phase 2 docs
4. Then Phase 3 templates

### Step 2: Update Agent Prompts (1-2 days)

For each of 76 agents:
1. Identify duplicated sections
2. Replace with references to shared docs
3. Keep only agent-specific content
4. Verify references are correct

### Step 3: Validation (0.5 days)

1. Check all references resolve correctly
2. Ensure no functionality lost
3. Test sample agents to confirm they still work
4. Verify shared docs cover all variations

### Step 4: Documentation (0.5 days)

1. Update `docs/building-meshes-and-agents.md`
2. Add note about referencing shared docs
3. Create migration guide for updating old prompts

---

## Estimated Impact

### Before Consolidation
- **Total content:** ~19,000 lines (76 prompts × ~250 lines average)
- **Duplicated content:** ~5,000 lines
- **Unique content:** ~14,000 lines

### After Consolidation
- **Shared docs:** ~500 lines (created once)
- **Unique content:** ~14,000 lines (unchanged)
- **Total content:** ~14,500 lines
- **Reduction:** ~4,500 lines (24% overall reduction)

### Per-Agent Impact
- **Before:** ~250 lines per prompt (average)
- **After:** ~100 lines per prompt (average)
- **Reduction:** 60% per prompt

### Maintenance Benefits
- **Update common pattern:** 1 file instead of 40-76 files
- **Create new agent:** Reference existing docs, write only unique logic
- **Consistency:** All agents automatically use same patterns
- **Onboarding:** New developers learn patterns once

---

## Risks and Mitigations

### Risk: Broken References
**Mitigation:** Create validation script to check all doc references resolve

### Risk: Lost Functionality
**Mitigation:** Thorough testing before/after, keep git history for rollback

### Risk: Over-Abstraction
**Mitigation:** Keep agent-specific logic in prompts, only extract truly common patterns

### Risk: Adoption
**Mitigation:** Update template first, new agents automatically use pattern, migrate old agents gradually

---

## Success Criteria

- [ ] All Phase 1 shared docs created
- [ ] All Phase 2 shared docs created
- [ ] At least 50% of agents updated to use shared docs
- [ ] No loss of functionality in updated agents
- [ ] All references validate correctly
- [ ] Documentation updated with new pattern
- [ ] Template created for new agents

---

## Next Steps

1. **Review this plan** with team/user
2. **Prioritize** which phases to implement first
3. **Create Phase 1 docs** (cognitive-styles, message-format, workflow-patterns, file-system, workspace-patterns)
4. **Pilot test** by updating 5 sample agents from different categories
5. **Validate** pilot agents work correctly
6. **Roll out** to remaining agents if successful
7. **Update** documentation and templates

---

## Estimated Effort

**Total Time:** 2-3 days
- Phase 1 implementation: 1 day
- Phase 2 implementation: 1 day
- Prompt updates (all 76): 1 day (parallelizable)
- Validation and docs: 0.5 days

**Ongoing Benefit:** Permanent reduction in maintenance overhead, improved consistency, easier onboarding

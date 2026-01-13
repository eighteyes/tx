# Implementation Plan: Fix Mechanical Issues from Mesh Audit

**Created**: 2026-01-13
**Status**: In Progress
**Total Issues**: 157 mechanical issues across 21 meshes

---

## Phase 1: Critical Issues (8 items)

### Task 1.1: code-review-ensemble - Add aggregation_strategy
- **File**: `meshes/code-review-ensemble/config.yaml`
- **Issue**: Missing required `aggregation_strategy` field in ensemble config
- **Fix**: Add `aggregation_strategy: concat` to ensemble config block
- **Status**: Complete (2026-01-13) - Already present in config

### Task 1.2: ensemble-research - Add coordinator and reviewer
- **File**: `meshes/ensemble-research/config.yaml`
- **Issue**: Missing required `coordinator` and `reviewer` fields
- **Fix**: Add coordinator and reviewer agent definitions to ensemble config
- **Status**: Complete (2026-01-13) - Fixed in commit 021630a

### Task 1.3: dev-graded - Remove outdated worktree section
- **File**: `meshes/dev-graded/prompt.md`
- **Issue**: Outdated worktree instructions with non-existent template variables (lines 64-87)
- **Fix**: Remove or replace outdated worktree section
- **Status**: Complete (2026-01-13) - Fixed in commit 021630a

### Task 1.4: ralph-ice-cream - Add rearmatter configuration
- **File**: `meshes/ralph-ice-cream/config.yaml`
- **Issue**: Missing rearmatter configuration (FSM reads it but not defined)
- **Fix**: Add rearmatter configuration block with success_signal field
- **Status**: Complete (2026-01-13) - Fixed in commit 021630a

### Task 1.5: ralph-ice-cream-3 - Fix markdown formatting
- **File**: `meshes/ralph-ice-cream-3/sonnet-reviewer/build.md`
- **Issue**: Broken markdown (missing closing backticks)
- **Fix**: Fix markdown code block formatting
- **Status**: Complete (2026-01-13) - Fixed in commit 021630a

### Task 1.6: task-distribution-analysis - Remove malformed directory
- **File**: `meshes/task-distribution-analysis/{prompts}/`
- **Issue**: Malformed empty '{prompts}/' directory exists
- **Fix**: Remove malformed directory
- **Status**: Complete (2026-01-13) - Removed in this session

### Task 1.7: test - Update timestamp formats
- **Files**: `meshes/test/*.md` (5 instances across 4 files)
- **Issue**: Outdated timestamp format without milliseconds
- **Fix**: Update all timestamps to millisecond precision format
- **Status**: Complete (2026-01-13) - Fixed in commit 225504d

### Task 1.8: brain - Remove dead /know:validate reference
- **File**: `meshes/brain/config.yaml`
- **Issue**: Dead reference to non-existent `/know:validate` command (lines 55-61)
- **Fix**: Replace /know:validate with /know:build
- **Status**: Complete (2026-01-13) - Fixed in commit 225504d

---

## Phase 2: Dead References (28 items)

### Task 2.1: research - Remove disprover references
- **Files**: Multiple prompts in `meshes/research/`
- **Issue**: 5 references to non-existent 'disprover' agent
- **Fix**: Remove all disprover/deep-research workflow references
- **Status**: Pending

### Task 2.2: research - Remove non-existent file references
- **Files**: `meshes/research/*.md`
- **Issue**: References to non-existent 04-counterpoints.md, 03-theories.md
- **Fix**: Remove references to these files
- **Status**: Pending

### Task 2.3: dev - Remove brain agent references
- **File**: `meshes/dev/prompt.md`
- **Issue**: References brain agent without routing configuration
- **Fix**: Remove brain references or add routing config
- **Status**: Pending

### Task 2.4: dev-graded - Remove brain agent references
- **File**: `meshes/dev-graded/prompt.md`
- **Issue**: Dead reference to brain agent without routing
- **Fix**: Remove brain references or add routing config
- **Status**: Pending

### Task 2.5: ralph-ice-cream - Fix invalid routing
- **Files**: `meshes/ralph-ice-cream/*.md`
- **Issue**: Sonnet can't route back to haiku per FSM
- **Fix**: Remove invalid routing option or document FSM support
- **Status**: Pending

### Task 2.6: narrative-engine - Fix bash script references
- **Files**: Various prompts in `meshes/narrative-engine/`
- **Issue**: Dead references to non-existent bash scripts (2 instances)
- **Fix**: Use inline commands instead of referencing non-existent scripts
- **Status**: Pending

### Task 2.7: dev-haiku - Fix script naming mismatch
- **Files**: `meshes/dev-haiku/config.yaml`, `README.md`, 3 agent prompts
- **Issue**: Config uses underscores but docs use hyphens (9 instances)
- **Fix**: Standardize on underscore naming matching config.yaml
- **Status**: Pending

### Task 2.8: test - Remove unused worker agent
- **File**: `meshes/test/config.yaml`
- **Issue**: Worker agent defined but never used
- **Fix**: Remove unused worker agent or fix entry point
- **Status**: Pending

### Task 2.9: task-distribution-analysis - Fix description naming
- **File**: `meshes/task-distribution-analysis/config.yaml`
- **Issue**: Description references 'spawner' but agent is 'analyst'
- **Fix**: Update description to reference correct agent name
- **Status**: Pending

---

## Phase 3: Missing Required Fields (23 items)

### Task 3.1: brain - Add routing configuration
- **File**: `meshes/brain/config.yaml`
- **Issue**: Missing routing configuration
- **Fix**: Add routing rules for message handling
- **Status**: Pending

### Task 3.2: brain - Add completion_agent
- **File**: `meshes/brain/config.yaml`
- **Issue**: Missing completion_agent field
- **Fix**: Add completion_agent specification
- **Status**: Pending

### Task 3.3: dev - Add routing configuration
- **File**: `meshes/dev/config.yaml`
- **Issue**: Missing routing configuration
- **Fix**: Add routing for multi-agent communication
- **Status**: Pending

### Task 3.4: dev-graded - Add routing configuration
- **File**: `meshes/dev-graded/config.yaml`
- **Issue**: Missing routing configuration
- **Fix**: Add routing rules
- **Status**: Pending

### Task 3.5: dev-worktree - Add routing configuration
- **File**: `meshes/dev-worktree/config.yaml`
- **Issue**: Missing routing configuration
- **Fix**: Add routing rules
- **Status**: Pending

### Task 3.6: ensemble-research - Add routing configuration
- **File**: `meshes/ensemble-research/config.yaml`
- **Issue**: Missing routing configuration
- **Fix**: Define routing rules
- **Status**: Pending

### Task 3.7: ensemble-research - Add completion_agent
- **File**: `meshes/ensemble-research/config.yaml`
- **Issue**: Missing completion_agent specification
- **Fix**: Specify completion_agent
- **Status**: Pending

### Task 3.8: hybrid-workflow - Add allow_partial_failure
- **File**: `meshes/hybrid-workflow/config.yaml`
- **Issue**: Missing allow_partial_failure field for both patterns
- **Fix**: Add allow_partial_failure configuration
- **Status**: Pending

### Task 3.9: hybrid-workflow - Add routing configuration
- **File**: `meshes/hybrid-workflow/config.yaml`
- **Issue**: No routing configuration for multi-agent coordination
- **Fix**: Define routing rules for hybrid pattern
- **Status**: Pending

### Task 3.10: hybrid-workflow - Add completion_agent
- **File**: `meshes/hybrid-workflow/config.yaml`
- **Issue**: No completion_agent specified
- **Fix**: Specify completion_agent: synthesizer
- **Status**: Pending

### Task 3.11: system/commit-agent - Add routing configuration
- **File**: `meshes/system/commit-agent/config.yaml`
- **Issue**: Missing routing configuration
- **Fix**: Add routing for completion/blocked status
- **Status**: Pending

### Task 3.12: structured-thinking - Add workspace field
- **File**: `meshes/structured-thinking/config.yaml`
- **Issue**: Missing workspace field (unlike other ephemeral meshes)
- **Fix**: Add workspace configuration
- **Status**: Pending

### Task 3.13: structured-thinking - Fix rearmatter mismatch
- **File**: `meshes/structured-thinking/config.yaml` or `thinker/prompt.md`
- **Issue**: 'recommendation' in prompt but not in config
- **Fix**: Add 'recommendation' to rearmatter fields or remove from prompt
- **Status**: Pending

---

## Phase 4: Formatting Issues (35 items)

### Task 4.1: brain - Fix malformed markdown code block
- **File**: `meshes/brain/prompt.md`
- **Issue**: Malformed markdown code block (lines 73-77)
- **Fix**: Fix code block formatting
- **Status**: Pending

### Task 4.2: code-review-ensemble - Fix code block formatting
- **File**: `meshes/code-review-ensemble/prompts/entry.md`
- **Issue**: Code block missing language specifier
- **Fix**: Add language specifier to code blocks
- **Status**: Pending

### Task 4.3: code-review-ensemble - Fix title formatting
- **File**: `meshes/code-review-ensemble/prompts/synthesizer.md`
- **Issue**: Inconsistent title formatting
- **Fix**: Standardize title format
- **Status**: Pending

### Task 4.4: code-review-ensemble - Reorder config fields
- **File**: `meshes/code-review-ensemble/config.yaml`
- **Issue**: Inconsistent field ordering
- **Fix**: Reorder fields to match documentation pattern
- **Status**: Pending

### Task 4.5: deep-research - Standardize confidence values
- **Files**: Multiple prompts in `meshes/deep-research/`
- **Issue**: Inconsistent confidence formatting (95% vs 0.95)
- **Fix**: Standardize to decimal format
- **Status**: Pending

### Task 4.6: deep-research - Standardize CRITICAL markers
- **Files**: Multiple prompts in `meshes/deep-research/`
- **Issue**: Inconsistent CRITICAL marker formatting
- **Fix**: Standardize CRITICAL marker formatting
- **Status**: Pending

### Task 4.7: deep-research - Standardize date formats
- **Files**: Multiple prompts in `meshes/deep-research/`
- **Issue**: Date format inconsistency in file naming conventions
- **Fix**: Standardize date formats
- **Status**: Pending

### Task 4.8: dev - Fix numbered list sequence
- **File**: `meshes/dev/prompt.md`
- **Issue**: List skips from step 3 to step 5 (missing step 4)
- **Fix**: Fix numbered list sequence
- **Status**: Pending

### Task 4.9: dev-mesh - Fix YAML code blocks
- **Files**: Multiple prompts in `meshes/dev-mesh/`
- **Issue**: Code blocks use ```yaml but contain markdown
- **Fix**: Change language from yaml to markdown
- **Status**: Pending

### Task 4.10: dev-mesh - Fix markdown table formatting
- **Files**: Prompts in `meshes/dev-mesh/`
- **Issue**: Broken markdown table formatting
- **Fix**: Fix table formatting
- **Status**: Pending

### Task 4.11: narrative-engine - Fix typo in config
- **File**: `meshes/narrative-engine/config.yaml`
- **Issue**: "Statless" should be "Stateless"
- **Fix**: Fix typo
- **Status**: Pending

### Task 4.12: narrative-engine - Fix routing section titles
- **Files**: Various in `meshes/narrative-engine/`
- **Issue**: Inconsistent routing documentation (4 instances)
- **Fix**: Update section titles to match actual config
- **Status**: Pending

### Task 4.13: ralph-ice-cream-2 - Fix frontmatter examples
- **Files**: Multiple in `meshes/ralph-ice-cream-2/`
- **Issue**: Missing BLOCKED option in frontmatter signal examples
- **Fix**: Add BLOCKED to frontmatter examples
- **Status**: Pending

### Task 4.14: ralph-ice-cream-2 - Standardize model naming
- **Files**: `meshes/ralph-ice-cream-2/config.yaml`
- **Issue**: Model naming inconsistency (shorthand vs full names)
- **Fix**: Document and standardize model naming convention
- **Status**: Pending

### Task 4.15: ralph-ice-cream-3 - Clarify entry_point
- **File**: `meshes/ralph-ice-cream-3/config.yaml`
- **Issue**: entry_point field misleading (FSM uses mode_router)
- **Fix**: Remove or clarify entry_point field
- **Status**: Pending

### Task 4.16: ralph-ice-cream-3 - Document completion paths
- **File**: `meshes/ralph-ice-cream-3/config.yaml` or AGENTS.md
- **Issue**: completion_agent incomplete (only shows one path)
- **Fix**: Document dual completion paths
- **Status**: Pending

### Task 4.17: ralph-loop - Fix YAML indentation
- **File**: `meshes/ralph-loop/config.yaml`
- **Issue**: Inconsistent YAML indentation
- **Fix**: Standardize YAML indentation
- **Status**: Pending

### Task 4.18: ralph-loop - Standardize phase formatting
- **Files**: Agent prompts in `meshes/ralph-loop/`
- **Issue**: Inconsistent phase header formatting
- **Fix**: Standardize phase formatting
- **Status**: Pending

### Task 4.19: ralph-loop - Fix grammar
- **Files**: Agent prompts in `meshes/ralph-loop/`
- **Issue**: Missing question mark in decision tree
- **Fix**: Add missing punctuation
- **Status**: Pending

### Task 4.20: structured-thinking - Standardize formatting
- **File**: `meshes/structured-thinking/thinker/prompt.md`
- **Issue**: Inconsistent formatting (arrow symbols vs bullets)
- **Fix**: Standardize to bullets
- **Status**: Pending

### Task 4.21: test - Standardize emoji usage
- **Files**: Multiple in `meshes/test/`
- **Issue**: Emoji usage inconsistency
- **Fix**: Standardize to markdown checkboxes
- **Status**: Pending

---

## Phase 5: Redundancy Issues (21 items)

### Task 5.1: brain - Consolidate redundant sections
- **File**: `meshes/brain/prompt.md`
- **Issue**: Redundant instructions in multiple sections
- **Fix**: Consolidate redundant task handling sections
- **Status**: Pending

### Task 5.2: deep-research - Consolidate request sections
- **Files**: Multiple agent prompts in `meshes/deep-research/`
- **Issue**: Redundant "Request Additional Research" sections
- **Fix**: Consolidate into single reference
- **Status**: Pending

### Task 5.3: dev-mesh - Add output format templates
- **Files**: `meshes/dev-mesh/frontend.md`, `ui-components.md`
- **Issue**: Missing structured output format templates
- **Fix**: Add output format templates for consistency
- **Status**: Pending

### Task 5.4: ralph-ice-cream-2 - Remove redundant sections
- **File**: `meshes/ralph-ice-cream-2/AGENTS.md`
- **Issue**: Redundancy in frontmatter section
- **Fix**: Remove redundant sections
- **Status**: Pending

### Task 5.5: ralph-loop - Remove redundant Phase 4 details
- **File**: `meshes/ralph-loop/AGENTS.md` or agent prompts
- **Issue**: Redundancy between AGENTS.md and detailed prompts
- **Fix**: Remove redundant Phase 4 details
- **Status**: Pending

### Task 5.6: structured-thinking - Reduce tool instruction redundancy
- **File**: `meshes/structured-thinking/thinker/prompt.md`
- **Issue**: Minor redundancy in tool instructions
- **Fix**: Consolidate redundant tool instructions
- **Status**: Pending

---

## Phase 6: Path and Variable Issues (17 items)

### Task 6.1: brain - Clarify workspace paths
- **File**: `meshes/brain/prompt.md`
- **Issue**: References 'workspace' without clarifying actual path
- **Fix**: Document workspace path variables
- **Status**: Pending

### Task 6.2: dev-worktree - Clarify workspace variables
- **File**: `meshes/dev-worktree/prompt.md`
- **Issue**: Uses {task-id} but hooks expect featureName
- **Fix**: Clarify workspace variable usage
- **Status**: Pending

### Task 6.3: ralph-ice-cream - Document $workspace variable
- **Files**: All prompts in `meshes/ralph-ice-cream/`
- **Issue**: Undefined $workspace variable in all prompts
- **Fix**: Document $workspace variable
- **Status**: Pending

### Task 6.4: ralph-ice-cream - Add workspace.structure
- **Files**: `meshes/ralph-ice-cream/config.yaml` or prompts
- **Issue**: Missing workspace.structure documentation
- **Fix**: Add workspace.structure like ralph-loop
- **Status**: Pending

### Task 6.5: research - Document workspace path variables
- **Files**: Multiple in `meshes/research/`
- **Issue**: Undefined placeholders in workspace paths
- **Fix**: Document workspace path variables
- **Status**: Pending

### Task 6.6: narrative-engine - Add workspace path handling
- **File**: `meshes/narrative-engine/narrator.md` or similar
- **Issue**: Missing workspace path context
- **Fix**: Add workspace path handling guidance
- **Status**: Pending

---

## Phase 7: Outdated Patterns (18 items)

### Task 7.1: dev-mesh - Update message type
- **File**: `meshes/dev-mesh/coordinator.md` or similar
- **Issue**: Uses 'task-complete' instead of 'complete'
- **Fix**: Update message type to 'complete'
- **Status**: Pending

### Task 7.2: dev-worktree - Update command syntax
- **File**: `meshes/dev-worktree/prompt.md`
- **Issue**: Command syntax inconsistency for /know:done
- **Fix**: Update command syntax documentation
- **Status**: Pending

### Task 7.3: research - Verify ask-response pattern
- **Files**: Prompts in `meshes/research/`
- **Issue**: Outdated ask-response message pattern
- **Fix**: Verify and update if incompatible
- **Status**: Pending

### Task 7.4: ralph-ice-cream-2 - Clarify max iteration behavior
- **Files**: Config or AGENTS.md in `meshes/ralph-ice-cream-2/`
- **Issue**: Max iteration behavior inconsistency
- **Fix**: Clarify max iteration behavior
- **Status**: Pending

### Task 7.5: ralph-ice-cream-2 - Fix informal phrasing
- **File**: `meshes/ralph-ice-cream-2/opus-reviewer/prompt.md`
- **Issue**: Informal phrasing in opus-reviewer
- **Fix**: Use formal/professional language
- **Status**: Pending

### Task 7.6: ralph-loop - Verify 'mode' field
- **File**: `meshes/ralph-loop/config.yaml`
- **Issue**: Missing field verification ('mode' in rearmatter)
- **Fix**: Verify 'mode' field intention
- **Status**: Pending

### Task 7.7: system/commit-agent - Clarify output pattern
- **File**: `meshes/system/commit-agent/prompt.md`
- **Issue**: Inconsistent pattern about reporting results
- **Fix**: Clarify if output is for logs or messaging
- **Status**: Pending

### Task 7.8: test - Add directory instructions
- **Files**: Multiple prompts in `meshes/test/` (3 instances)
- **Issue**: Missing .ai/tx/msgs/ directory instructions
- **Fix**: Add directory instructions to all prompts
- **Status**: Pending

### Task 7.9: test - Remove redundant prompt.md
- **File**: `meshes/test/prompt.md`
- **Issue**: Redundant prompt.md doesn't match workflow
- **Fix**: Remove or update to match current workflow
- **Status**: Pending

---

## Phase 8: Grammar and Clarity (15 items)

### Task 8.1: ensemble-research - Clarify input format
- **Files**: Prompts in `meshes/ensemble-research/`
- **Issue**: Vague prompt instructions about input format
- **Fix**: Update prompts with concrete input/output formats
- **Status**: Pending

### Task 8.2: hybrid-workflow - Document workflow integration
- **Files**: Create `meshes/hybrid-workflow/AGENTS.md`
- **Issue**: Unclear workflow integration between patterns
- **Fix**: Create AGENTS.md documenting workflow
- **Status**: Pending

### Task 8.3: task-distribution-analysis - Remove demo notes
- **Files**: Prompts in `meshes/task-distribution-analysis/`
- **Issue**: Demo/test artifacts in prompts
- **Fix**: Remove or update demo notes
- **Status**: Pending

---

## Summary

**Total Tasks**: 157 issues organized into 8 phases
**Critical**: 8 tasks (Phase 1)
**High Priority**: 51 tasks (Phases 2-3)
**Medium Priority**: 73 tasks (Phases 4-5)
**Low Priority**: 25 tasks (Phases 6-8)

## Notes

- Each task should be implemented individually
- Test after each critical fix
- Commit after completing each phase
- Update this plan with discoveries during implementation

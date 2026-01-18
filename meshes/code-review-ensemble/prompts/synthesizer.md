# Code Review Synthesizer

Aggregate findings from parallel reviewers and create prioritized, actionable report.

## Inputs

**CRITICAL**: Read all reviews from the **incoming messages** that triggered your session.

You will receive 3 task-complete messages from:
- `reviewer-logic` - Logic & Correctness review (in message body)
- `reviewer-architecture` - Architecture & Design review (in message body)
- `reviewer-robustness` - Robustness & Safety review (in message body)

Each review is in the message body. DO NOT look for workspace files.

Also reference the code:
- `{workspace}/code-to-review.md` - Original code

## Synthesis Tasks

### 1. Deduplicate Issues
- Merge overlapping findings
- Consolidate similar concerns
- Identify root causes vs symptoms

### 2. Prioritize by Impact
**CRITICAL**: Must fix (security, crashes, data loss)
**HIGH**: Should fix (bugs, design flaws, tech debt)
**MEDIUM**: Nice to have (refactorings, optimizations)
**LOW**: Optional (style, minor improvements)

### 3. Group Related Issues
- Cluster by file/module/concern
- Identify systemic patterns
- Note architectural themes

### 4. Create Action Plan
- Quick wins (low effort, high impact)
- Medium-term improvements
- Long-term refactorings

## Output Format

```markdown
# Code Review Summary

## Executive Summary
[2-3 sentences: overall code quality, main concerns, recommendation]

## Priority Issues

### CRITICAL (X issues)
1. **[Issue Title]**
   - Impact: [What breaks/risk]
   - Location: [File:line]
   - Fix: [Specific action]
   - Effort: [S/M/L]

### HIGH (X issues)
[Same format]

### MEDIUM (X issues)
[Grouped by theme, less detail]

### LOW (X issues)
[Brief list]

## Systemic Concerns

### Pattern: [Name]
- Observed in: [Locations]
- Root cause: [Explanation]
- Fix approach: [Strategy]

## Recommended Action Plan

### Phase 1: Quick Wins (< 1 hour)
- [ ] Fix X
- [ ] Add Y
- [ ] Refactor Z

### Phase 2: Core Improvements (1-4 hours)
- [ ] Refactor module A
- [ ] Add error handling to B
- [ ] Extract common logic from C

### Phase 3: Architectural (4+ hours)
- [ ] Redesign X for extensibility
- [ ] Split Y into separate modules
- [ ] Introduce Z pattern

## Positive Observations
[What's good about the code]

## Overall Assessment
**Quality Score**: [1-10]
**Readability**: [1-10]
**Maintainability**: [1-10]
**Robustness**: [1-10]

**Recommendation**: [SHIP / FIX CRITICAL / MAJOR REFACTOR NEEDED]
```

Be constructive. Balance criticism with recognition. Provide actionable steps.

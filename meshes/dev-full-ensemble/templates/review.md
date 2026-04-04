# Semi-Formal Review Certificate
#
# Holistic verification template for ultrareview.
# Structured proof per review category. Every finding cites file:line.
# Every "No issues found" requires evidence of looking.

## Instructions

For each category, state what you examined and what you found.
"No issues found" requires listing what you checked and where.
Every finding must cite file:line with a trace showing the problem.

---

## DEFINITIONS

D1: A MUST-FIX issue is one where the code path demonstrably violates
    security, causes data loss, degrades performance measurably, or
    breaks integration with existing systems. Trace required.

D2: An ADVISORY issue is a pattern that could cause problems under
    conditions not exercised by current criteria. Evidence required
    but severity is judgment.

D3: NO ISSUES requires documenting what was examined: which files,
    which patterns were checked, and confirming absence of findings.

---

## SECURITY ANALYSIS

**Files examined:** [list files checked for each vector]

### Injection vectors
**Checked:** [file:line — input boundaries, query construction, command building]
**Finding:** [CLEAR / issue description with trace]

### Auth/authz
**Checked:** [file:line — new endpoints, route guards, permission checks]
**Finding:** [CLEAR / issue description with trace]

### Secrets
**Checked:** [file:line — config files, env usage, hardcoded values]
**Finding:** [CLEAR / issue description with trace]

### Input validation
**Checked:** [file:line — system boundaries, external data entry points]
**Finding:** [CLEAR / issue description with trace]

---

## PERFORMANCE ANALYSIS

**Files examined:** [list]

### Query patterns
**Checked:** [file:line — loops with queries, missing pagination, N+1]
**Finding:** [CLEAR / issue with trace]

### Memory
**Checked:** [file:line — event listeners, unclosed handles, growing collections]
**Finding:** [CLEAR / issue with trace]

### Hot paths
**Checked:** [file:line — blocking ops, sync I/O on request paths]
**Finding:** [CLEAR / issue with trace]

---

## INTEGRATION ANALYSIS

**Files examined:** [list]

### Pattern consistency
**Premise:** Existing codebase uses [pattern] for [concern]
**Implementation uses:** [same/different pattern]
**Trace:** [file:line showing alignment or deviation]
**Finding:** [CONSISTENT / DEVIATION — with justification]

### Module graph
**Checked:** [imports/exports — circular deps, layer violations]
**Finding:** [CLEAR / issue with trace]

### Error propagation
**Trace:** [error at file:line] → [propagates through] → [surfaces at file:line]
**Finding:** [CORRECT / SWALLOWED / WRONG LEVEL — with trace]

---

## COMPLETENESS ANALYSIS

### Gaps beyond criteria
**Checked:** [edge cases criteria didn't specify but code should handle]
**Finding:** [NONE / gap description with file:line]

### Cleanup
**Checked:** [temp files, partial state on failure, resource cleanup]
**Finding:** [CLEAR / issue with trace]

### Observability
**Checked:** [logging on new code paths, error reporting]
**Finding:** [ADEQUATE / gap with file:line]

---

## CODE QUALITY

### Dead code
**Checked:** [unreachable branches, unused imports, no-op conditionals]
**Finding:** [NONE / list with file:line]

### Abstraction level
**Checked:** [unnecessary indirection, premature generalization]
**Finding:** [APPROPRIATE / issue with evidence]

### Naming
**Checked:** [functions, variables, types that could mislead about behavior]
**Finding:** [CLEAR / misleading name at file:line — actual behavior is X]

---

## VERDICT

| Category | Status | Must-Fix Count | Advisory Count |
|----------|--------|---------------|----------------|
| Security | CLEAR/ISSUE | [N] | [N] |
| Performance | CLEAR/ISSUE | [N] | [N] |
| Integration | CLEAR/ISSUE | [N] | [N] |
| Completeness | CLEAR/ISSUE | [N] | [N] |
| Code Quality | CLEAR/ISSUE | [N] | [N] |

**SHIP / NO SHIP**

**If NO SHIP — must-fix table:**

| # | Category | File:Line | Issue | Trace Summary |
|---|----------|-----------|-------|---------------|
| 1 | [cat]    | [loc]     | [what] | [code path evidence] |

**Advisory observations:**
[Non-blocking items for future improvement]

# Semi-Formal Equivalence Certificate
#
# Post-ensemble verification template.
# Compare N implementations of the same criteria. Select or synthesize.
# Every claim requires a code trace. No unsupported assertions.

## Instructions

Fill in every bracketed field with evidence gathered from the codebase.
Read each implementation. Trace execution paths for each criterion.
Do not assume function behavior from names — read the actual code.

---

## DEFINITIONS

D1: Two implementations are EQUIVALENT MODULO CRITERIA iff applying either
    to the codebase produces identical observable outcomes for all criteria
    in criteria.md.

D2: An implementation SATISFIES a criterion iff the code trace demonstrates
    the observable outcome described in the criterion's Verify line.

D3: An implementation is COMPLETE iff it satisfies ALL criteria.
    PARTIAL iff it satisfies some. BROKEN iff it fails to apply or errors.

---

## INVENTORY

List each implementation received:

| Impl | Files Modified | Lines Changed | Applies Clean | Status |
|------|---------------|---------------|---------------|--------|
| A    | [files]       | [count]       | [YES/NO]      | [COMPLETE/PARTIAL/BROKEN] |
| B    | [files]       | [count]       | [YES/NO]      | [COMPLETE/PARTIAL/BROKEN] |
| C    | [files]       | [count]       | [YES/NO]      | [COMPLETE/PARTIAL/BROKEN] |

---

## PREMISES

P1: Criteria requires: [summarize criteria.md in testable terms]
P2: Impl A modifies [file(s)] by [specific change description]
P3: Impl B modifies [file(s)] by [specific change description]
P4: Impl C modifies [file(s)] by [specific change description]

---

## PER-CRITERION TRACE

For each criterion in criteria.md:

### Criterion {N}: "{criterion text}"

**Verify line:** {verification step from criteria.md}

**Impl A:**
- Entry: [function/module touched]
- Path: [file:line] → [file:line] → [assertion point]
- Outcome: [what the code produces]
- Satisfies: [YES/NO] because [trace conclusion]

**Impl B:**
- Entry: [function/module touched]
- Path: [file:line] → [file:line] → [assertion point]
- Outcome: [what the code produces]
- Satisfies: [YES/NO] because [trace conclusion]

**Impl C:**
- Entry: [function/module touched]
- Path: [file:line] → [file:line] → [assertion point]
- Outcome: [what the code produces]
- Satisfies: [YES/NO] because [trace conclusion]

**Comparison:** [ALL EQUIVALENT / DIVERGENT — which differ and why]

---

## EQUIVALENCE MATRIX

| Criterion | A | B | C | Agreement |
|-----------|---|---|---|-----------|
| 1         | ✓/✗ | ✓/✗ | ✓/✗ | [all/partial/none] |
| 2         | ✓/✗ | ✓/✗ | ✓/✗ | [all/partial/none] |
| ...       |     |     |     |           |

---

## SIDE EFFECTS

Check each implementation for unintended consequences:

| Impl | Side Effect | Severity | Evidence |
|------|-------------|----------|----------|
| [A/B/C] | [what it affects beyond criteria] | [none/low/high] | [file:line] |

---

## SELECTION

### If implementations are equivalent:
Select [A/B/C] because [fewer side effects / simpler diff / better patterns].

### If implementations diverge:
Select [A/B/C] because [satisfies criteria {N,M} that others miss].
Rejected implementations fail on: [specific criterion with trace evidence].

### If all are incomplete:
NONE selected.
Feedback for re-attempt:
- Missing: [criteria not satisfied by any implementation]
- Closest: [which impl and what it needs]
- Guidance: [specific approach suggestion based on traces]

---

## VERDICT

**Selected:** [A / B / C / NONE]
**Criteria coverage:** [N/M satisfied]
**Confidence:** [1-5]
**Evidence chain complete:** [YES/NO]

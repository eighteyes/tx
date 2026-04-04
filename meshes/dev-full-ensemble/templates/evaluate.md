# Semi-Formal Evaluate Certificate
#
# Criteria certification template.
# Prove each criterion is met by tracing code paths.
# Every PASS requires a trace. Every FAIL requires a counterexample.

## Instructions

Fill in every bracketed field with evidence from the codebase.
For each criterion, trace the execution path that satisfies (or fails) it.
Do not assess from memory or function names. Read the code. Trace the path.

---

## DEFINITIONS

D1: A criterion is MET iff the implementation produces the observable
    outcome described in the criterion's Verify line, traceable through
    the actual code path.

D2: A criterion is PARTIALLY MET iff some but not all conditions in the
    Verify line are satisfied, with specific trace evidence for what works
    and what doesn't.

D3: A criterion is NOT MET iff a counterexample exists: a code path where
    the Verify condition fails, with specific trace evidence.

---

## ITERATION CONTEXT

Iteration: {N} of 3
Previous gaps (from last scorecard, if any): [list or "first evaluation"]

---

## PER-CRITERION CERTIFICATION

### Criterion {N}: "{criterion text}"

**Verify:** {verification step from criteria.md}

**PREMISES:**
P1: The criterion requires [specific observable outcome]
P2: The implementation at [file:line] does [what]

**TRACE:**
Entry: [function call or module entry point]
Path: [file:line] → [file:line] → ... → [assertion point]
Output: [what the code produces at the assertion point]

**CLAIM:** Criterion [MET / PARTIALLY MET / NOT MET]
because [trace conclusion — reference specific lines]

**If PARTIALLY MET — what's missing:**
- Satisfied: [which part of Verify line, with trace]
- Missing: [which part, with evidence of absence]

**If NOT MET — counterexample:**
- Expected: [what the Verify line requires]
- Actual: [what the code path produces, with trace]
- Root cause: [file:line — why it fails]

---

## EDGE CASE VERIFICATION

For each edge case criterion:

### Edge Case {N}: "{criterion text}"

**Trigger condition:** [what input/state triggers this edge case]
**Code path:** [file:line] → [handler] → [outcome]
**Handled correctly:** [YES/NO — with trace evidence]

---

## SCORECARD

| # | Criterion | Status | Evidence Summary |
|---|-----------|--------|-----------------|
| 1 | {text}    | MET / PARTIAL / NOT MET | {one-line trace reference} |
| 2 | {text}    | MET / PARTIAL / NOT MET | {one-line trace reference} |

---

## FORMAL CONCLUSION

By D1-D3:
- Criteria met: [N/M]
- Criteria partially met: [list]
- Criteria not met: [list]

**Result:** ALL PASS / GAPS FOUND

**If GAPS FOUND — feedback for implementer:**
For each gap, provide:
1. Which criterion failed
2. The specific code path that fails (file:line)
3. What the code does vs what it should do
4. Suggested approach (trace-informed, not generic)

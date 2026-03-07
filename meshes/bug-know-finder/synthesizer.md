# Synthesizer Agent
# bug-know-finder mesh
# Responsibilities:
#   - Combine test failures, gap analysis, reconciliation, and observations
#   - Categorize into spec violations, functional bugs, spec gaps, and spec drift
#   - Produce bug-report.md, bug-fixer-input.md, spec-violations.md, spec-gaps.md

## Role

You merge findings from the test runner, gap detector, and inspector into a comprehensive QA report with multiple output files.

## Workflow

1. **Read test results**
   - Read `{workspace}/test-results.yaml`
   - Each failed test = a spec violation (spec says X, site does Y)

2. **Read gap analysis**
   - Read `{workspace}/gap-analysis.yaml`
   - Undocumented pages = spec gaps
   - Missing pages = build gaps

3. **Read reconciliation report**
   - Read `{workspace}/reconciliation.yaml`
   - `drift` entries = spec was updated to match reality (informational)
   - `bugs` entries = confirmed implementation bugs (add to bug report)
   - `missing` entries = unresolved conflicts (add to spec gaps)
   - `undocumented` entries = UI features not in spec (add to spec gaps)

4. **Categorize findings**
   - **Spec violations:** Test failures where site doesn't match spec
   - **Functional bugs:** Runtime errors, console errors, broken interactions found during testing
   - **Implementation bugs:** Items from reconciliation.yaml `bugs` list (spec is correct, UI doesn't implement it)
   - **Spec gaps:** Undocumented pages/features from gap-detector + undocumented entries from reconciliation
   - **Build gaps:** Spec interfaces with no corresponding page
   - **Spec drift (resolved):** Items where spec was updated — informational, not actionable

5. **Write spec-violations.md**
   - Save to `{workspace}/spec-violations.md`:
     ```markdown
     # Spec Violations

     ## [spec-source]: [description]
     - **Expected (from spec):** What the spec says
     - **Actual (on site):** What the site does
     - **Test:** [test name]
     - **Screenshot:** screenshots/[name].png
     ```

6. **Write spec-gaps.md**
   - Save to `{workspace}/spec-gaps.md`:
     ```markdown
     # Spec Gaps

     ## Undocumented Pages (in site, not in spec)
     | Path | Title | Suggested spec entity |
     |------|-------|-----------------------|

     ## Missing Pages (in spec, not in site)
     | Spec Interface | Expected URL | Status |
     |----------------|--------------|--------|

     ## Undocumented UI Elements (found by inspector)
     | Page | Element | Suggested Entity |
     |------|---------|-----------------|

     ## Spec Drift Applied
     | Entity | Old Value | New Value |
     |--------|-----------|-----------|
     ```

7. **Write bug-report.md**
   - Include all spec violations + functional bugs + implementation bugs from reconciliation
   - For reconciliation bugs, note they were confirmed by human review

8. **Write bug-fixer-input.md**
   - Numbered markdown list of fixable issues (spec violations + functional bugs + implementation bugs)
   - Exclude spec gaps (those need spec updates, not code fixes)
   - Exclude drift items (already resolved via spec-graph update)

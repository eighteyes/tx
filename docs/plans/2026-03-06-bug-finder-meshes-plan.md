# Bug Finder Meshes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build two QA meshes — bug-finder (blind crawl) and bug-know-finder (spec-graph-guided) — that discover issues via Playwright and output bug-fixer-compatible reports.

**Architecture:** bug-finder uses FSM dynamic ensemble (crawl → parallel test → synthesize). bug-know-finder uses FSM with parallel entry ensemble then linear pipeline (spec-read + gap-detect → test-write → run → synthesize).

**Tech Stack:** TX mesh configs (YAML), prompt files (markdown), Playwright MCP, know CLI (bug-know-finder only).

---

### Task 1: bug-finder config.yaml

**Files:**
- Create: `meshes/bug-finder/config.yaml`

**Step 1: Create directory**

```bash
mkdir -p meshes/bug-finder
```

**Step 2: Write config.yaml**

```yaml
# bug-finder/config.yaml
# Crawl a website and find UX, QA, design, and accessibility issues
# Responsibilities:
#   - Crawl from a starting URL to build a sitemap
#   - Test each page in parallel for visual, UX, functional, and a11y issues
#   - Deduplicate and rank findings into a bug report

mesh: bug-finder
description: "Crawl a website and find UX, QA, design, and accessibility issues"

agents:
  - name: crawler
    model: sonnet
    prompt: crawler.md
    mcpServers:
      playwright:
        command: npx
        args: ["@playwright/mcp@latest"]

  - name: tester
    model: sonnet
    prompt: tester.md
    mcpServers:
      playwright:
        command: npx
        args: ["@playwright/mcp@latest"]

  - name: synthesizer
    model: sonnet
    prompt: synthesizer.md

entry_point: crawler
completion_agents: [synthesizer]

routing:
  crawler:
    complete:
      tester: "Sitemap ready, spawn testers"
  tester:
    complete:
      synthesizer: "Page tested"
  synthesizer:
    complete:
      core: "Bug report ready"

workspace:
  path: ".ai/tx/workspaces/bug-finder/"
  create_on_init: true
  locations:
    workspace: ".ai/tx/workspaces/bug-finder/"

fsm:
  initial: crawl
  context:
    page_count: 0
  states:
    crawl:
      agents: [crawler]
      exit:
        gates:
          crawler:
            - "$workspace/sitemap.yaml"
        set:
          page_count: "$(echo '$rearmatter' | yq '.page_count')"
        default: testing
    testing:
      ensemble:
        type: parallel
        agent: tester
        count: $page_count
        aggregation: concat
        timeout_ms: 600000
      exit:
        set:
          test_findings: "$ENSEMBLE_OUTPUT"
        default: synthesis
    synthesis:
      agents: [synthesizer]
      exit:
        default: complete
    complete:
      terminal: true
  scripts: {}

guardrails:
  strict: false
  warning: true
  agents:
    crawler:
      max_turns:
        limit: 20
        strict: true
        warning: true
    tester:
      max_turns:
        limit: 25
        strict: true
        warning: true
```

**Step 3: Validate YAML**

Run: `yq . meshes/bug-finder/config.yaml`
Expected: Valid YAML, no errors.

**Step 4: Commit**

```bash
git add -f meshes/bug-finder/config.yaml
git commit -m "feat(mesh): add bug-finder config with FSM crawl-test-synthesize pipeline"
```

---

### Task 2: bug-finder crawler prompt

**Files:**
- Create: `meshes/bug-finder/crawler.md`

**Step 1: Write crawler.md**

```markdown
# Crawler Agent
# bug-finder mesh
# Responsibilities:
#   - Navigate to starting URL with Playwright MCP
#   - Discover all pages by following links
#   - Build structured sitemap for parallel testing
#   - Cap at reasonable page count to prevent runaway crawls

## Role

You crawl a website starting from the provided URL and build a sitemap of all discoverable pages.

## Workflow

1. **Navigate to the starting URL**
   - Use `browser_navigate` to load the page
   - Use `browser_snapshot` to get the accessibility tree
   - Record the URL, page title, and key elements

2. **Discover linked pages**
   - Extract all internal links from the page (same domain)
   - Exclude: external links, mailto:, tel:, anchor-only (#), asset URLs (.js, .css, .png, etc.)
   - Follow each internal link recursively up to 3 levels deep
   - Track visited URLs to avoid cycles

3. **Build the sitemap**
   - For each discovered page, record:
     - URL path (relative)
     - Page title
     - Key interactive elements found (forms, buttons, navigation)
     - Whether it requires authentication (login wall detected)
   - Save to `{workspace}/sitemap.yaml`

4. **Cap discovery**
   - Maximum 20 pages per crawl to prevent ensemble explosion
   - If more than 20 pages found, prioritize:
     - Unique route patterns over parameter variations
     - Pages with forms/interactive elements
     - Top-level navigation pages

## Output: sitemap.yaml

```yaml
base_url: "https://example.com"
pages:
  - path: "/"
    title: "Home"
    has_forms: false
    has_interactive: true
    auth_required: false
  - path: "/login"
    title: "Login"
    has_forms: true
    has_interactive: true
    auth_required: false
  - path: "/dashboard"
    title: "Dashboard"
    has_forms: false
    has_interactive: true
    auth_required: true
total: 3
```

## Rearmatter Output

```
signal: complete
page_count: 3
```

Replace with actual page count from sitemap.
```

**Step 2: Commit**

```bash
git add -f meshes/bug-finder/crawler.md
git commit -m "feat(mesh): add bug-finder crawler prompt"
```

---

### Task 3: bug-finder tester prompt

**Files:**
- Create: `meshes/bug-finder/tester.md`

**Step 1: Write tester.md**

```markdown
# Tester Agent
# bug-finder mesh
# Responsibilities:
#   - Test one page from the sitemap for all issue types
#   - Capture screenshots as evidence
#   - Report findings in structured format

## Role

You test a single page for visual, UX, functional, and accessibility issues. Multiple testers run in parallel, each assigned one page via ENSEMBLE_INDEX.

## Workflow

1. **Identify your page**
   - Read `{workspace}/sitemap.yaml`
   - Your page is at index ENSEMBLE_INDEX (0-based)
   - Note the base_url and your page's path

2. **Navigate and screenshot**
   - Use `browser_navigate` to load the page
   - Take screenshots at three viewport sizes:
     - Desktop: 1280×720
     - Tablet: 768×1024
     - Mobile: 375×667
   - Save to `{workspace}/screenshots/[page-slug]-desktop.png`, `-tablet.png`, `-mobile.png`

3. **Check for visual issues**
   - Use `browser_snapshot` for the accessibility tree
   - Look for:
     - Overlapping or clipped elements
     - Missing images (broken img tags)
     - Text overflow or truncation
     - Layout shifts between viewport sizes
     - Inconsistent spacing or alignment

4. **Check for UX issues**
   - Click all buttons and interactive elements
   - Fill and submit any forms (use test data)
   - Follow all internal links — report dead links (404/500)
   - Check for missing loading states or feedback
   - Verify navigation is consistent and functional

5. **Check for functional issues**
   - After each interaction, check for console errors via `browser_snapshot`
   - Look for JavaScript exceptions in the page
   - Note any network errors (failed API calls)
   - Check form validation behavior

6. **Check for accessibility issues**
   - Analyze the accessibility tree from `browser_snapshot`
   - Check for:
     - Missing alt text on images
     - Missing ARIA labels on interactive elements
     - Missing form labels
     - Heading hierarchy violations (h1 → h3 skip)
     - Low contrast text (if visually apparent)

## Output Format

```
## Page: [path] — [title]

### Issues Found

#### [SEVERITY]: [Issue Title]
- **Type:** visual | ux | functional | a11y
- **Screenshot:** screenshots/[page-slug]-[viewport].png
- **Description:** What is wrong
- **Expected:** What should happen
- **Actual:** What happens instead
- **Steps to reproduce:** How to trigger the issue

### No Issues
If the page passes all checks, report: "No issues found on [path]"
```

Severity levels: CRITICAL (broken functionality), MAJOR (significant UX problem), MINOR (cosmetic or minor a11y)
```

**Step 2: Commit**

```bash
git add -f meshes/bug-finder/tester.md
git commit -m "feat(mesh): add bug-finder tester prompt"
```

---

### Task 4: bug-finder synthesizer prompt

**Files:**
- Create: `meshes/bug-finder/synthesizer.md`

**Step 1: Write synthesizer.md**

```markdown
# Synthesizer Agent
# bug-finder mesh
# Responsibilities:
#   - Deduplicate findings across pages
#   - Rank issues by severity
#   - Produce bug-report.md and bug-fixer-input.md

## Role

You compile findings from all page testers into a deduplicated, severity-ranked bug report. You also produce a bug-fixer-compatible issue list.

## Workflow

1. **Parse all tester findings**
   - Read the concatenated output from all testers
   - Extract each issue with its page, type, severity, and details

2. **Deduplicate**
   - Same issue on multiple pages = one bug (note all affected pages)
   - Same root cause with different symptoms = one bug
   - Keep the most detailed description, merge affected pages

3. **Rank by severity**
   - CRITICAL: Broken core functionality, data loss, security issues
   - MAJOR: Significant UX problems, accessibility barriers, broken flows
   - MINOR: Cosmetic issues, minor a11y, inconsistencies

4. **Write bug-report.md**
   - Save to `{workspace}/bug-report.md`
   - Format:
     ```markdown
     # QA Report: [site URL]

     ## Summary
     - Pages tested: N
     - Issues found: N (Critical: N, Major: N, Minor: N)

     ## Critical Issues
     ### [Issue title]
     - **Pages:** /route1, /route2
     - **Type:** visual | ux | functional | a11y
     - **Screenshot:** screenshots/evidence.png
     - **Reproduction:** Steps to reproduce
     - **Expected:** What should happen
     - **Actual:** What happens instead

     ## Major Issues
     ...

     ## Minor Issues
     ...
     ```

5. **Write bug-fixer-input.md**
   - Save to `{workspace}/bug-fixer-input.md`
   - Numbered markdown list, one bug per line, compatible with bug-fixer mesh:
     ```markdown
     1. [Issue title] - [description with route and repro steps]
     2. [Issue title] - [description]
     ```
   - Include only CRITICAL and MAJOR issues (minor issues are informational)
```

**Step 2: Commit**

```bash
git add -f meshes/bug-finder/synthesizer.md
git commit -m "feat(mesh): add bug-finder synthesizer prompt"
```

---

### Task 5: bug-know-finder config.yaml

**Files:**
- Create: `meshes/bug-know-finder/config.yaml`

**Step 1: Create directory**

```bash
mkdir -p meshes/bug-know-finder
```

**Step 2: Write config.yaml**

```yaml
# bug-know-finder/config.yaml
# Spec-guided QA: generate Playwright tests from spec-graph, find spec violations and gaps
# Responsibilities:
#   - Read spec-graph for interfaces, actions, workflows
#   - Generate Playwright tests from spec assertions
#   - Run tests and capture results
#   - Crawl site to find features not in spec
#   - Produce comprehensive QA report

mesh: bug-know-finder
description: "Spec-guided QA: generate Playwright tests from spec-graph, find spec violations and gaps"

agents:
  - name: spec-reader
    model: sonnet
    prompt: spec-reader.md

  - name: gap-detector
    model: sonnet
    prompt: gap-detector.md
    mcpServers:
      playwright:
        command: npx
        args: ["@playwright/mcp@latest"]

  - name: test-writer
    model: opus
    prompt: test-writer.md

  - name: runner
    model: sonnet
    prompt: runner.md
    mcpServers:
      playwright:
        command: npx
        args: ["@playwright/mcp@latest"]

  - name: synthesizer
    model: sonnet
    prompt: synthesizer.md

entry_point: spec-reader
completion_agents: [synthesizer]

routing:
  spec-reader:
    complete:
      test-writer: "Spec assertions extracted"
  gap-detector:
    complete:
      synthesizer: "Gap analysis ready"
  test-writer:
    complete:
      runner: "Tests generated"
  runner:
    complete:
      synthesizer: "Test results ready"
  synthesizer:
    complete:
      core: "Report ready"

workspace:
  path: ".ai/tx/workspaces/bug-know-finder/"
  create_on_init: true
  locations:
    workspace: ".ai/tx/workspaces/bug-know-finder/"

fsm:
  initial: analyze
  context: {}
  states:
    analyze:
      ensemble:
        type: parallel
        agents: [spec-reader, gap-detector]
        aggregation: concat
      exit:
        default: generate
    generate:
      agents: [test-writer]
      exit:
        gates:
          test-writer:
            - "$workspace/tests/"
        default: run
    run:
      agents: [runner]
      exit:
        default: synthesis
    synthesis:
      agents: [synthesizer]
      exit:
        default: complete
    complete:
      terminal: true
  scripts: {}

guardrails:
  strict: false
  warning: true
  agents:
    gap-detector:
      max_turns:
        limit: 25
        strict: true
        warning: true
    test-writer:
      max_turns:
        limit: 30
        strict: true
        warning: true
    runner:
      max_turns:
        limit: 20
        strict: true
        warning: true
```

**Step 3: Validate YAML**

Run: `yq . meshes/bug-know-finder/config.yaml`
Expected: Valid YAML, no errors.

**Step 4: Commit**

```bash
git add -f meshes/bug-know-finder/config.yaml
git commit -m "feat(mesh): add bug-know-finder config with spec-guided pipeline"
```

---

### Task 6: bug-know-finder spec-reader prompt

**Files:**
- Create: `meshes/bug-know-finder/spec-reader.md`

**Step 1: Write spec-reader.md**

```markdown
# Spec Reader Agent
# bug-know-finder mesh
# Responsibilities:
#   - Query spec-graph for testable entities
#   - Extract interfaces, actions, workflows, data-models
#   - Produce structured test assertions for the test-writer

## Role

You read the spec-graph and extract testable assertions that the test-writer will turn into Playwright tests.

## Workflow

1. **Discover all interfaces**
   - Run: `know list --type interface`
   - For each interface, run: `know get interface:[key]`
   - Extract: name, description, expected elements (forms, buttons, fields)

2. **Discover all actions**
   - Run: `know list --type action`
   - For each action, run: `know get action:[key]`
   - Extract: name, description, trigger, expected outcome

3. **Discover workflows (business_logic)**
   - Run: `know list --type business_logic`
   - For each, run: `know get business_logic:[key]`
   - Extract: workflow steps, preconditions, expected state transitions

4. **Discover data models**
   - Run: `know list --type data-model`
   - For each, run: `know get data-model:[key]`
   - Extract: field names, types, validation rules

5. **Trace feature dependencies**
   - For key features, run: `know graph uses feature:[key]`
   - Map which interfaces belong to which features

6. **Write test assertions**
   - Save to `{workspace}/spec-assertions.yaml`:
     ```yaml
     assertions:
       - id: assert-1
         source: "interface:login"
         type: interface
         url_hint: "/login"
         checks:
           - "Page has email input field"
           - "Page has password input field"
           - "Page has submit button"
           - "Form submits on click"
       - id: assert-2
         source: "action:checkout"
         type: workflow
         url_hint: "/checkout"
         steps:
           - { page: "/cart", action: "click checkout", expect: "navigate to /shipping" }
           - { page: "/shipping", action: "fill form, click continue", expect: "navigate to /payment" }
     total: 2
     ```
```

**Step 2: Commit**

```bash
git add -f meshes/bug-know-finder/spec-reader.md
git commit -m "feat(mesh): add bug-know-finder spec-reader prompt"
```

---

### Task 7: bug-know-finder gap-detector prompt

**Files:**
- Create: `meshes/bug-know-finder/gap-detector.md`

**Step 1: Write gap-detector.md**

```markdown
# Gap Detector Agent
# bug-know-finder mesh
# Responsibilities:
#   - Crawl the site to discover all pages and features
#   - Compare discovered pages against spec-graph interfaces
#   - Report undocumented pages/features (spec gaps)

## Role

You crawl the website and compare what exists against the spec-graph. You find pages and features that are NOT documented in the spec.

## Workflow

1. **Crawl the site**
   - Use `browser_navigate` to load the starting URL
   - Follow internal links up to 3 levels deep
   - Build a list of all discovered pages with titles and key elements
   - Cap at 30 pages maximum

2. **Read spec interfaces**
   - Run: `know list --type interface`
   - Build a list of all spec-documented interfaces and their expected URLs

3. **Compare discovered vs documented**
   - For each discovered page:
     - Does it match a spec interface? (by URL pattern or title)
     - If YES: mark as "documented"
     - If NO: mark as "undocumented" — this is a spec gap
   - For each spec interface:
     - Was it found during crawl?
     - If NO: mark as "missing from site" — this is a build gap

4. **Write gap analysis**
   - Save to `{workspace}/gap-analysis.yaml`:
     ```yaml
     documented_pages:
       - path: "/login"
         spec_interface: "interface:login"
     undocumented_pages:
       - path: "/settings/notifications"
         title: "Notification Settings"
         description: "Page exists but has no spec interface"
     missing_from_site:
       - interface: "interface:admin-panel"
         description: "Spec defines this interface but page not found"
     summary:
       total_pages: 15
       documented: 10
       undocumented: 3
       missing: 2
     ```
```

**Step 2: Commit**

```bash
git add -f meshes/bug-know-finder/gap-detector.md
git commit -m "feat(mesh): add bug-know-finder gap-detector prompt"
```

---

### Task 8: bug-know-finder test-writer prompt

**Files:**
- Create: `meshes/bug-know-finder/test-writer.md`

**Step 1: Write test-writer.md**

```markdown
# Test Writer Agent
# bug-know-finder mesh
# Responsibilities:
#   - Read spec assertions from spec-reader
#   - Generate Playwright test scripts (.spec.ts)
#   - Cover interface checks, workflow validations, and data model assertions

## Role

You generate Playwright test files from spec assertions. Each assertion becomes a test case that verifies the site matches the spec.

## Workflow

1. **Read spec assertions**
   - Read `{workspace}/spec-assertions.yaml`
   - Group assertions by page/URL for efficient test organization

2. **Generate test files**
   - Create one test file per page/interface: `{workspace}/tests/[interface-key].spec.ts`
   - Use Playwright test format:
     ```typescript
     import { test, expect } from '@playwright/test';

     test.describe('[interface-key]: [name]', () => {
       test('has expected elements', async ({ page }) => {
         await page.goto('[url]');
         // assertions from spec
       });
     });
     ```

3. **Generate interface tests** (type: interface)
   - For each check, generate an assertion:
     - "Page has email input" → `await expect(page.getByLabel('Email')).toBeVisible()`
     - "Page has submit button" → `await expect(page.getByRole('button', { name: /submit/i })).toBeVisible()`
   - Use semantic selectors: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`

4. **Generate workflow tests** (type: workflow)
   - For each step sequence, generate a flow test:
     ```typescript
     test('checkout workflow', async ({ page }) => {
       await page.goto('/cart');
       await page.getByRole('button', { name: /checkout/i }).click();
       await expect(page).toHaveURL(/shipping/);
       // ... next steps
     });
     ```

5. **Generate data model tests** (type: data_model)
   - For fields with validation rules, generate validation tests:
     ```typescript
     test('email field validates format', async ({ page }) => {
       await page.goto('/register');
       await page.getByLabel('Email').fill('invalid');
       await page.getByRole('button', { name: /submit/i }).click();
       await expect(page.getByText(/valid email/i)).toBeVisible();
     });
     ```

6. **Write a test runner config** if none exists
   - Save `{workspace}/tests/playwright.config.ts` with base URL from the incoming message

## Quality Rules

- Use semantic selectors (getByRole, getByLabel) over CSS selectors
- Each test should be independent (no shared state)
- Add descriptive test names that reference the spec source
- Include timeout handling for navigation
```

**Step 2: Commit**

```bash
git add -f meshes/bug-know-finder/test-writer.md
git commit -m "feat(mesh): add bug-know-finder test-writer prompt"
```

---

### Task 9: bug-know-finder runner prompt

**Files:**
- Create: `meshes/bug-know-finder/runner.md`

**Step 1: Write runner.md**

```markdown
# Runner Agent
# bug-know-finder mesh
# Responsibilities:
#   - Run generated Playwright tests
#   - Capture results and screenshots of failures
#   - Report structured test results

## Role

You execute the Playwright tests generated by the test-writer and capture detailed results.

## Workflow

1. **Run the generated test suite**
   - Execute via Bash: `npx playwright test {workspace}/tests/ --reporter=json 2>&1`
   - Capture the full JSON output

2. **For each failing test: investigate with Playwright MCP**
   - Use `browser_navigate` to load the failing page
   - Use `browser_screenshot` to capture the current state
   - Use `browser_snapshot` for accessibility tree
   - Save screenshots to `{workspace}/screenshots/[test-name]-failure.png`

3. **Write test results**
   - Save to `{workspace}/test-results.yaml`:
     ```yaml
     total: 15
     passed: 12
     failed: 3
     failures:
       - test: "interface:login has email input"
         spec_source: "interface:login"
         error: "Element not found: getByLabel('Email')"
         screenshot: "screenshots/login-email-failure.png"
         page: "/login"
       - test: "checkout workflow navigates to shipping"
         spec_source: "action:checkout"
         error: "Expected URL /shipping, got /cart"
         screenshot: "screenshots/checkout-flow-failure.png"
         page: "/cart"
     ```

4. **Also run existing project tests** (if they exist)
   - Check if `playwright.config.ts` exists in project root
   - If yes, run: `npx playwright test --reporter=json 2>&1`
   - Capture any additional failures
```

**Step 2: Commit**

```bash
git add -f meshes/bug-know-finder/runner.md
git commit -m "feat(mesh): add bug-know-finder runner prompt"
```

---

### Task 10: bug-know-finder synthesizer prompt

**Files:**
- Create: `meshes/bug-know-finder/synthesizer.md`

**Step 1: Write synthesizer.md**

```markdown
# Synthesizer Agent
# bug-know-finder mesh
# Responsibilities:
#   - Combine test failures, gap analysis, and observations
#   - Categorize into spec violations, functional bugs, and spec gaps
#   - Produce bug-report.md, bug-fixer-input.md, spec-violations.md, spec-gaps.md

## Role

You merge findings from the test runner and gap detector into a comprehensive QA report with multiple output files.

## Workflow

1. **Read test results**
   - Read `{workspace}/test-results.yaml`
   - Each failed test = a spec violation (spec says X, site does Y)

2. **Read gap analysis**
   - Read `{workspace}/gap-analysis.yaml`
   - Undocumented pages = spec gaps
   - Missing pages = build gaps

3. **Categorize findings**
   - **Spec violations:** Test failures where site doesn't match spec
   - **Functional bugs:** Runtime errors, console errors, broken interactions found during testing
   - **Spec gaps:** Undocumented pages/features discovered by gap-detector
   - **Build gaps:** Spec interfaces with no corresponding page

4. **Write spec-violations.md**
   - Save to `{workspace}/spec-violations.md`:
     ```markdown
     # Spec Violations

     ## [spec-source]: [description]
     - **Expected (from spec):** What the spec says
     - **Actual (on site):** What the site does
     - **Test:** [test name]
     - **Screenshot:** screenshots/[name].png
     ```

5. **Write spec-gaps.md**
   - Save to `{workspace}/spec-gaps.md`:
     ```markdown
     # Spec Gaps

     ## Undocumented Pages (in site, not in spec)
     | Path | Title | Suggested spec entity |
     |------|-------|-----------------------|

     ## Missing Pages (in spec, not in site)
     | Spec Interface | Expected URL | Status |
     |----------------|--------------|--------|
     ```

6. **Write bug-report.md**
   - Same format as bug-finder (see shared output format in design)
   - Include all spec violations + functional bugs

7. **Write bug-fixer-input.md**
   - Numbered markdown list of fixable issues (spec violations + functional bugs)
   - Exclude spec gaps (those need spec updates, not code fixes)
```

**Step 2: Commit**

```bash
git add -f meshes/bug-know-finder/synthesizer.md
git commit -m "feat(mesh): add bug-know-finder synthesizer prompt"
```

---

### Task 11: Validate both meshes

**Step 1: Validate YAML for both configs**

```bash
yq . meshes/bug-finder/config.yaml > /dev/null && echo "bug-finder: OK"
yq . meshes/bug-know-finder/config.yaml > /dev/null && echo "bug-know-finder: OK"
```

**Step 2: Verify all files present**

```bash
echo "=== bug-finder ===" && ls meshes/bug-finder/
echo "=== bug-know-finder ===" && ls meshes/bug-know-finder/
```

Expected:
- bug-finder: config.yaml, crawler.md, tester.md, synthesizer.md
- bug-know-finder: config.yaml, spec-reader.md, gap-detector.md, test-writer.md, runner.md, synthesizer.md

**Step 3: Verify agent names match config**

```bash
echo "=== bug-finder agents ===" && yq '.agents[].name' meshes/bug-finder/config.yaml
echo "=== bug-know-finder agents ===" && yq '.agents[].name' meshes/bug-know-finder/config.yaml
```

**Step 4: Verify FSM states**

```bash
echo "=== bug-finder states ===" && yq '.fsm.states | keys' meshes/bug-finder/config.yaml
echo "=== bug-know-finder states ===" && yq '.fsm.states | keys' meshes/bug-know-finder/config.yaml
```

**Step 5: Final commit (if any fixes needed)**

```bash
git add -f meshes/bug-finder/ meshes/bug-know-finder/
git commit -m "feat(mesh): complete bug-finder and bug-know-finder meshes"
```

---

## File Manifest

### bug-finder (4 files)

| File | Purpose |
|------|---------|
| `meshes/bug-finder/config.yaml` | 3 agents, FSM crawl→test→synthesize, Playwright MCP |
| `meshes/bug-finder/crawler.md` | Crawl from URL, build sitemap, set page_count |
| `meshes/bug-finder/tester.md` | Test one page: visual, UX, functional, a11y |
| `meshes/bug-finder/synthesizer.md` | Dedupe, rank, write bug-report + bug-fixer-input |

### bug-know-finder (6 files)

| File | Purpose |
|------|---------|
| `meshes/bug-know-finder/config.yaml` | 5 agents, FSM analyze→generate→run→synthesize |
| `meshes/bug-know-finder/spec-reader.md` | Query spec-graph, extract testable assertions |
| `meshes/bug-know-finder/gap-detector.md` | Crawl site, compare vs spec, find gaps |
| `meshes/bug-know-finder/test-writer.md` | Generate .spec.ts from spec assertions |
| `meshes/bug-know-finder/runner.md` | Run Playwright tests, capture results |
| `meshes/bug-know-finder/synthesizer.md` | Merge all findings into report |

## Runtime Artifacts

| File | Created By | Read By |
|------|-----------|---------|
| `{workspace}/sitemap.yaml` | crawler | tester (bug-finder) |
| `{workspace}/spec-assertions.yaml` | spec-reader | test-writer |
| `{workspace}/gap-analysis.yaml` | gap-detector | synthesizer |
| `{workspace}/tests/*.spec.ts` | test-writer | runner |
| `{workspace}/test-results.yaml` | runner | synthesizer |
| `{workspace}/bug-report.md` | synthesizer | human |
| `{workspace}/bug-fixer-input.md` | synthesizer | bug-fixer mesh |
| `{workspace}/screenshots/` | tester/runner | synthesizer, human |
| `{workspace}/spec-violations.md` | synthesizer (know) | human |
| `{workspace}/spec-gaps.md` | synthesizer (know) | human |

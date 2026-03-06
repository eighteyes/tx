# Bug Finder Meshes Design

Two meshes for automated QA: one crawls blind, one uses the spec-graph.

## Mesh 1: bug-finder (Blind Crawl)

**Input:** A starting URL.
**Output:** Bug report + bug-fixer-compatible list + screenshots.

### Agents

| Agent | Model | Role |
|-------|-------|------|
| crawler | sonnet | Crawl from URL, build sitemap, discover all pages/routes |
| tester | sonnet | Test one page: visual, UX, functional, a11y |
| synthesizer | sonnet | Deduplicate, rank by severity, produce final report |

### Flow

```
User sends URL → crawler (builds sitemap, sets page_count)
  → tester ensemble (×page_count, each tests one page with Playwright MCP)
  → synthesizer (dedupes, ranks, writes bug-report.md + bug-fixer-input.md)
  → core
```

### Architecture

- FSM dynamic ensemble for testers (count set by crawler)
- All agents have Playwright MCP for browser access
- Crawler writes `{workspace}/sitemap.yaml` with discovered pages
- Tester uses ENSEMBLE_INDEX to pick assigned page
- Tester checks per page:
  - Screenshot at multiple viewport sizes (desktop, tablet, mobile)
  - Console errors (JS exceptions, network failures)
  - Accessibility tree analysis (ARIA labels, contrast, focus order)
  - Interactive elements (click buttons, fill forms, follow links)
  - Visual layout (overlapping elements, overflow, missing assets)
  - Dead links and broken images
- Synthesizer deduplicates (same bug on multiple pages), ranks by severity

### FSM States

| State | Agent(s) | Purpose |
|-------|----------|---------|
| crawl | crawler | Build sitemap, set page_count |
| testing | ensemble: tester × page_count | Test all pages in parallel |
| synthesis | synthesizer | Dedupe, rank, format report |
| complete | terminal | — |

### Config Shape

```yaml
mesh: bug-finder
description: "Crawl a website and find UX, QA, design, and accessibility issues"

agents:
  - name: crawler
    model: sonnet
    prompt: crawler.md
    mcpServers:
      playwright: { command: npx, args: ["@playwright/mcp@latest"] }

  - name: tester
    model: sonnet
    prompt: tester.md
    mcpServers:
      playwright: { command: npx, args: ["@playwright/mcp@latest"] }

  - name: synthesizer
    model: sonnet
    prompt: synthesizer.md

entry_point: crawler
completion_agents: [synthesizer]

routing:
  crawler:
    complete:
      tester: "Sitemap ready"
  tester:
    complete:
      synthesizer: "Page tested"
  synthesizer:
    complete:
      core: "Bug report ready"

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

guardrails:
  agents:
    tester:
      max_turns: { limit: 25, strict: true, warning: true }
    crawler:
      max_turns: { limit: 20, strict: true, warning: true }
```

---

## Mesh 2: bug-know-finder (Spec-Guided)

**Input:** A URL + project with spec-graph (`.ai/know/spec-graph.json`).
**Output:** Bug report + bug-fixer-compatible list + screenshots + spec gap analysis.

### Agents

| Agent | Model | Role |
|-------|-------|------|
| spec-reader | sonnet | Query spec-graph for interfaces, actions, workflows, extract testable assertions |
| test-writer | opus | Generate Playwright test scripts (.spec.ts) from spec assertions |
| runner | sonnet | Run generated tests, capture results + screenshots |
| gap-detector | sonnet | Crawl site, compare vs spec interfaces, find undocumented features |
| synthesizer | sonnet | Combine test failures + gap findings into final report |

### Flow

```
User sends URL + optional project path
  → [spec-reader + gap-detector] (parallel)
  → test-writer (generates .spec.ts from spec assertions)
  → runner (runs tests with Playwright MCP)
  → synthesizer (merges test failures + gaps, writes report)
  → core
```

### Architecture

- No FSM needed — linear pipeline with one parallel fork at the start
- spec-reader uses `know` CLI: `know list --type interface`, `know get interface:X`, `know graph uses feature:Y`
- Extracts testable assertions: "interface:login has fields [email, password, submit]", "action:checkout follows workflow [cart → shipping → payment → confirm]"
- test-writer generates actual Playwright test files in `{workspace}/tests/`
- runner executes all generated tests via `npx playwright test {workspace}/tests/`
- gap-detector crawls independently, builds its own sitemap, compares against spec interfaces
- Synthesizer produces three sections: spec violations, functional bugs, spec gaps

### Routing

```yaml
routing_mode: dispatcher
routing:
  spec-reader: test-writer         # linear: spec → tests
  gap-detector: synthesizer        # linear: gaps → synthesis
  test-writer: runner              # linear: tests → run
  runner: synthesizer              # linear: results → synthesis
  # synthesizer: absent = terminal
```

Fan-out for the parallel start:
```yaml
routing:
  entry: [spec-reader, gap-detector, { complete: synthesizer, fan_in: batch }]
```

Wait — this doesn't work because spec-reader needs to go through test-writer and runner before synthesizer. Revised:

### Revised Flow (Sequential with parallel entry fork)

Actually, the cleanest approach: no dispatcher, simple routing.

```yaml
routing:
  spec-reader:
    complete:
      test-writer: "Spec assertions ready"
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
```

Synthesizer naturally gates on receiving messages from both runner and gap-detector. The parallelism happens organically — spec-reader and gap-detector start simultaneously (both listed in entry routing or FSM initial state ensemble).

### FSM States

| State | Agent(s) | Purpose |
|-------|----------|---------|
| analyze | ensemble: [spec-reader, gap-detector] parallel | Read spec + crawl site simultaneously |
| generate | test-writer | Write .spec.ts files from spec assertions |
| run | runner | Execute tests, capture results |
| synthesis | synthesizer | Merge everything |
| complete | terminal | — |

### Config Shape

```yaml
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
      playwright: { command: npx, args: ["@playwright/mcp@latest"] }

  - name: test-writer
    model: opus
    prompt: test-writer.md

  - name: runner
    model: sonnet
    prompt: runner.md
    mcpServers:
      playwright: { command: npx, args: ["@playwright/mcp@latest"] }

  - name: synthesizer
    model: sonnet
    prompt: synthesizer.md

entry_point: spec-reader

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

completion_agents: [synthesizer]

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

guardrails:
  agents:
    gap-detector:
      max_turns: { limit: 25, strict: true, warning: true }
    runner:
      max_turns: { limit: 20, strict: true, warning: true }
    test-writer:
      max_turns: { limit: 30, strict: true, warning: true }
```

---

## Shared Output Format

Both meshes write to workspace:

| File | Contents |
|------|----------|
| `{workspace}/bug-report.md` | Human-readable report with severity rankings |
| `{workspace}/bug-fixer-input.md` | Numbered markdown list compatible with bug-fixer mesh |
| `{workspace}/screenshots/` | Evidence screenshots per issue |

### bug-report.md format
```markdown
# QA Report: [site URL]

## Summary
- Pages tested: N
- Issues found: N (Critical: N, Major: N, Minor: N)

## Critical Issues
### [Issue title]
- **Page:** /route
- **Type:** visual | ux | functional | a11y
- **Screenshot:** screenshots/issue-name.png
- **Reproduction:** Steps to reproduce
- **Expected:** What should happen
- **Actual:** What happens instead

## Major Issues
...

## Minor Issues
...
```

### bug-fixer-input.md format
```markdown
1. [Issue title] - [description with route and repro steps]
2. [Issue title] - [description]
...
```

### bug-know-finder additional output
| File | Contents |
|------|----------|
| `{workspace}/spec-violations.md` | Spec says X, site does Y |
| `{workspace}/spec-gaps.md` | Pages/features not in spec |
| `{workspace}/tests/` | Generated .spec.ts files |

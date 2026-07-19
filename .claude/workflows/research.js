// research.js — Compiled workflow for the 'research' tx mesh
// Description: Web research workflow — interview → source → analyze → write
// Responsibilities:
//   - Derive a structured research brief from the incoming prompt (interviewer)
//   - Collect 5-10 web sources aligned with the brief (sourcer)
//   - Analyze sources into 3-5 hypotheses (analyst)
//   - Synthesize all materials into deliverable report(s) (writer)
//   - Thread carry state (brief, sources, analysis) between hops
//   - Write artifacts to .ai/research/{topic}/ workspace
// Source mesh: /Users/god/projects/tx/tx-core/meshes/research
// Compiled by: mesh-to-workflow

// LOSSY: rearmatter — mesh fields (grade, confidence, status, gaps) folded into agent output schemas
// LOSSY: intents — no intent-based dispatch in workflows; invoke by name or scriptPath
// LOSSY: interviewer human-confirmation gate — capability declares interaction:[none]; confirmation loop stripped, brief is derived autonomously
// LOSSY: workspace {topic} placeholder — resolved at runtime from interviewer output; defaults to 'current' until topic slug is known

export const meta = {
  name: 'research',
  description: 'Web research: gather requirements, source, analyze, and write a final report',
  whenToUse: 'Research, investigation, "find out", "what\'s the state of", look into, or explore tasks',
  phases: [
    { title: 'Interview', detail: 'Derive structured research brief from the prompt' },
    { title: 'Source',    detail: 'Web search and source collection' },
    { title: 'Analyze',   detail: 'Pattern analysis and hypothesis formation' },
    { title: 'Write',     detail: 'Synthesize deliverables to workspace' },
  ],
}

const WORKSPACE_ROOT = '.ai/research'
const MAX_HOPS = 16

// ─── Output schemas ───────────────────────────────────────────────────────────

const INTERVIEWER_OUT = {
  type: 'object',
  required: ['status', 'topic', 'brief'],
  properties: {
    status:   { type: 'string', enum: ['complete', 'blocked'] },
    topic:    { type: 'string', description: 'URL-safe topic slug, e.g. ai-agent-frameworks-2025' },
    brief:    { type: 'string', description: 'Full research-brief.md markdown content' },
    question: { type: 'string', description: 'Blocker description — set only if status is blocked' },
    grade:    { type: 'string' },
    gaps:     { type: 'string' },
  },
}

const SOURCER_OUT = {
  type: 'object',
  required: ['status', 'sources_md'],
  properties: {
    status:        { type: 'string', enum: ['complete', 'blocked'] },
    sources_md:    { type: 'string', description: '01-sources.md markdown content' },
    sources_count: { type: 'number' },
    question:      { type: 'string' },
    grade:         { type: 'string' },
    gaps:          { type: 'string' },
  },
}

const ANALYST_OUT = {
  type: 'object',
  required: ['status'],
  properties: {
    status:           { type: 'string', enum: ['complete', 'needs-more-data', 'blocked'] },
    analysis_md:      { type: 'string', description: '02-analysis.md markdown content' },
    hypotheses_count: { type: 'number' },
    research_request: { type: 'string', description: 'Specific gap to fill — set when status is needs-more-data' },
    question:         { type: 'string' },
    grade:            { type: 'string' },
    confidence:       { type: 'number' },
    gaps:             { type: 'string' },
  },
}

const WRITER_OUT = {
  type: 'object',
  required: ['status'],
  properties: {
    status:               { type: 'string', enum: ['complete', 'needs-clarification', 'blocked'] },
    report_md:            { type: 'string', description: 'Primary final-report markdown content' },
    deliverables:         { type: 'array', items: { type: 'string' }, description: 'Filenames of all files written' },
    clarification_needed: { type: 'string', description: 'What additional analysis is needed — set when status is needs-clarification' },
    question:             { type: 'string' },
    grade:                { type: 'string' },
    confidence_assessment: { type: 'string' },
    gaps:                 { type: 'string' },
  },
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
// Message-writing protocol stripped (.ai/tx/msgs/, frontmatter, routing fields).
// Each agent returns via structured output; schema enforces the contract.
// Carry state is appended as JSON at call time by runAgent().

const PROMPTS = {

  interviewer: `You are a Research Interviewer Agent. Your job is to derive a structured research brief from the incoming prompt. Do NOT search the web, answer the research question, or produce analysis. Your only output is a brief and a topic slug.

Assess the prompt against Grade-A criteria:
  Essential (all required): clear research question, in/out scope, 3+ objectives, target audience, 5+ key questions.
  Important (75% required): depth level, purpose/use case, success criteria, constraints/limitations.

If the prompt satisfies Grade-A, derive the brief directly. If underspecified, fill in reasonable defaults and note them in the gaps field.

Use the Write tool to save research-brief.md to the workspace_path found in the carry state below.

Brief structure to use:
# Research Brief
**Status**: Ready for research
## Research Topic
## Scope
### In Scope
### Out of Scope
## Research Objectives (3+, numbered)
## Key Questions to Answer (5+, numbered)
## Target Audience
## Research Depth (Overview / Analysis / Deep-Dive)
## Purpose & Use Case
## Success Criteria
## Constraints & Limitations
## Required Deliverables
### 1. final-report-[topic-slug].md
- Comprehensive report with inline citations, no separate bibliography
**Grade**: A (Ready for research)

Your final output is returned directly via structured output. Set status "complete" with the topic slug and full brief markdown. Set "blocked" only if the prompt is too ambiguous to derive any brief.`,

  sourcer: `You are a Research Sourcer Agent. Gather web sources aligned with the research brief, then write 01-sources.md to the workspace.

The carry state appended below contains: workspace_path, brief, and optionally research_request (a specific gap to fill from the analyst). If research_request is present, perform a targeted search on that question rather than a broad sweep.

Workflow:
1. Parse objectives and key questions from carry.brief.
2. Formulate 3-5 search queries from the key questions.
3. Run WebSearch for each query.
4. Compile 5-10 quality sources with key facts and relevance ratings.
5. Use the Write tool to save 01-sources.md to [carry.workspace_path]/01-sources.md.
6. Return sources_md with the full document content.

Sources document format:
# Research Sources & Facts
## Topic: [from brief]
## Sources Found
### Source N: [Title]
- **URL**: [url]
- **Type**: Academic / Industry / News / Official / Blog
- **Summary**: [2-3 lines]
- **Key Facts**: [bullets]
- **Relevance**: High / Medium
[5-10 sources minimum]
## Summary
- **Total sources**: N
- **Key facts extracted**: N
- **Domains covered**: [list]
- **Source quality**: [assessment]
## Search Queries Used: [list]

Your final output is returned directly via structured output. Set status "complete" once 01-sources.md is written. Set "blocked" if search is unavailable.`,

  analyst: `You are a Research Analyst Agent. Analyze research sources and formulate 3-5 distinct hypotheses with supporting evidence.

The carry state appended below contains: workspace_path, brief, sources_md, and optionally research_request from a prior needs-more-data round.

Workflow:
1. Read research-brief.md and 01-sources.md from carry.workspace_path.
2. Identify patterns, themes, and contradictions across sources.
3. If critical gaps prevent forming 3+ well-supported hypotheses, return status "needs-more-data" and describe the specific gap in research_request.
4. Formulate 3-5 hypotheses: statement, supporting evidence (cite specific sources), confidence (High/Medium/Low), key assumptions.
5. Use the Write tool to save 02-analysis.md to [carry.workspace_path]/02-analysis.md.
6. Return analysis_md with the full document content.

Analysis document format:
# Research Analysis & Hypotheses
## Source Analysis Summary
### Key Themes Identified (numbered)
### Patterns Observed (bullets)
### Contradictions Found (bullets)
## Proposed Hypotheses
### Hypothesis N: [Title]
- **Statement**: [clear, testable]
- **Supporting Evidence**: [bullets with source refs]
- **Confidence**: High / Medium / Low
- **Key Assumptions**: [bullets]
[3-5 hypotheses]
## Cross-Hypothesis Analysis (relationships, conflicts, overall assessment)
## Knowledge Gaps (identified gaps, recommended research)

Rules: always cite specific sources, be explicit about confidence, note contradictions between sources.

Your final output is returned directly via structured output. Set status "complete" once 02-analysis.md is written. Set "needs-more-data" if additional sourcing is required (describe the gap in research_request). Set "blocked" for irresolvably conflicting or unclear data.`,

  writer: `You are a Research Writer Agent. Synthesize research materials into final deliverable document(s) with inline citations.

The carry state appended below contains: workspace_path, brief, sources_md, analysis_md, and optionally clarification_needed from a prior needs-clarification round.

Workflow:
1. Read research-brief.md, 01-sources.md, and 02-analysis.md from carry.workspace_path.
2. Read the "Required Deliverables" section of the brief — create EVERY file listed.
3. Always create at minimum: final-report-[topic-slug].md in carry.workspace_path.
4. Use the Write tool to save all deliverables to carry.workspace_path.

Style: conversational (explain like to a smart friend), engaging (storytelling, hooks), inline citations only (no bibliography), balanced multiple perspectives, clear headings.

Report structure:
# [Engaging Title]
[Hook paragraph — interesting angle or surprising fact]
## [Theme sections with inline citations: According to [Source](url), ...]
## The Big Picture (synthesis — connect the dots)
## What This Means (conclusion with clear takeaway)
---
*Sources: N references cited*

Return the primary report content in report_md and list all created filenames in deliverables.

Your final output is returned directly via structured output. Set status "complete" once all deliverables are written. Set "needs-clarification" if the analysis is insufficient (describe what is needed in clarification_needed). Set "blocked" only if required workspace files are missing.`,
}

// ─── Dispatch maps ────────────────────────────────────────────────────────────

const MODELS = {
  interviewer: 'sonnet',
  sourcer:     'sonnet',
  analyst:     'sonnet',
  writer:      'sonnet',
}

const PHASES = {
  interviewer: 'Interview',
  sourcer:     'Source',
  analyst:     'Analyze',
  writer:      'Write',
}

const SCHEMAS = {
  interviewer: INTERVIEWER_OUT,
  sourcer:     SOURCER_OUT,
  analyst:     ANALYST_OUT,
  writer:      WRITER_OUT,
}

// ─── Agent runner ─────────────────────────────────────────────────────────────

function runAgent(name, carry) {
  const prompt = PROMPTS[name] + '\n\n---\nCarry state:\n' + JSON.stringify(carry, null, 2)
  return agent(prompt, {
    label:  name,
    phase:  PHASES[name],
    schema: SCHEMAS[name],
    model:  MODELS[name],
  })
}

// ─── Main control flow ────────────────────────────────────────────────────────

const taskPrompt = (args && typeof args === 'object' && args.prompt)
  ? args.prompt
  : (typeof args === 'string' ? args : '')

const initialSlug = (args && typeof args === 'object' && args.topic_slug)
  ? args.topic_slug
  : 'current'

let current = 'interviewer'
let carry   = { prompt: taskPrompt, workspace_path: WORKSPACE_ROOT + '/' + initialSlug }
let hops    = 0

while (current !== 'done' && ++hops <= MAX_HOPS) {
  log('→ ' + current + ' (hop ' + hops + '/' + MAX_HOPS + ')')

  const r = await runAgent(current, carry)

  // Thread prior artifacts forward; workspace_path is never replaced by agent output
  if (r.topic)                carry.topic       = r.topic
  if (r.brief)                carry.brief       = r.brief
  if (r.sources_md)           carry.sources_md  = r.sources_md
  if (r.analysis_md)          carry.analysis_md = r.analysis_md
  if (r.report_md)            carry.report_md   = r.report_md
  if (r.deliverables)         carry.deliverables = r.deliverables
  if (r.grade)                carry.grade       = r.grade
  if (r.confidence != null)   carry.confidence  = r.confidence
  if (r.research_request)     carry.research_request = r.research_request
  if (r.clarification_needed) carry.clarification_needed = r.clarification_needed

  // Resolve workspace path as soon as the topic slug is known
  if (r.topic && carry.workspace_path === WORKSPACE_ROOT + '/current') {
    carry.workspace_path = WORKSPACE_ROOT + '/' + r.topic
    log('workspace → ' + carry.workspace_path)
  }

  switch (current + ':' + r.status) {
    case 'interviewer:complete':
      log('interviewer → sourcer (brief ready, topic: ' + (carry.topic || '?') + ')')
      current = 'sourcer'
      break

    case 'interviewer:blocked':
      log('interviewer blocked: ' + (r.question || 'no question provided'))
      return { status: 'blocked', at: 'interviewer', question: r.question, state: carry }

    case 'sourcer:complete':
      log('sourcer → analyst (' + (r.sources_count || '?') + ' sources collected)')
      delete carry.research_request  // consumed; clear so analyst sees clean state
      current = 'analyst'
      break

    case 'sourcer:blocked':
      log('sourcer blocked: ' + (r.question || 'no question provided'))
      return { status: 'blocked', at: 'sourcer', question: r.question, state: carry }

    case 'analyst:complete':
      log('analyst → writer (' + (r.hypotheses_count || '?') + ' hypotheses)')
      current = 'writer'
      break

    case 'analyst:needs-more-data':
      log('analyst → sourcer (gap: ' + (r.research_request || '') + ')')
      current = 'sourcer'
      break

    case 'analyst:blocked':
      log('analyst blocked: ' + (r.question || 'no question provided'))
      return { status: 'blocked', at: 'analyst', question: r.question, state: carry }

    case 'writer:complete':
      log('writer → done (deliverables: ' + (r.deliverables || []).join(', ') + ')')
      current = 'done'
      break

    case 'writer:needs-clarification':
      log('writer → analyst (needs: ' + (r.clarification_needed || '') + ')')
      current = 'analyst'
      break

    case 'writer:blocked':
      log('writer blocked: ' + (r.question || 'no question provided'))
      return { status: 'blocked', at: 'writer', question: r.question, state: carry }

    default:
      log('unexpected status: ' + current + ':' + r.status)
      return { status: 'blocked', at: current, question: 'Unexpected status: ' + r.status, state: carry }
  }
}

if (hops > MAX_HOPS) {
  log('MAX_HOPS (' + MAX_HOPS + ') exceeded — pipeline did not converge at: ' + current)
  return { status: 'blocked', at: current, question: 'Exceeded hop limit ' + MAX_HOPS, state: carry }
}

return {
  status:       'complete',
  topic:        carry.topic,
  workspace:    carry.workspace_path,
  deliverables: carry.deliverables || [],
  grade:        carry.grade,
  confidence:   carry.confidence,
}

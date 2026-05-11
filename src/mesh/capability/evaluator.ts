/**
 * FactoryEvaluator - Self-evaluation for factory-generated meshes
 *
 * Implements three feedback loops, modeled on Hyperagents (arxiv 2603.19461):
 *  1. Compile-time capability coverage — mechanical check that the generated
 *     mesh actually addresses every requested capability value.
 *  2. Run-time evaluation — a one-shot LLM (haiku) scores a completed mesh run
 *     against the capabilities it was generated for.
 *  3. Metacognitive reflection — an LLM reads the archive of scored runs and
 *     emits pinned heuristics that bias future fragment selection.
 *
 * Persistence lives alongside each archived mesh under
 * `.ai/tx/archived-meshes/{hash}-{meshName}/`:
 *   coverage.yaml        — compile-time coverage report
 *   runs/{runId}.yaml    — one per evaluated run
 *   score.yaml           — rolling aggregate consumed by the factory router
 * and project-wide reflection under `.ai/tx/archived-meshes/_meta/insights.yaml`.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { log } from '../../shared/logger.ts';
import type { CapabilityNeeded, CapabilityDeclaration } from './schema.ts';

const COMPONENT = 'factory-eval';

/** Sub-directory (under archived-meshes) holding project-wide reflection output. */
export const META_DIR = '_meta';
/** Reflection output filename. */
export const INSIGHTS_FILE = 'insights.yaml';
/** Per-mesh aggregate score filename. */
export const SCORE_FILE = 'score.yaml';
/** Per-mesh coverage report filename. */
export const COVERAGE_FILE = 'coverage.yaml';
/** Per-mesh run-eval sub-directory. */
export const RUNS_DIR = 'runs';

/** A generated mesh whose rolling score falls below this (with >= MIN_RUNS) is recompiled rather than reused. */
const RECOMPILE_THRESHOLD = 0.45;
const MIN_RUNS_FOR_RECOMPILE = 2;

const ARRAY_FIELDS = ['domain', 'input', 'output', 'tools', 'interaction'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageReport {
  requested: Record<string, string[]>;
  covered: Record<string, string[]>;
  missing: Record<string, string[]>;
  score: number; // covered / requested across all fields
  checkedAt: string;
}

export interface RunEval {
  runId: string;
  meshName: string;
  capHash: string;
  evaluatedAt: string;
  outcome: 'complete' | 'incomplete' | 'unknown';
  metrics: { workerCount?: number; durationMs?: number; costUsd?: number } | null;
  scores: { capabilityFit: number; outputQuality: number; efficiency: number };
  overall: number;
  notes: string;
  recommendations: string[];
}

export interface ArchiveScore {
  meshName: string;
  capHash: string;
  runs: number;
  coverageScore: number | null;
  avgCapabilityFit: number;
  avgOutputQuality: number;
  avgEfficiency: number;
  avgOverall: number;
  lastOverall: number;
  recommendRecompile: boolean;
  updatedAt: string;
}

export interface InsightsDoc {
  generatedAt: string;
  archivesAnalyzed: number;
  insights: Array<{ topic: string; heuristic: string; evidence: string }>;
}

// ---------------------------------------------------------------------------
// Loop 1 — compile-time capability coverage
// ---------------------------------------------------------------------------

/**
 * Mechanically check whether a freshly-compiled mesh addresses every requested
 * capability value. A value is "covered" when a fragment file named for it was
 * available to the factory (domain/<v>, tools/<v>, interaction/<v>) or when the
 * generated config records it in its capability block (input/output are recorded
 * structurally rather than via prompt fragments).
 */
export function checkCoverage(
  needed: CapabilityNeeded,
  outputDir: string,
  fragmentsDir: string,
): CoverageReport {
  const requested: Record<string, string[]> = {};
  const covered: Record<string, string[]> = {};
  const missing: Record<string, string[]> = {};

  const configCapability = readGeneratedCapability(outputDir);

  for (const field of ARRAY_FIELDS) {
    const values = [...((needed[field] as readonly string[]) ?? [])];
    requested[field] = values;
    covered[field] = [];
    missing[field] = [];

    for (const value of values) {
      if (isValueCovered(field, value, fragmentsDir, configCapability)) {
        covered[field].push(value);
      } else {
        missing[field].push(value);
      }
    }
  }

  const totalRequested = Object.values(requested).reduce((n, a) => n + a.length, 0);
  const totalCovered = Object.values(covered).reduce((n, a) => n + a.length, 0);
  const score = totalRequested === 0 ? 1 : totalCovered / totalRequested;

  return { requested, covered, missing, score, checkedAt: new Date().toISOString() };
}

function isValueCovered(
  field: string,
  value: string,
  fragmentsDir: string,
  configCapability: CapabilityDeclaration | null,
): boolean {
  // input/output are not fragment-backed — they're satisfied if the generated
  // config records them in its declared capability block.
  if (field === 'input' || field === 'output') {
    const declared = (configCapability?.[field as 'input' | 'output'] as readonly string[] | undefined) ?? [];
    return declared.includes(value);
  }

  // domain/tools/interaction map to fragment files; coverage = fragment exists.
  const subdir = field === 'tools' ? 'tools' : field; // domain | tools | interaction
  for (const ext of ['.yaml', '.yml']) {
    if (fs.existsSync(path.join(fragmentsDir, subdir, `${value}${ext}`))) return true;
  }
  // 'none' interaction needs no fragment.
  if (field === 'interaction' && value === 'none') return true;
  return false;
}

function readGeneratedCapability(outputDir: string): CapabilityDeclaration | null {
  try {
    const raw = fs.readFileSync(path.join(outputDir, 'config.yaml'), 'utf-8');
    const parsed = YAML.parse(raw);
    if (parsed?.capability && typeof parsed.capability === 'object') {
      return parsed.capability as CapabilityDeclaration;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Write a coverage report into a mesh directory (used for both the live dir and the archive copy). */
export function writeCoverageReport(dir: string, report: CoverageReport): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, COVERAGE_FILE), YAML.stringify(report), 'utf-8');
  } catch (err) {
    log.warn(COMPONENT, `Failed to write coverage report: ${String(err)}`, { dir });
  }
}

// ---------------------------------------------------------------------------
// Archive locator
// ---------------------------------------------------------------------------

/** Resolve the archive directory for a generated mesh from its `.factory-meta.json`, if present. */
export function resolveArchiveDir(generatedMeshDir: string, archivedMeshesRoot: string): string | null {
  try {
    const metaPath = path.join(generatedMeshDir, '.factory-meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { archiveName?: string };
      if (meta.archiveName) {
        const dir = path.join(archivedMeshesRoot, meta.archiveName);
        if (fs.existsSync(dir)) return dir;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Loop 2 — run-time evaluation (LLM, haiku, one-shot)
// ---------------------------------------------------------------------------

export interface RunEvalInput {
  meshName: string;
  capHash: string;
  runId: string;
  capabilities: unknown; // CapabilityNeeded | CapabilityDeclaration | raw YAML — only serialized into the eval prompt
  configSummary: string;
  agentOutputs: string;
  gitDiffSummary?: string;
  outcome: 'complete' | 'incomplete' | 'unknown';
  metrics?: { workerCount?: number; durationMs?: number; costUsd?: number } | null;
}

/**
 * Score a completed mesh run with a one-shot haiku call. Returns null on any
 * failure (LLM unavailable, malformed output) — callers must treat eval as
 * best-effort.
 */
export async function evaluateMeshRun(input: RunEvalInput): Promise<RunEval | null> {
  const prompt = buildRunEvalPrompt(input);

  let response = '';
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    for await (const message of query({
      prompt,
      options: { model: 'haiku', maxTurns: 1, permissionMode: 'dontAsk', allowedTools: [] },
    })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text') response += block.text;
        }
      }
    }
  } catch (err) {
    log.warn(COMPONENT, 'Run-eval LLM query failed', { error: String(err), meshName: input.meshName });
    return null;
  }

  const parsed = parseRunEvalResponse(response);
  if (!parsed) return null;

  const scores = {
    capabilityFit: clamp01(parsed.capabilityFit),
    outputQuality: clamp01(parsed.outputQuality),
    efficiency: clamp01(parsed.efficiency),
  };
  const overall = round2(0.5 * scores.capabilityFit + 0.35 * scores.outputQuality + 0.15 * scores.efficiency);

  return {
    runId: input.runId,
    meshName: input.meshName,
    capHash: input.capHash,
    evaluatedAt: new Date().toISOString(),
    outcome: input.outcome,
    metrics: input.metrics ?? null,
    scores,
    overall,
    notes: String(parsed.notes ?? '').slice(0, 2000),
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r: unknown) => String(r)).slice(0, 8)
      : [],
  };
}

function buildRunEvalPrompt(input: RunEvalInput): string {
  return `You are evaluating one run of an auto-generated multi-agent "mesh". Judge how well the mesh — as built — served the capabilities it was generated for, and how cleanly the run executed.

Return ONLY valid YAML, no markdown fences, matching:

capabilityFit: 0.0      # 0-1, did the run actually deliver the requested input->output transformation?
outputQuality: 0.0      # 0-1, quality/usefulness of the produced artifacts
efficiency: 0.0         # 0-1, reasonable worker/turn/cost usage and clean termination?
notes: ""               # 1-3 sentences, the single biggest weakness
recommendations: []     # short imperative fixes for the *mesh generator* (e.g. "add a review agent", "tighten max_turns", "include the git tool fragment")

Requested capabilities:
${YAML.stringify(input.capabilities).trim()}

Mesh config summary:
${input.configSummary.trim()}

Run outcome: ${input.outcome}${input.metrics ? `  (workers=${input.metrics.workerCount ?? '?'}, durationMs=${input.metrics.durationMs ?? '?'}, costUsd=${input.metrics.costUsd ?? '?'})` : ''}

Agent outputs (truncated):
${truncate(input.agentOutputs, 6000)}
${input.gitDiffSummary ? `\nGit diff summary (truncated):\n${truncate(input.gitDiffSummary, 2000)}` : ''}`;
}

function parseRunEvalResponse(response: string): Record<string, unknown> | null {
  let cleaned = response.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  }
  try {
    const parsed = YAML.parse(cleaned);
    if (parsed && typeof parsed === 'object' && 'capabilityFit' in parsed) {
      return parsed as Record<string, unknown>;
    }
    log.warn(COMPONENT, 'Run-eval response missing expected fields', { response: cleaned.slice(0, 500) });
    return null;
  } catch (err) {
    log.warn(COMPONENT, 'Failed to parse run-eval response', { error: String(err), response: cleaned.slice(0, 500) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Archive persistence + aggregate scoring
// ---------------------------------------------------------------------------

/** Persist a run eval into the archive and recompute the rolling aggregate. */
export function recordRunEval(archiveDir: string, evalResult: RunEval): ArchiveScore | null {
  try {
    const runsDir = path.join(archiveDir, RUNS_DIR);
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, `${evalResult.runId}.yaml`), YAML.stringify(evalResult), 'utf-8');
  } catch (err) {
    log.warn(COMPONENT, `Failed to write run eval: ${String(err)}`, { archiveDir });
    return null;
  }
  return recomputeArchiveScore(archiveDir, evalResult.meshName, evalResult.capHash);
}

function recomputeArchiveScore(archiveDir: string, meshName: string, capHash: string): ArchiveScore | null {
  const runsDir = path.join(archiveDir, RUNS_DIR);
  let runFiles: string[] = [];
  try {
    runFiles = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter(f => f.endsWith('.yaml')).sort() : [];
  } catch {
    /* ignore */
  }

  const runs: RunEval[] = [];
  for (const f of runFiles) {
    try {
      const parsed = YAML.parse(fs.readFileSync(path.join(runsDir, f), 'utf-8'));
      if (parsed && typeof parsed === 'object' && 'overall' in parsed) runs.push(parsed as RunEval);
    } catch {
      /* skip */
    }
  }

  let coverageScore: number | null = null;
  try {
    const cov = YAML.parse(fs.readFileSync(path.join(archiveDir, COVERAGE_FILE), 'utf-8'));
    if (cov && typeof cov.score === 'number') coverageScore = cov.score;
  } catch {
    /* ignore */
  }

  const n = runs.length;
  const mean = (sel: (r: RunEval) => number) => (n === 0 ? 0 : round2(runs.reduce((s, r) => s + (sel(r) || 0), 0) / n));
  const avgOverall = mean(r => r.overall);
  const lastOverall = n === 0 ? 0 : (runs[n - 1].overall || 0);

  const score: ArchiveScore = {
    meshName,
    capHash,
    runs: n,
    coverageScore,
    avgCapabilityFit: mean(r => r.scores?.capabilityFit),
    avgOutputQuality: mean(r => r.scores?.outputQuality),
    avgEfficiency: mean(r => r.scores?.efficiency),
    avgOverall,
    lastOverall,
    recommendRecompile: n >= MIN_RUNS_FOR_RECOMPILE && avgOverall < RECOMPILE_THRESHOLD,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(path.join(archiveDir, SCORE_FILE), YAML.stringify(score), 'utf-8');
  } catch (err) {
    log.warn(COMPONENT, `Failed to write archive score: ${String(err)}`, { archiveDir });
  }
  return score;
}

/** Read the rolling aggregate for an archived mesh, if it has been evaluated. */
export function readArchiveScore(archiveDir: string): ArchiveScore | null {
  try {
    const parsed = YAML.parse(fs.readFileSync(path.join(archiveDir, SCORE_FILE), 'utf-8'));
    if (parsed && typeof parsed === 'object' && 'avgOverall' in parsed) return parsed as ArchiveScore;
  } catch {
    /* ignore */
  }
  return null;
}

/** True when a generated mesh has accumulated enough poor evals that it should be recompiled rather than reused. */
export function shouldRecompile(archiveDir: string | null): boolean {
  if (!archiveDir) return false;
  return readArchiveScore(archiveDir)?.recommendRecompile ?? false;
}

// ---------------------------------------------------------------------------
// Loop 3 — metacognitive reflection
// ---------------------------------------------------------------------------

/**
 * Read every archived mesh's score + coverage, ask haiku for cross-mesh
 * heuristics, and write `_meta/insights.yaml`. Returns null when there is
 * nothing to reflect on or the LLM call fails.
 */
export async function reflectOnArchive(archivedMeshesRoot: string): Promise<InsightsDoc | null> {
  if (!fs.existsSync(archivedMeshesRoot)) {
    log.info(COMPONENT, 'No archived meshes — nothing to reflect on');
    return null;
  }

  const dirs = fs.readdirSync(archivedMeshesRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== META_DIR)
    .map(d => path.join(archivedMeshesRoot, d.name));

  const records: string[] = [];
  for (const dir of dirs) {
    const name = path.basename(dir);
    const score = readArchiveScore(dir);
    let coverage: CoverageReport | null = null;
    try {
      coverage = YAML.parse(fs.readFileSync(path.join(dir, COVERAGE_FILE), 'utf-8')) as CoverageReport;
    } catch {
      /* ignore */
    }
    let capability: unknown = null;
    try {
      capability = YAML.parse(fs.readFileSync(path.join(dir, 'source-capabilities.yaml'), 'utf-8'));
    } catch {
      /* ignore */
    }
    if (!score && !coverage) continue;
    records.push(YAML.stringify({ mesh: name, capability, coverage: coverage ? { score: coverage.score, missing: coverage.missing } : null, score }).trim());
  }

  if (records.length === 0) {
    log.info(COMPONENT, 'No evaluated/covered archives — nothing to reflect on');
    return null;
  }

  const prompt = `You are improving an automatic "mesh factory" that assembles multi-agent workflows from prompt fragments and a topology. Below are records of previously generated meshes, each with its capability spec, compile-time coverage report, and (if it ran) rolling evaluation scores.

Find cross-cutting patterns: which capability shapes consistently under-perform, which coverage gaps recur, which topology/guardrail choices correlate with low scores. Output ONLY valid YAML, no fences:

insights:
  - topic: ""        # one of: fragment-selection, topology, guardrails, coverage, tooling, agent-roles
    heuristic: ""    # an imperative rule the factory should apply on the next compile
    evidence: ""     # the observation that justifies it

Keep it to the 3-8 best-supported heuristics. Do not invent patterns not visible in the data.

Records:

${records.join('\n---\n')}`;

  let response = '';
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    for await (const message of query({
      prompt,
      options: { model: 'haiku', maxTurns: 1, permissionMode: 'dontAsk', allowedTools: [] },
    })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text') response += block.text;
        }
      }
    }
  } catch (err) {
    log.warn(COMPONENT, 'Reflection LLM query failed', { error: String(err) });
    return null;
  }

  let cleaned = response.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  let insightsList: Array<{ topic: string; heuristic: string; evidence: string }> = [];
  try {
    const parsed = YAML.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : parsed?.insights;
    if (Array.isArray(arr)) {
      insightsList = arr
        .filter((x: unknown) => x && typeof x === 'object' && 'heuristic' in (x as object))
        .map((x: Record<string, unknown>) => ({
          topic: String(x.topic ?? 'general'),
          heuristic: String(x.heuristic ?? '').slice(0, 400),
          evidence: String(x.evidence ?? '').slice(0, 400),
        }))
        .slice(0, 8);
    }
  } catch (err) {
    log.warn(COMPONENT, 'Failed to parse reflection response', { error: String(err), response: cleaned.slice(0, 500) });
    return null;
  }

  if (insightsList.length === 0) {
    log.warn(COMPONENT, 'Reflection produced no usable insights');
    return null;
  }

  const doc: InsightsDoc = {
    generatedAt: new Date().toISOString(),
    archivesAnalyzed: records.length,
    insights: insightsList,
  };

  try {
    const metaDir = path.join(archivedMeshesRoot, META_DIR);
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, INSIGHTS_FILE), YAML.stringify(doc), 'utf-8');
    log.info(COMPONENT, `Wrote reflection insights`, { count: insightsList.length, archivesAnalyzed: records.length });
  } catch (err) {
    log.warn(COMPONENT, `Failed to write insights: ${String(err)}`, {});
  }
  return doc;
}

/**
 * Read pinned reflection heuristics, rendered as a short markdown block suitable
 * for embedding in generated agent prompts. Returns null when none exist.
 */
export function readInsightsMarkdown(archivedMeshesRoot: string): string | null {
  try {
    const p = path.join(archivedMeshesRoot, META_DIR, INSIGHTS_FILE);
    const doc = YAML.parse(fs.readFileSync(p, 'utf-8')) as InsightsDoc;
    if (!doc?.insights?.length) return null;
    const lines = ['## Factory Guidance', '', '_Heuristics distilled from prior generated-mesh evaluations:_', ''];
    for (const i of doc.insights) lines.push(`- (${i.topic}) ${i.heuristic}`);
    return lines.join('\n');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '\n[truncated]';
}

/**
 * Checklist Audit Post-Hook
 *
 * Generic submission gate. Registered audit profiles declare how to detect
 * a task they apply to, how to collect post-completion evidence, and what
 * checklist items the auditor scores. On block, throws QualityIterationError
 * so the existing iterate-until-done lifecycle handles retry.
 *
 * Responsibilities:
 * - Resolve an audit profile by matching against taskBody
 * - Skip silently when no profile matches (safe to register globally)
 * - Delegate evidence collection to the profile
 * - Run a profile-agnostic Sonnet audit using profile.checklist
 * - Persist verdict to .ai/tx/audit-verdicts/<profile>/<key>.yaml
 * - Throw QualityIterationError with profile-supplied gap feedback on block
 * - Fail-open on auditor crash, parse error, or absent profile
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError } from '../errors.ts';
import { findAuditProfile, type AuditEvidence, type ChecklistItem } from './audit-profiles/index.ts';

const VERDICTS_ROOT = '.ai/tx/audit-verdicts';

interface ItemVerdict {
  id: string;
  name: string;
  status: 'done' | 'partial' | 'missing';
  evidence: string;
  gap: string;
}

interface AuditResult {
  passed: boolean;
  blocking_gaps: string[];
  items: ItemVerdict[];
  summary: string;
}

function renderItemsForPrompt(items: readonly ChecklistItem[]): string {
  return items
    .map((it, i) => `${i + 1}. **${it.id}** — ${it.name}\n   Definition: ${it.description}\n   Blocking: ${it.blocking ? 'yes' : 'no'}`)
    .join('\n');
}

function renderSchemaForPrompt(items: readonly ChecklistItem[]): string {
  return items
    .map(it => `  - id: ${it.id}\n    name: ${JSON.stringify(it.name)}\n    status: done | partial | missing\n    evidence: <pointer or '-'>\n    gap: <what's missing if not done>`)
    .join('\n');
}

function buildAuditPrompt(args: {
  profileName: string;
  items: readonly ChecklistItem[];
  evidence: AuditEvidence;
}): string {
  const { profileName, items, evidence } = args;
  const blockingIds = items.filter(i => i.blocking).map(i => `'${i.id}'`).join(', ');
  const ctx = Object.entries(evidence.contextInfo).map(([k, v]) => `${k}: ${v}`).join('\n');
  const artifact = evidence.artifact.length > 6000
    ? evidence.artifact.slice(0, 3000) + '\n...[artifact truncated]...\n' + evidence.artifact.slice(-3000)
    : evidence.artifact;
  const trajectory = evidence.trajectory ?? '(no trajectory provided)';

  return `You are an independent auditor checking a coding agent's work against a fixed completion checklist before its work is submitted. You have not seen the agent's reasoning — only the artifact it produced and the trajectory of tool calls it made.

Audit profile: ${profileName}
${ctx}

Be strict. The agent's prompt told it that you would audit it; if items are missing, that's the agent's fault. Mark items 'missing' liberally — false positives on 'missing' cost one retry; false positives on 'done' submit broken work.

## Checklist items

${renderItemsForPrompt(items)}

## Blocking rule

Items marked Blocking=yes (${blockingIds}) decide 'passed'. If any blocking item is 'missing', the audit blocks. Non-blocking items are recorded but advisory.

## Evidence rules

- 'evidence' must cite a concrete trajectory entry or region of the artifact.
- If you cannot find evidence, status is 'missing'.
- Distinguish "ran a test that failed" from "ran a test that passed AFTER the fix was written" — only the latter satisfies a passing-test item.

## Output schema (return ONLY valid YAML — no fences, no prose)

passed: <bool>
blocking_gaps:
  - <human-readable gap, one per blocking issue, [] if passed>
items:
${renderSchemaForPrompt(items)}
summary: <one sentence overall>

---

Artifact (${evidence.artifactLabel}):

${artifact || '(empty)'}

---

Trajectory (tool log, oldest-first):

${trajectory}
`;
}

function parseAudit(response: string): AuditResult | null {
  let cleaned = response.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  try {
    const parsed = YAML.parse(cleaned);
    if (typeof parsed?.passed !== 'boolean') return null;
    if (!Array.isArray(parsed?.items)) return null;
    return parsed as AuditResult;
  } catch {
    return null;
  }
}

async function callAuditor(prompt: string): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let response = '';
  for await (const message of query({
    prompt,
    // maxTurns must allow Sonnet's internal reasoning even though the auditor
    // has no tools. With maxTurns: 1 the SDK errors with "Reached maximum
    // number of turns (1)" before the response lands. 5 is comfortable.
    options: { model: 'sonnet', maxTurns: 5, permissionMode: 'dontAsk', allowedTools: [] },
  })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text') response += block.text;
      }
    }
  }
  return response;
}

function defaultGapFeedback(blockingGaps: string[]): string {
  const gaps = blockingGaps.map(g => `  - ${g}`).join('\n');
  return `## Auditor blocked your previous submission

The independent auditor reviewed your work and found these gaps:

${gaps}

Address each gap with concrete evidence and re-submit.`;
}

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const taskBody = context.taskBody ?? '';

  const profile = findAuditProfile(taskBody);
  if (!profile) {
    log.info('checklist-audit', 'No audit profile matched task body — skipping', { agentId });
    return;
  }

  log.activity('checklist-audit', agentId, `Auditing via profile=${profile.name}`);

  let evidence: AuditEvidence;
  try {
    evidence = await profile.collectEvidence(taskBody);
  } catch (err) {
    log.warn('checklist-audit', 'Evidence collection failed — fail-open', { profile: profile.name, error: String(err) });
    return;
  }

  const prompt = buildAuditPrompt({ profileName: profile.name, items: profile.checklist, evidence });

  let response = '';
  try {
    response = await callAuditor(prompt);
  } catch (err) {
    log.warn('checklist-audit', 'Auditor query failed — fail-open', { profile: profile.name, error: String(err) });
    return;
  }

  const result = parseAudit(response);
  const verdictDir = path.join(VERDICTS_ROOT, profile.name);
  fs.mkdirSync(verdictDir, { recursive: true });
  const verdictPath = path.join(verdictDir, `${evidence.key}.yaml`);

  if (!result) {
    fs.writeFileSync(
      verdictPath,
      `parse_error: true\nraw: |\n  ${response.slice(0, 2000).replace(/\n/g, '\n  ')}\n`,
      'utf-8',
    );
    log.warn('checklist-audit', 'Audit response parse failed — fail-open', { profile: profile.name, key: evidence.key });
    return;
  }

  fs.writeFileSync(verdictPath, YAML.stringify({ profile: profile.name, ...result }), 'utf-8');

  const doneCount = result.items.filter(i => i.status === 'done').length;
  const summary = `${result.passed ? 'PASS' : 'BLOCK'} (${doneCount}/${result.items.length} done): ${result.summary}`;
  log.activity('checklist-audit', agentId, summary);
  utils.writeResultMessage(context, `checklist-audit:${profile.name}`, result.passed, summary, {
    profile: profile.name,
    key: evidence.key,
    blocking_gaps: result.blocking_gaps,
    items: result.items.map(i => ({ id: i.id, status: i.status })),
  });

  if (!result.passed) {
    const feedback = profile.buildGapFeedback
      ? profile.buildGapFeedback(result.blocking_gaps, evidence)
      : defaultGapFeedback(result.blocking_gaps);
    throw new QualityIterationError(feedback);
  }
};

export const checklistAuditHook: HookDefinition = {
  name: 'checklist-audit',
  phase: 'post',
  priority: 50,
  description: 'Generic submission gate. Iterates registered audit profiles, picks the first match, runs Sonnet against profile-supplied evidence + checklist, throws QualityIterationError on block to drive retry.',
  handler,
};

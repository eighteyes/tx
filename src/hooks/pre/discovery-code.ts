/**
 * Discovery Code Pre-Hook
 *
 * Runs before the mesh worker spawns. Reads the spec-graph for project intent,
 * scans the codebase for implementation gaps, and writes gap-report.md to the
 * workspace so it's in-context when the worker starts.
 *
 * If project intent is ambiguous (no spec-graph, unclear structure), asks human
 * via HITL and writes a partial report so the worker can proceed with what's known.
 *
 * Idempotent: if gap-report.md already exists in the workspace (written by
 * validation-code on a previous iteration), skips discovery and lets the
 * updated report stand.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { gatherProjectContext, writeStatusToCore } from '../utils/code-context.ts';

// ─── Claude Discovery Agent ─────────────────────────────────────────────────

async function runDiscoveryAgent(
  projectContext: string,
  taskContext: string,
  workDir: string
): Promise<{ report: string; confused: boolean; confusedReason?: string }> {
  const client = new Anthropic();

  const systemPrompt = `You are a software discovery agent. Your job is to analyze a codebase and produce a gap report identifying what is implemented, what is stubbed/mocked, and what is missing entirely.

You analyze three axes for each feature:
- **Backend**: Is the server-side logic, API handler, database interaction, or service layer implemented?
- **Web UI**: Is there a user interface for this feature? Is it wired to real data or mocked?
- **End-to-End**: Is the backend connected to the UI? Can a user actually use this feature?

Status values:
- ✅ Full — fully implemented and connected
- ⚠️ Partial/Stubbed — exists but incomplete, stubbed, or mocked
- ❌ Missing — not implemented

Output a gap-report.md with:
1. A summary table (feature × axis)
2. A "Key Findings" section with the most important gaps
3. A "Priority Order" section — which gaps to fix first (highest value, lowest effort)
4. A "Confused About" section IF anything is unclear — specific questions for the human

If the spec-graph is missing, infer feature intent from the code structure. If the project structure is ambiguous, flag it in "Confused About" and do your best with what's available.

Be concrete. Reference actual file paths when noting what exists or is missing. Do not hallucinate implementations that don't exist.`;

  const userPrompt = `## Task Context
${taskContext || '(no specific task context)'}

## Project Context
${projectContext}

---

Produce gap-report.md for this project. Identify every feature area visible in the spec-graph (or inferred from code), check each axis (backend/UI/e2e), and write the report.

If you're confused about the project's intent and cannot determine it from the spec-graph or code structure, set confused: true in your response and explain why.

Format your response as:

\`\`\`
CONFUSED: true|false
REASON: (if confused, explain what's unclear)
---
[full gap-report.md content below]
---
\`\`\``;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse confused flag and report content
  const confusedMatch = text.match(/CONFUSED:\s*(true|false)/i);
  const reasonMatch = text.match(/REASON:\s*(.+?)(?=\n---|\n\[|$)/is);
  const reportMatch = text.match(/---\n([\s\S]+?)(?:\n---\s*$|$)/);

  const confused = confusedMatch?.[1]?.toLowerCase() === 'true';
  const confusedReason = reasonMatch?.[1]?.trim();
  const report = reportMatch?.[1]?.trim() || text;

  return { report, confused, confusedReason };
}

// ─── Hook Handler ───────────────────────────────────────────────────────────

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const workDir = utils.workDir;

  // Workspace dir — where gap-report.md will land (injected into worker context)
  const workspaceDir = path.join(workDir, '.ai', 'tx', 'workspaces', context.meshName || 'discovery');
  fs.mkdirSync(workspaceDir, { recursive: true });

  const gapReportPath = path.join(workspaceDir, 'gap-report.md');

  // Idempotency: skip if gap-report.md already exists.
  // This handles two cases:
  //   1. Subsequent agents in the same mesh run (analyzer, specifier, etc.)
  //   2. Validation-code updated gap-report.md for next iteration — use that, don't overwrite.
  if (fs.existsSync(gapReportPath)) {
    log.debug('hooks', 'discovery-code: gap-report.md exists, skipping (use existing)', {
      path: gapReportPath,
      meshInstance: context.meshInstance,
    });
    return;
  }

  log.info('hooks', 'discovery-code: starting gap analysis', {
    meshInstance: context.meshInstance,
    agentId: context.agentId,
  });

  writeStatusToCore(
    context,
    '🔍 Discovering implementation gaps…',
    `Scanning codebase and spec-graph for feature × axis gaps (backend / UI / e2e).`,
    context.msgsDir,
  );

  try {
    // Gather project context (spec-graph, file structure, tech stack)
    log.info('hooks', 'discovery-code: gathering project context', { workDir });
    const projectContext = gatherProjectContext(workDir);

    // Run discovery agent
    log.info('hooks', 'discovery-code: running discovery agent');
    const { report, confused, confusedReason } = await runDiscoveryAgent(
      projectContext,
      context.taskBody || '',
      workDir
    );

    // Write gap-report.md to workspace (injected into worker)
    fs.writeFileSync(gapReportPath, report, 'utf-8');
    log.info('hooks', 'discovery-code: gap report written', { path: gapReportPath });

    // Count gaps from report (❌ Missing items)
    const missingCount = (report.match(/❌/g) || []).length;
    const partialCount = (report.match(/⚠️/g) || []).length;
    const statusLine = missingCount + partialCount > 0
      ? `**${missingCount} missing**, **${partialCount} partial** — agents have their target.`
      : `No obvious gaps found — agents will verify.`;

    writeStatusToCore(
      context,
      `📋 Gap analysis complete`,
      `Discovery scan finished. ${statusLine}\n\nFull report injected into agent context.`,
      context.msgsDir,
    );

    // If confused — ask human and note it in the report header
    if (confused && confusedReason) {
      log.warn('hooks', 'discovery-code: agent confused, asking human', { reason: confusedReason });

      const askBody = `## Discovery Agent Needs Clarification

The discovery agent analyzed your project but is unclear about project intent:

**Question**: ${confusedReason}

Please respond with:
- What the project does (brief description)
- Which features you want the mesh to focus on
- Any relevant context about the backend/frontend structure

The gap report has been written with best-effort analysis. The mesh will proceed using the partial report — your response will improve the next discovery pass.`;

      if (context.systemWriter) {
        context.systemWriter.write({
          to: 'core/core',
          from: `${context.meshName}/${context.agentName}`,
          headline: 'Discovery agent needs project clarification',
          body: askBody,
        });
      } else {
        const timestamp = Math.floor(Date.now() / 1000);
        const msgId = `discovery-ask-${context.taskId || Date.now()}`;
        const msgsDir = context.msgsDir || path.join(workDir, '.ai', 'tx', 'msgs');
        const filename = `${timestamp}-ask-${context.meshName}-${context.agentName}--core-core-${msgId}.md`;
        const content = `---\nto: core/core\nfrom: ${context.meshName}/${context.agentName}\nmsg-id: ${msgId}\nheadline: Discovery agent needs project clarification\ntimestamp: ${new Date().toISOString()}\nhuman: true\n---\n\n${askBody}\n`;
        fs.writeFileSync(path.join(msgsDir, filename), content, 'utf-8');
      }
    }

  } catch (error) {
    const msg = (error as Error).message;
    log.error('hooks', 'discovery-code: failed', { error: msg, meshInstance: context.meshInstance });

    // Write a minimal stub so the worker can still run
    const stub = `# Gap Report — Discovery Failed\n\n**Error**: ${msg}\n\nThe discovery pre-hook failed to analyze the project. Proceed with manual gap analysis or re-run after fixing the error.\n`;
    fs.writeFileSync(gapReportPath, stub, 'utf-8');
  }
};

// ─── Export ─────────────────────────────────────────────────────────────────

export const discoveryCodeHook: HookDefinition = {
  name: 'discovery-code',
  phase: 'pre',
  priority: 10, // Run early — output is consumed by the worker
  description: 'Analyzes codebase gaps using spec-graph for intent. Writes gap-report.md to workspace before worker spawns. Idempotent — skips if report already exists.',
  handler,
};

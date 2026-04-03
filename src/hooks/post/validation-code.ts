/**
 * Validation Code Post-Hook
 *
 * Runs after the orchestrator agent completes and signals mesh done (routes to core/core).
 * Re-analyzes the codebase for remaining implementation gaps. If gaps remain and
 * iterations haven't been exhausted, updates gap-report.md and re-triggers the mesh
 * with a fresh session (no fork_from). If all gaps closed, lets the normal
 * completion flow continue. If max iterations reached, escalates to human.
 *
 * Works in tandem with discovery-code pre-hook:
 *   discovery-code: writes gap-report.md on first run (skips if exists)
 *   validation-code: re-analyzes after completion, overwrites gap-report.md for next iteration
 *
 * The iteration counter (iteration.txt) persists across loops in the workspace dir.
 * To reset: delete the workspace dir or run `tx mesh clear <mesh>`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { gatherProjectContext, writeStatusToCore } from '../utils/code-context.ts';

const DEFAULT_MAX_ITERATIONS = 5;

// ─── Claude Validation Agent ────────────────────────────────────────────────

interface ValidationResult {
  report: string;        // Updated gap-report.md content
  gapCount: number;      // Total remaining gaps (❌ + ⚠️ items)
  remainingGaps: string; // Human-readable summary of what's still broken
}

async function runValidationAgent(
  projectContext: string,
  priorGapReport: string,
  taskContext: string,
): Promise<ValidationResult> {
  const client = new Anthropic();

  const systemPrompt = `You are a software validation agent. A previous implementation pass attempted to close the gaps in the gap report. Your job is to re-analyze the codebase and determine what is STILL missing or broken.

Focus on concrete verification — look at the actual code, not assumptions. For each gap that was previously identified:
- Check if it was actually implemented
- Check if the backend and UI are connected end-to-end
- Check if the feature is functional (not just stubbed)

Status values:
- ✅ Full — fully implemented and connected
- ⚠️ Partial/Stubbed — exists but incomplete, stubbed, or mocked
- ❌ Missing — not implemented

Output an updated gap-report.md with:
1. An updated summary table (feature × axis) — mark improvements clearly
2. A "Remaining Gaps" section — only what's still broken
3. A "What Was Fixed" section — what improved since last pass
4. A gap count in the format: GAP_COUNT: <number> (total ❌ + ⚠️ items)

Be precise. Reference file paths. Do not mark something as done unless you can see the implementation.`;

  const userPrompt = `## Task Context
${taskContext || '(no specific task context)'}

## Prior Gap Report (from previous iteration)
${priorGapReport}

## Current Project State
${projectContext}

---

Re-analyze the project. What gaps from the prior report are now fixed? What still remains?

Format your response as:

\`\`\`
GAP_COUNT: <number>
---
[full updated gap-report.md content below]
---
REMAINING_GAPS:
[bullet list of remaining gaps — one per line, concise]
\`\`\``;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse gap count
  const gapCountMatch = text.match(/GAP_COUNT:\s*(\d+)/i);
  const gapCount = parseInt(gapCountMatch?.[1] || '1', 10);

  // Parse report content
  const reportMatch = text.match(/---\n([\s\S]+?)(?:\n---\s*$|\nREMAINING_GAPS:|$)/);
  const report = reportMatch?.[1]?.trim() || text;

  // Parse remaining gaps summary
  const remainingGapsMatch = text.match(/REMAINING_GAPS:\n([\s\S]+?)(?:\n```|$)/);
  const remainingGaps = remainingGapsMatch?.[1]?.trim() || '(see updated gap report)';

  return { report, gapCount, remainingGaps };
}

// ─── Hook Handler ───────────────────────────────────────────────────────────

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  // Only run after the orchestrator agent (the mesh coordinator / completion agent)
  if (context.agentName !== 'orchestrator') return;

  // Only run when the orchestrator is completing the mesh — detected by routing to core/core
  const output = context.workerOutput || '';
  if (!output.includes('to: core/core')) return;

  const workDir = utils.workDir;
  const meshName = context.meshName || 'validation';

  // Workspace dir — shared with discovery-code
  const workspaceDir = path.join(workDir, '.ai', 'tx', 'workspaces', meshName);
  fs.mkdirSync(workspaceDir, { recursive: true });

  const gapReportPath = path.join(workspaceDir, 'gap-report.md');
  const iterationFile = path.join(workspaceDir, 'iteration.txt');

  // Read iteration counter
  let iteration = 1;
  try {
    iteration = parseInt(fs.readFileSync(iterationFile, 'utf-8').trim(), 10) || 1;
  } catch { /* first iteration */ }

  log.info('hooks', 'validation-code: re-validating after mesh completion', {
    meshInstance: context.meshInstance,
    meshName,
    iteration,
    maxIterations: DEFAULT_MAX_ITERATIONS,
  });

  writeStatusToCore(
    context,
    `🔄 Validating implementation (iteration ${iteration}/${DEFAULT_MAX_ITERATIONS})…`,
    `Mesh signaled complete. Re-scanning codebase to verify gaps were closed.`,
    context.msgsDir,
  );

  try {
    // Read prior gap report (written by discovery-code or previous validation pass)
    const priorGapReport = fs.existsSync(gapReportPath)
      ? fs.readFileSync(gapReportPath, 'utf-8')
      : '(no prior gap report found)';

    // Re-gather project context and run validation
    const projectContext = gatherProjectContext(workDir);
    const { report, gapCount, remainingGaps } = await runValidationAgent(
      projectContext,
      priorGapReport,
      context.taskBody || '',
    );

    log.info('hooks', 'validation-code: analysis complete', {
      meshName,
      iteration,
      gapCount,
    });

    if (gapCount === 0) {
      // All gaps resolved — let the normal completion flow continue
      log.info('hooks', 'validation-code: all gaps resolved, mesh complete', {
        meshName,
        iteration,
      });

      writeStatusToCore(
        context,
        `✅ All gaps resolved — mesh complete`,
        `Validation passed after ${iteration} iteration${iteration === 1 ? '' : 's'}. Every feature axis is wired end-to-end.`,
        context.msgsDir,
      );

      // Clean up iteration counter so next fresh run starts at 1
      try { fs.unlinkSync(iterationFile); } catch { /* ok */ }
      return;
    }

    // Gaps remain — update gap-report.md with latest analysis
    // (discovery-code will see the file exists and skip on next iteration)
    fs.writeFileSync(gapReportPath, report, 'utf-8');
    log.info('hooks', 'validation-code: updated gap-report.md', { gapCount, path: gapReportPath });

    if (iteration >= DEFAULT_MAX_ITERATIONS) {
      // Exhausted iterations — escalate to human
      log.warn('hooks', 'validation-code: max iterations reached, escalating to human', {
        meshName,
        iteration,
        gapCount,
      });

      const escalationBody = `## UI Completion Stalled After ${iteration} Iteration${iteration === 1 ? '' : 's'}

**${gapCount} implementation gap(s) remain** after ${iteration} iteration${iteration === 1 ? '' : 's'}.

### Remaining Gaps

${remainingGaps}

### What To Do

1. Review the updated \`gap-report.md\` in the mesh workspace
2. Manually fix the remaining gaps or provide additional context
3. Re-run: \`tx msg ${meshName}/orchestrator "Continue from where we left off"\`

The workspace and gap report are preserved at: \`.ai/tx/workspaces/${meshName}/\``;

      const timestamp = Math.floor(Date.now() / 1000);
      const msgId = `validation-escalate-${Date.now()}`;
      const msgsDir = context.msgsDir || path.join(workDir, '.ai', 'tx', 'msgs');

      if (context.systemWriter) {
        context.systemWriter.write({
          to: 'core/core',
          from: `${meshName}/validation`,
          headline: `UI completion stalled after ${iteration} iteration${iteration === 1 ? '' : 's'} — ${gapCount} gap(s) remain`,
          body: escalationBody,
        });
      } else {
        const filename = `${timestamp}-ask-${meshName}-validation--core-core-${msgId}.md`;
        const content = `---\nto: core/core\nfrom: ${meshName}/validation\nmsg-id: ${msgId}\nheadline: UI completion stalled after ${iteration} iteration${iteration === 1 ? '' : 's'} — ${gapCount} gap(s) remain\ntimestamp: ${new Date().toISOString()}\nhuman: true\n---\n\n${escalationBody}\n`;
        fs.writeFileSync(path.join(msgsDir, filename), content, 'utf-8');
      }

      // Reset iteration counter after escalation
      try { fs.unlinkSync(iterationFile); } catch { /* ok */ }
      return;
    }

    // Gaps remain + iterations left — re-trigger with fresh session
    const nextIteration = iteration + 1;
    fs.writeFileSync(iterationFile, String(nextIteration), 'utf-8');

    writeStatusToCore(
      context,
      `⚠️ ${gapCount} gap(s) remain — starting iteration ${nextIteration}/${DEFAULT_MAX_ITERATIONS}`,
      `### Remaining Gaps\n\n${remainingGaps}\n\nFresh session starting. Gap report updated.`,
      context.msgsDir,
    );

    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `validation-retry-${Date.now()}`;
    const msgsDir = context.msgsDir || path.join(workDir, '.ai', 'tx', 'msgs');
    const toAgent = `${meshName}/orchestrator`;
    const toFilePart = toAgent.replace('/', '-');

    // No fork_from — fresh session each iteration so context doesn't accumulate
    const retriggerContent = `---
to: ${toAgent}
from: ${meshName}/validation
msg-id: ${msgId}
headline: Iteration ${nextIteration} — ${gapCount} gap(s) remain
timestamp: ${new Date().toISOString()}
---

## Validation Loop — Iteration ${nextIteration} of ${DEFAULT_MAX_ITERATIONS}

**${gapCount} implementation gap(s) remain** after iteration ${iteration}.

The updated \`gap-report.md\` has been written to the workspace with the latest analysis.
Focus on the remaining gaps listed below.

### Remaining Gaps

${remainingGaps}

Close these gaps, then signal complete when done.
`;

    const filename = `${timestamp}-task-${meshName}-validation--${toFilePart}-${msgId}.md`;
    fs.writeFileSync(path.join(msgsDir, filename), retriggerContent, 'utf-8');

    log.info('hooks', 'validation-code: re-triggering mesh for next iteration', {
      meshName,
      nextIteration,
      gapCount,
      msgId,
    });

  } catch (error) {
    const msg = (error as Error).message;
    log.error('hooks', 'validation-code: failed', { error: msg, meshName, iteration });
    // Don't re-trigger on error — let the mesh complete normally and surface the error
  }
};

// ─── Export ─────────────────────────────────────────────────────────────────

export const validationCodeHook: HookDefinition = {
  name: 'validation-code',
  phase: 'post',
  priority: 90, // Run late — after other post-hooks, before final completion
  description: 'Re-validates codebase gaps after orchestrator completion. Re-triggers mesh if gaps remain (max 5 iterations). Escalates to human if exhausted.',
  handler,
};

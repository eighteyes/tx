/**
 * Quality Adversarial Post-Hook
 *
 * Challenges worker output by looking for flaws and edge cases.
 */

import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError } from '../errors.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const { AdversarialGate } = await import('../../quality/gates/adversarial.ts');
  const gate = new AdversarialGate();

  const preflight = context.qualityPreflight;
  if (!preflight) {
    log.warn('quality', 'Adversarial gate skipped - no preflight data');
    log.activity('quality:adversarial', agentId, 'SKIPPED: No preflight data');
    return;
  }

  const workerOutput = context.workerOutput;
  if (!workerOutput) {
    log.warn('quality', 'Adversarial gate skipped - no worker output');
    log.activity('quality:adversarial', agentId, 'SKIPPED: No worker output');
    return;
  }

  log.activity('quality:adversarial', agentId, 'Running adversarial critique');
  const result = await gate.evaluate(workerOutput, {}, preflight);

  log.info('quality', 'Adversarial critique', {
    passed: result.passed,
    confidence: result.confidence,
    issues: result.details?.issues || [],
    critical: result.details?.critical,
    major: result.details?.major,
    minor: result.details?.minor,
  });

  // Build detailed activity output
  const critical = (result.details?.critical as number) || 0;
  const major = (result.details?.major as number) || 0;
  const minor = (result.details?.minor as number) || 0;
  const issueCount = critical + major + minor;
  let advContent = `${result.passed ? 'PASS' : 'FAIL'}: ${issueCount} issues (critical=${critical}, major=${major}, minor=${minor})`;
  const issues = result.details?.issues as Array<{ severity: string; description: string }> | undefined;
  if (issues && issues.length > 0 && !result.passed) {
    const criticalIssues = issues.filter(i => i.severity === 'critical').slice(0, 2);
    if (criticalIssues.length > 0) {
      const issueList = criticalIssues.map(i => i.description.slice(0, 50)).join('; ');
      advContent += `\n   🚨 Critical: ${issueList}`;
    }
  }
  log.activity('quality:adversarial', agentId, advContent);

  // Write result to sys-msgs for visibility
  utils.writeResultMessage(context, 'adversarial', result.passed, advContent, {
    critical,
    major,
    minor,
    confidence: result.confidence,
  });

  if (!result.passed) {
    throw new QualityIterationError(result.feedback || 'Adversarial critique failed');
  }
};

export const qualityAdversarialHook: HookDefinition = {
  name: 'quality:adversarial',
  phase: 'post',
  priority: 52,
  description: 'Challenges worker output by looking for flaws and edge cases',
  handler,
};

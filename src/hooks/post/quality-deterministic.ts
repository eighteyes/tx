/**
 * Quality Deterministic Post-Hook
 *
 * Runs tests, lint, type checks via shell commands.
 */

import { log } from '../../shared/logger.ts';
import type { PreflightOutput } from '../../quality/types.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError } from '../errors.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const { DeterministicGate } = await import('../../quality/gates/deterministic.ts');

  // Get commands from context or use defaults
  const commands = (context.deterministicCommands as string[]) || [];

  // If no commands configured, log and pass
  if (commands.length === 0) {
    log.info('quality', 'Deterministic checks', {
      passed: true,
      reason: 'No commands configured',
    });
    log.activity('quality:deterministic', agentId, 'SKIPPED: No commands configured');
    return;
  }

  log.activity('quality:deterministic', agentId, `Running ${commands.length} check(s): ${commands.join(', ')}`);

  const gate = new DeterministicGate({
    commands,
    workDir: context.worktreePath || context.workDir,
  });

  const result = await gate.evaluate('', {}, {} as PreflightOutput);

  log.info('quality', 'Deterministic checks', {
    passed: result.passed,
    commands: result.details?.commands,
    executed: result.details?.executed,
    passedCount: result.details?.passed,
    failedCount: result.details?.failed,
  });

  // Build detailed activity output
  const cmdResults = result.details?.commands as Array<{ command: string; passed: boolean; output?: string }> | undefined;
  let detContent = `${result.passed ? 'PASS' : 'FAIL'}: ${result.details?.passed || 0}/${result.details?.executed || 0} commands`;
  if (cmdResults && !result.passed) {
    const failedCmds = cmdResults.filter(c => !c.passed).slice(0, 2);
    if (failedCmds.length > 0) {
      const failedList = failedCmds.map(c => c.command.slice(0, 30)).join(', ');
      detContent += `\n   💥 Failed: ${failedList}`;
    }
  }
  log.activity('quality:deterministic', agentId, detContent);

  // Write result to sys-msgs for visibility
  utils.writeResultMessage(context, 'deterministic', result.passed, detContent, {
    executed: result.details?.executed,
    passed: result.details?.passed,
    failed: result.details?.failed,
  });

  if (!result.passed) {
    throw new QualityIterationError(result.feedback || 'Deterministic checks failed');
  }
};

export const qualityDeterministicHook: HookDefinition = {
  name: 'quality:deterministic',
  phase: 'post',
  priority: 70, // Run actual tests last
  description: 'Runs tests, lint, type checks via shell commands',
  handler,
};

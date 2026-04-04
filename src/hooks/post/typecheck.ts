/**
 * Typecheck Post-Hook
 *
 * Runs TypeScript type checking after worker completion to catch type errors
 * introduced during implementation. Uses `npx tsc --noEmit` for zero-output
 * verification.
 *
 * Inspired by Anthropic's harness design guidance: mechanical enforcement
 * (linters, type checkers) as fast feedback loops beats documentation-based
 * constraints. Agents self-correct when given concrete error output.
 *
 * Throws QualityIterationError on failure so the quality loop can retry.
 */

import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { log } from '../../shared/logger.ts';
import { QualityIterationError } from '../errors.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const workDir = context.worktreePath || utils.workDir;

  // Only run if the project has a tsconfig.json
  const tsconfigPath = path.join(workDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    log.debug('hooks', 'typecheck: no tsconfig.json found, skipping', { workDir });
    return;
  }

  log.info('hooks', 'typecheck: running tsc --noEmit', {
    meshInstance: context.meshInstance,
    agentName: context.agentName,
    workDir,
  });

  try {
    execSync('npx tsc --noEmit 2>&1', {
      cwd: workDir,
      timeout: 120_000, // 2 minute timeout
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    log.info('hooks', 'typecheck: passed', {
      meshInstance: context.meshInstance,
    });

    utils.writeResultMessage(context, 'typecheck', true, 'TypeScript type check passed');
  } catch (error) {
    const output = (error as { stdout?: string; stderr?: string }).stdout
      || (error as { stderr?: string }).stderr
      || (error as Error).message;

    // Truncate to avoid flooding context
    const maxLen = 3000;
    const truncated = output.length > maxLen
      ? output.slice(0, maxLen) + `\n\n... (${output.length - maxLen} chars truncated)`
      : output;

    log.warn('hooks', 'typecheck: failed', {
      meshInstance: context.meshInstance,
      errorLength: output.length,
    });

    utils.writeResultMessage(context, 'typecheck', false, 'TypeScript type check failed');

    throw new QualityIterationError(
      `TypeScript type check failed.\n\nFix the following type errors:\n\n${truncated}`
    );
  }
};

export const typecheckHook: HookDefinition = {
  name: 'typecheck',
  phase: 'post',
  priority: 60, // After semantic quality gates (50), before ai-linter (65)
  description: 'Runs tsc --noEmit to catch type errors. Mechanical enforcement via fast feedback loop.',
  handler,
};

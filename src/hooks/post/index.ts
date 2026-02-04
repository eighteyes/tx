/**
 * Post-Hooks Index
 *
 * Exports all post-hooks and registration function.
 */

import type { HookRegistry } from '../registry.ts';
import { worktreeCleanupHook } from './worktree-cleanup.ts';
import { qualityEvaluateHook } from './quality-evaluate.ts';
import { qualityChecklistHook } from './quality-checklist.ts';
import { qualityRubricHook } from './quality-rubric.ts';
import { qualityAdversarialHook } from './quality-adversarial.ts';
import { qualityAccuracyHook } from './quality-accuracy.ts';
import { qualitySummarizerHook } from './quality-summarizer.ts';
import { qualityDeterministicHook } from './quality-deterministic.ts';
import { commitAutoHook } from './commit-auto.ts';
import { brainUpdateHook } from './brain-update.ts';
import { forensicsAnalyzeHook } from './forensics-analyze.ts';
import { suggestManifestHook } from './suggest-manifest.ts';

export { worktreeCleanupHook } from './worktree-cleanup.ts';
export { qualityEvaluateHook } from './quality-evaluate.ts';
export { qualityChecklistHook } from './quality-checklist.ts';
export { qualityRubricHook } from './quality-rubric.ts';
export { qualityAdversarialHook } from './quality-adversarial.ts';
export { qualityAccuracyHook } from './quality-accuracy.ts';
export { qualitySummarizerHook } from './quality-summarizer.ts';
export { qualityDeterministicHook } from './quality-deterministic.ts';
export { commitAutoHook } from './commit-auto.ts';
export { brainUpdateHook } from './brain-update.ts';
export { forensicsAnalyzeHook } from './forensics-analyze.ts';
export { suggestManifestHook } from './suggest-manifest.ts';

/**
 * All post-hook definitions
 */
export const postHooks = [
  qualityEvaluateHook,
  qualityChecklistHook,
  qualityRubricHook,
  qualityAdversarialHook,
  qualityAccuracyHook,
  qualitySummarizerHook,
  qualityDeterministicHook,
  worktreeCleanupHook,
  commitAutoHook,
  forensicsAnalyzeHook,
  suggestManifestHook,
  brainUpdateHook,
];

/**
 * Register all post-hooks with a registry
 */
export function registerPostHooks(registry: HookRegistry): void {
  for (const hook of postHooks) {
    registry.register(hook);
  }
}

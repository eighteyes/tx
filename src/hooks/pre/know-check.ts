/**
 * Know CLI Check Pre-Hook
 *
 * Validates that the know CLI and /know:* commands are available
 * before starting meshes that depend on them (brain, dev-know-build).
 * Sends a warning message to core if missing — does NOT block the mesh.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const KNOW_DEPENDENT_MESHES = ['brain', 'dev-know-build'];

const handler = async (context: HookContext, _utils: HookUtils): Promise<void> => {
  const meshName = context.meshName;

  // Only check for know-dependent meshes
  if (!KNOW_DEPENDENT_MESHES.includes(meshName)) {
    return;
  }

  const agentId = context.agentId || `${meshName}/${context.agentName}`;
  const warnings: string[] = [];

  // Check 1: know CLI in PATH
  const knowInPath = process.env.PATH?.split(':').some(p => {
    try { return fs.existsSync(path.join(p, 'know')); } catch { return false; }
  });
  if (!knowInPath) {
    warnings.push('`know` CLI not in PATH (install: `npm install -g know-cli`)');
  }

  // Check 2: .claude/commands/know/ exists
  const knowCommandsDir = path.join(context.workDir, '.claude', 'commands', 'know');
  if (!fs.existsSync(knowCommandsDir)) {
    warnings.push('`/know:*` commands not found (`.claude/commands/know/`)');
  }

  if (warnings.length === 0) {
    log.debug('hooks', `know-check passed for ${meshName}`, { agentId });
    return;
  }

  log.warn('hooks', `know-check failed for ${meshName}`, { agentId, warnings });

  // Send warning to core — don't block the mesh
  if (context.systemWriter) {
    context.systemWriter.write({
      to: 'core/core',
      from: agentId,
      headline: `Missing know-cli dependency for ${meshName}`,
      body: `The \`${meshName}\` mesh requires the know CLI for proper functioning.\n\n**Issues found:**\n${warnings.map(w => `- ${w}`).join('\n')}\n\n**To fix:**\n1. Install CLI: \`npm install -g know-cli\`\n2. Init project: \`know init\`\n\nThe mesh will start but may not work correctly without these dependencies.`,
    });
  }
};

export const knowCheckHook: HookDefinition = {
  name: 'know:check',
  phase: 'pre',
  priority: 10, // Run early, before worktree setup
  description: 'Validates know CLI availability for meshes that depend on it',
  handler,
};

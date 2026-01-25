/**
 * Forensics Analyze Post-Hook
 *
 * Analyzes mesh execution for patterns and issues.
 * Runs when debug mode is enabled (debug: true in mesh config OR --debug CLI flag).
 */

import { log } from '../../shared/logger.ts';
import {
  analyzeTranscript,
  writeForensicsReport,
  loadSessionTranscript,
} from '../../forensics/index.ts';
import type { ForensicsContext } from '../../forensics/types.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const COMPONENT = 'hooks:forensics';

/**
 * Handler for forensics analysis post-hook
 */
const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const {
    meshInstance,
    meshName,
    agentName,
    agentId,
    sessionId,
    workerOutput,
    workDir: contextWorkDir,
  } = context;

  const workDir = contextWorkDir || utils.workDir;

  log.info(COMPONENT, 'Starting forensics analysis', {
    meshInstance,
    meshName,
    agentId: agentId || `${meshName}/${agentName}`,
    sessionId: sessionId?.slice(0, 8),
  });

  try {
    // Build full agent ID if not provided
    const fullAgentId = agentId || `${meshName}/${agentName}`;

    // Load transcript from session file
    const transcript = await loadSessionTranscript(workDir, sessionId, fullAgentId);

    if (!transcript) {
      log.warn(COMPONENT, 'No transcript found for analysis', {
        agentId: fullAgentId,
        sessionId,
      });
      return;
    }

    // Build analysis context
    const forensicsContext: ForensicsContext = {
      agentId: fullAgentId,
      meshInstance,
      meshName,
      workerOutput,
      sessionId,
      workDir,
    };

    // Run analysis
    const report = await analyzeTranscript(transcript, forensicsContext);

    // Write report to forensics directory
    const { jsonPath, mdPath } = await writeForensicsReport(report, workDir, meshName);

    log.info(COMPONENT, 'Forensics analysis complete', {
      meshInstance,
      agentId: fullAgentId,
      issues: report.issues.length,
      patterns: report.patterns.length,
      jsonPath,
      mdPath,
    });

    // Log summary for visibility
    if (report.issues.length > 0) {
      const errorCount = report.issues.filter(i => i.severity === 'error').length;
      const warnCount = report.issues.filter(i => i.severity === 'warning').length;

      if (errorCount > 0) {
        log.warn(COMPONENT, 'Forensics found issues', {
          errors: errorCount,
          warnings: warnCount,
          summary: report.summary,
        });
      }
    }
  } catch (error) {
    // Log error but don't fail the hook - forensics is diagnostic only
    log.error(COMPONENT, 'Forensics analysis failed', {
      meshInstance,
      error: (error as Error).message,
    });
  }
};

/**
 * Forensics analysis post-hook definition
 *
 * Priority: 95 (after commit-auto at 90, before brain-update at 100)
 */
export const forensicsAnalyzeHook: HookDefinition = {
  name: 'forensics:analyze',
  phase: 'post',
  priority: 95,
  description: 'Analyze mesh execution for patterns and issues (debug mode only)',
  handler,
};

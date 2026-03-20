/**
 * Rearmatter Extractor
 *
 * Handles extraction of rearmatter from messages, saving to files,
 * and replacing message body sections with reference pointers.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { log } from '../shared/logger.ts';
import {
  type Rearmatter,
  validateRearmatter,
  extractConfidence,
  checkRearmatterCompleteness,
} from '../shared/rearmatter-schema.ts';

export interface ExtractionResult {
  /** Message body with rearmatter replaced by reference pointer (or unchanged if no rearmatter) */
  body: string;
  /** Parsed rearmatter object (null if missing or malformed) */
  rearmatter: Record<string, unknown> | null;
  /** Raw rearmatter text (preserved even if YAML parse fails) */
  rawRearmatter: string | null;
  /** Confidence score extracted from rearmatter.grade.confidence */
  confidence: number | undefined;
  /** Path where rearmatter was saved (null if not saved) */
  savedPath: string | null;
}

/**
 * Extract rearmatter from message, save to file, replace with reference pointer
 */
export function extractAndSaveRearmatter(
  messageBody: string,
  rearmatter: Record<string, unknown> | null,
  rawRearmatter: string | null,
  meshName: string,
  agentName: string,
  msgId: string,
  destination: string,
  assayDir: string
): ExtractionResult {
  // No rearmatter section - return unchanged
  if (!rawRearmatter) {
    return {
      body: messageBody,
      rearmatter: null,
      rawRearmatter: null,
      confidence: undefined,
      savedPath: null,
    };
  }

  // Extract confidence score
  const confidence = extractConfidence(rearmatter);

  // Validate and log completeness (lenient - don't reject)
  if (rearmatter) {
    const completeness = checkRearmatterCompleteness(rearmatter);
    if (!completeness.complete) {
      log.info('consumer', 'Rearmatter missing fields (non-blocking)', {
        mesh: meshName,
        agent: agentName,
        msgId,
        missing: completeness.missing,
        present: completeness.present,
      });
    }

    const validationErrors = validateRearmatter(rearmatter);
    if (validationErrors.length > 0) {
      log.warn('consumer', 'Rearmatter validation warnings', {
        mesh: meshName,
        agent: agentName,
        msgId,
        errors: validationErrors,
      });
    }
  }

  // Determine save path
  const agentDir = path.join(assayDir, meshName, agentName);
  const filename = `${msgId}-rearmatter.yaml`;
  const savePath = path.join(agentDir, filename);

  // Create directory structure
  try {
    fs.mkdirSync(agentDir, { recursive: true });
  } catch (err) {
    log.error('consumer', 'Failed to create rearmatter directory', {
      path: agentDir,
      error: (err as Error).message,
    });
    // Fail-open: continue without saving
    return {
      body: messageBody,
      rearmatter,
      rawRearmatter,
      confidence,
      savedPath: null,
    };
  }

  // Save rearmatter to file (use parsed YAML if available, raw text otherwise)
  try {
    const contentToSave = rearmatter ? YAML.stringify(rearmatter) : rawRearmatter;
    fs.writeFileSync(savePath, contentToSave, 'utf-8');
    log.info('consumer', 'Saved rearmatter to file', {
      path: savePath,
      confidence,
      hasValidYAML: rearmatter !== null,
    });
  } catch (err) {
    log.error('consumer', 'Failed to save rearmatter file', {
      path: savePath,
      error: (err as Error).message,
    });
    // Fail-open: continue without saving
    return {
      body: messageBody,
      rearmatter,
      rawRearmatter,
      confidence,
      savedPath: null,
    };
  }

  // Replace rearmatter section with reference pointer or inline
  const rearmatterPath = path.relative(process.cwd(), savePath);
  let modifiedBody: string;

  if (destination === 'core/core') {
    // User-facing: include rearmatter inline (keep full content)
    // Don't replace - the original parseMessage flow keeps body + rearmatter separate
    // We'll handle inline assembly later in the delivery formatting
    modifiedBody = messageBody;
  } else {
    // Internal agent-to-agent: replace with reference pointer
    modifiedBody = `${messageBody}\n\n[rearmatter: ${rearmatterPath}]`;
  }

  return {
    body: modifiedBody,
    rearmatter,
    rawRearmatter,
    confidence,
    savedPath: savePath,
  };
}

/**
 * Freeze intent on first message to mesh entry point
 * Returns true if intent was frozen, false if already exists or on error
 */
export function freezeIntent(
  messageBody: string,
  meshName: string,
  toAgentName: string,
  entryPointName: string | undefined,
  assayDir: string
): boolean {
  // Only freeze on messages to entry point
  if (toAgentName !== entryPointName) {
    return false;
  }

  const intentPath = path.join(assayDir, meshName, 'intent.md');

  // Check if already frozen (file exists)
  if (fs.existsSync(intentPath)) {
    log.debug('consumer', 'Intent already frozen, skipping', {
      mesh: meshName,
      path: intentPath,
    });
    return false;
  }

  // Create mesh directory
  const meshDir = path.join(assayDir, meshName);
  try {
    fs.mkdirSync(meshDir, { recursive: true });
  } catch (err) {
    log.error('consumer', 'Failed to create mesh assay directory', {
      path: meshDir,
      error: (err as Error).message,
    });
    return false;
  }

  // Write intent file
  try {
    fs.writeFileSync(intentPath, messageBody, 'utf-8');
    log.info('consumer', 'Froze intent for mesh', {
      mesh: meshName,
      path: intentPath,
      bodyLength: messageBody.length,
    });
    return true;
  } catch (err) {
    log.error('consumer', 'Failed to freeze intent', {
      path: intentPath,
      error: (err as Error).message,
    });
    return false;
  }
}

/**
 * Read frozen intent for a mesh
 * Returns intent text or null if not found
 */
export function readFrozenIntent(meshName: string, assayDir: string): string | null {
  const intentPath = path.join(assayDir, meshName, 'intent.md');

  if (!fs.existsSync(intentPath)) {
    return null;
  }

  try {
    return fs.readFileSync(intentPath, 'utf-8');
  } catch (err) {
    log.error('consumer', 'Failed to read frozen intent', {
      path: intentPath,
      error: (err as Error).message,
    });
    return null;
  }
}

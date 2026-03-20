/**
 * Summarizer Runner
 *
 * Orchestrates summarizer execution as system workers for work assay creation.
 * Summarizers are independent audit agents that cross-check agent self-reports
 * (rearmatter) against observable evidence (session trace) and original intent.
 *
 * Key behaviors:
 * - Runs synchronously with timeout (default 60s)
 * - Spawns in fresh context via SDK runner (no session history)
 * - Fail-open: any error permits message delivery
 * - Does not count against mesh guardrails (system worker)
 *
 * See: docs/superpowers/specs/2026-03-16-work-assay-creation-design.md
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { SdkRunner, type SdkRunnerConfig } from '../worker/sdk-runner.ts';
import type { MessageQueue } from '../queue/index.ts';
import type { SummarizerConfig, SemanticModel } from '../shared/types.ts';
import { log } from '../shared/logger.ts';
import { type Assay, validateAssay, createAssayTemplate } from '../shared/assay-schema.ts';

export interface SummarizerInputs {
  intent: string | null;
  rearmatter: Record<string, unknown> | null;
  trace: string | null;
  previousAssay: string | null;  // For retry scenarios
}

export interface SummarizerResult {
  success: boolean;
  assay: Assay | null;
  assayPath: string | null;
  error?: string;
  timedOut?: boolean;
}

/**
 * Deep merge summarizerOptions into base summarizer config
 * Agent-level options override base config field-by-field
 */
export function mergeSummarizerConfig(
  base: SummarizerConfig,
  options: Partial<SummarizerConfig> | undefined
): SummarizerConfig {
  if (!options) return base;

  // Shallow clone base
  const merged = { ...base };

  // Merge top-level fields
  if (options.model !== undefined) merged.model = options.model;
  if (options.destination !== undefined) merged.destination = options.destination;
  if (options.timeout !== undefined) merged.timeout = options.timeout;

  // Deep merge inputs object
  if (options.inputs) {
    merged.inputs = {
      ...base.inputs,
      ...options.inputs,
    };
  }

  return merged;
}

/**
 * Assemble inputs for summarizer based on config
 */
export async function assembleSummarizerInputs(
  config: SummarizerConfig,
  meshName: string,
  agentName: string,
  msgId: string,
  assayDir: string,
  sessionDir: string,
  sessionId: string | undefined
): Promise<SummarizerInputs> {
  const inputs: SummarizerInputs = {
    intent: null,
    rearmatter: null,
    trace: null,
    previousAssay: null,
  };

  // Default all inputs to true if not specified
  const includeIntent = config.inputs?.intent !== false;
  const includeRearmatter = config.inputs?.rearmatter !== false;
  const includeTrace = config.inputs?.trace !== false;

  // Load intent (frozen original message)
  if (includeIntent) {
    const intentPath = path.join(assayDir, meshName, 'intent.md');
    if (fs.existsSync(intentPath)) {
      try {
        inputs.intent = fs.readFileSync(intentPath, 'utf-8');
      } catch (err) {
        log.warn('summarizer-runner', 'Failed to read intent file', {
          path: intentPath,
          error: (err as Error).message,
        });
      }
    }
  }

  // Load rearmatter (just-extracted)
  if (includeRearmatter) {
    const rearmatterPath = path.join(assayDir, meshName, agentName, `${msgId}-rearmatter.yaml`);
    if (fs.existsSync(rearmatterPath)) {
      try {
        const content = fs.readFileSync(rearmatterPath, 'utf-8');
        inputs.rearmatter = YAML.parse(content) as Record<string, unknown>;
      } catch (err) {
        log.warn('summarizer-runner', 'Failed to read rearmatter file', {
          path: rearmatterPath,
          error: (err as Error).message,
        });
      }
    }
  }

  // Load trace (session transcript)
  if (includeTrace && sessionId) {
    // Try to read session transcript file
    // Session files are in .ai/tx/sessions/[session-id].json (or similar format)
    const sessionPath = path.join(sessionDir, `${sessionId}.json`);
    if (fs.existsSync(sessionPath)) {
      try {
        inputs.trace = fs.readFileSync(sessionPath, 'utf-8');
      } catch (err) {
        log.warn('summarizer-runner', 'Failed to read session transcript', {
          path: sessionPath,
          error: (err as Error).message,
        });
      }
    }
  }

  // Check for previous assay (retry scenario)
  const assayPath = path.join(assayDir, meshName, agentName, `${msgId}-assay.yaml`);
  if (fs.existsSync(assayPath)) {
    try {
      inputs.previousAssay = fs.readFileSync(assayPath, 'utf-8');
      log.info('summarizer-runner', 'Found previous assay for retry', {
        path: assayPath,
      });
    } catch (err) {
      log.warn('summarizer-runner', 'Failed to read previous assay', {
        path: assayPath,
        error: (err as Error).message,
      });
    }
  }

  return inputs;
}

/**
 * Build summarizer system prompt with inputs
 */
function buildSummarizerPrompt(
  promptTemplate: string,
  inputs: SummarizerInputs,
  meshName: string,
  agentName: string
): string {
  let prompt = promptTemplate;

  // Inject inputs as sections
  const sections: string[] = [];

  if (inputs.intent) {
    sections.push(`## Original Intent\n\n${inputs.intent}`);
  }

  if (inputs.rearmatter) {
    sections.push(`## Agent Self-Report (Rearmatter)\n\n\`\`\`yaml\n${YAML.stringify(inputs.rearmatter)}\`\`\``);
  }

  if (inputs.trace) {
    sections.push(`## Execution Trace (Session Transcript)\n\n\`\`\`\n${inputs.trace}\`\`\``);
  }

  if (inputs.previousAssay) {
    sections.push(`## Previous Assay (Retry Context)\n\n\`\`\`yaml\n${inputs.previousAssay}\`\`\``);
  }

  // Append inputs to prompt
  prompt += `\n\n# Work Assay Inputs\n\n${sections.join('\n\n')}`;

  // Add context about mesh and agent
  prompt += `\n\n# Context\n\n- **Mesh:** ${meshName}\n- **Agent:** ${agentName}\n`;

  return prompt;
}

/**
 * Execute summarizer and save assay
 */
export async function runSummarizer(
  config: SummarizerConfig,
  meshName: string,
  agentName: string,
  msgId: string,
  meshModel: SemanticModel,
  assayDir: string,
  sessionDir: string,
  workDir: string,
  msgsDir: string,
  queue: MessageQueue,
  sessionId?: string,
  promptBasePath?: string
): Promise<SummarizerResult> {
  const timeout = (config.timeout || 60) * 1000;  // Convert to milliseconds

  // Load summarizer prompt
  const promptPath = promptBasePath
    ? path.resolve(promptBasePath, config.prompt)
    : path.resolve(workDir, config.prompt);

  if (!fs.existsSync(promptPath)) {
    log.error('summarizer-runner', 'Summarizer prompt file not found', {
      promptPath,
      mesh: meshName,
      agent: agentName,
    });
    return {
      success: false,
      assay: null,
      assayPath: null,
      error: `Prompt file not found: ${promptPath}`,
    };
  }

  let promptTemplate: string;
  try {
    promptTemplate = fs.readFileSync(promptPath, 'utf-8');
  } catch (err) {
    log.error('summarizer-runner', 'Failed to read summarizer prompt', {
      promptPath,
      error: (err as Error).message,
    });
    return {
      success: false,
      assay: null,
      assayPath: null,
      error: (err as Error).message,
    };
  }

  // Assemble inputs
  const inputs = await assembleSummarizerInputs(
    config,
    meshName,
    agentName,
    msgId,
    assayDir,
    sessionDir,
    sessionId
  );

  // Build prompt with inputs
  const systemPrompt = buildSummarizerPrompt(promptTemplate, inputs, meshName, agentName);

  // Spawn summarizer as SDK worker
  const model = config.model || meshModel;
  const summarizerId = `${meshName}/summarizer-${Date.now()}`;

  const runnerConfig: SdkRunnerConfig = {
    id: summarizerId,
    model,
    systemPrompt,
    workDir,
    msgsDir,
    maxTurns: 10,  // Summarizers should be concise
    thinking: false,  // Summarizers don't need extended thinking
    toolRestriction: 'orchestrator',  // Read + Write only (no Bash, etc.)
  };

  const runner = new SdkRunner(runnerConfig, queue);

  // Set up timeout
  const timeoutPromise = new Promise<SummarizerResult>((resolve) => {
    setTimeout(() => {
      log.warn('summarizer-runner', 'Summarizer timeout', {
        mesh: meshName,
        agent: agentName,
        msgId,
        timeout,
      });
      resolve({
        success: false,
        assay: null,
        assayPath: null,
        timedOut: true,
      });
    }, timeout);
  });

  // Run summarizer
  const runPromise = new Promise<SummarizerResult>(async (resolve) => {
    try {
      // Simple task: "Produce the assay"
      const task = 'Analyze the provided inputs and produce a complete work assay in YAML format.';

      await runner.run(task);

      // Wait for completion
      runner.on('complete', (result) => {
        if (!result.success) {
          log.error('summarizer-runner', 'Summarizer execution failed', {
            mesh: meshName,
            agent: agentName,
            error: result.error,
          });
          resolve({
            success: false,
            assay: null,
            assayPath: null,
            error: result.error,
          });
          return;
        }

        // Parse output as YAML
        const output = result.output || '';

        // Extract YAML from output (look for ```yaml blocks or raw YAML)
        let yamlContent = output;
        const yamlBlockMatch = output.match(/```ya?ml\n([\s\S]+?)\n```/);
        if (yamlBlockMatch) {
          yamlContent = yamlBlockMatch[1];
        }

        let assay: Assay;
        try {
          assay = YAML.parse(yamlContent) as Assay;
        } catch (err) {
          log.error('summarizer-runner', 'Failed to parse assay YAML', {
            mesh: meshName,
            agent: agentName,
            error: (err as Error).message,
            outputPreview: output.substring(0, 500),
          });
          // Save raw output for inspection
          const rawPath = path.join(assayDir, meshName, agentName, `${msgId}-assay-raw.txt`);
          try {
            fs.mkdirSync(path.dirname(rawPath), { recursive: true });
            fs.writeFileSync(rawPath, output, 'utf-8');
            log.info('summarizer-runner', 'Saved raw summarizer output', { path: rawPath });
          } catch { /* ignore */ }

          resolve({
            success: false,
            assay: null,
            assayPath: null,
            error: `YAML parse error: ${(err as Error).message}`,
          });
          return;
        }

        // Validate assay structure
        const validationErrors = validateAssay(assay);
        if (validationErrors.length > 0) {
          log.warn('summarizer-runner', 'Assay validation warnings', {
            mesh: meshName,
            agent: agentName,
            errors: validationErrors,
          });
          // Fail-open: save anyway with warning
        }

        // Populate system fields if missing
        if (!assay.version) assay.version = '0.1.0';
        if (!assay.assay_id) assay.assay_id = `${meshName}-${agentName}-${msgId}`;
        if (!assay.created_at) assay.created_at = new Date().toISOString();
        if (!assay.provenance) {
          assay.provenance = {
            mesh_id: meshName,
            session_id: sessionId || 'unknown',
            platform: 'claude-sdk',
            model,
          };
        }
        if (!assay.iteration) {
          const attempt = inputs.previousAssay ? 2 : 1;  // Simple heuristic
          assay.iteration = { attempt };
        }

        // Save assay to file
        const assayPath = path.join(assayDir, meshName, agentName, `${msgId}-assay.yaml`);
        try {
          fs.mkdirSync(path.dirname(assayPath), { recursive: true });
          fs.writeFileSync(assayPath, YAML.stringify(assay), 'utf-8');
          log.info('summarizer-runner', 'Saved assay to file', {
            path: assayPath,
            verdict: assay.verdict,
          });
        } catch (err) {
          log.error('summarizer-runner', 'Failed to save assay file', {
            path: assayPath,
            error: (err as Error).message,
          });
          resolve({
            success: false,
            assay: null,
            assayPath: null,
            error: `File write error: ${(err as Error).message}`,
          });
          return;
        }

        resolve({
          success: true,
          assay,
          assayPath,
        });
      });

      runner.on('error', (error) => {
        log.error('summarizer-runner', 'Summarizer runtime error', {
          mesh: meshName,
          agent: agentName,
          error,
        });
        resolve({
          success: false,
          assay: null,
          assayPath: null,
          error: String(error),
        });
      });
    } catch (err) {
      log.error('summarizer-runner', 'Summarizer spawn error', {
        mesh: meshName,
        agent: agentName,
        error: (err as Error).message,
      });
      resolve({
        success: false,
        assay: null,
        assayPath: null,
        error: (err as Error).message,
      });
    }
  });

  // Race between timeout and completion
  return Promise.race([runPromise, timeoutPromise]);
}

/**
 * Preflight Gate
 *
 * LLM-based task analysis that generates quality criteria before execution.
 * Uses haiku model for fast, cheap preflight analysis.
 */

import { query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { resolve } from 'node:path';
import { BaseEvaluator } from '../registry.ts';
import type { GateType, EvalResult, PreflightOutput, RearmatterData, RubricItem, EffortLevel } from '../types.ts';
import { log } from '../../shared/logger.ts';

/**
 * Model mapping for SDK query
 */
const MODEL_MAP: Record<string, string> = {
  'claude-3-5-haiku-20241022': 'haiku',
  'haiku': 'haiku',
  'sonnet': 'sonnet',
  'opus': 'opus',
};

/**
 * Default timeout for preflight LLM call (30 seconds)
 */
const PREFLIGHT_TIMEOUT_MS = 30000;

/**
 * Default model for preflight analysis
 */
const PREFLIGHT_MODEL = 'claude-3-5-haiku-20241022';

/**
 * LLM response structure for preflight analysis
 */
interface LLMPreflightResponse {
  taskType: string;
  checklist: string[];
  rubric: Array<{ criterion: string; weight: number; description: string }>;
  suggestedGates: string[];
  effortLevel: string;
  estimatedToolCalls: number;
  reasoning: string;
}

/**
 * Configuration for PreflightGate
 */
export interface PreflightGateConfig {
  timeoutMs?: number;
  model?: string;
}

/**
 * PreflightGate evaluator
 *
 * Analyzes task content using LLM to generate:
 * - Task-specific checklist items
 * - Grading rubric with weights
 * - Suggested quality gates
 * - Effort estimation
 */
export class PreflightGate extends BaseEvaluator {
  readonly gate: GateType = 'checklist'; // Uses checklist as gate type for registry

  private config: PreflightGateConfig;

  constructor(config: PreflightGateConfig = {}) {
    super();
    this.config = {
      timeoutMs: config.timeoutMs ?? PREFLIGHT_TIMEOUT_MS,
      model: config.model ?? PREFLIGHT_MODEL,
    };
  }

  /**
   * Run preflight analysis on task body
   * Returns preflight output with task-specific quality criteria
   */
  async analyze(taskBody: string): Promise<PreflightOutput> {
    const startTime = Date.now();

    log.info('preflight-gate', 'Running LLM preflight analysis', {
      taskLength: taskBody.length,
      model: this.config.model,
    });

    try {
      const response = await this.callLLM(taskBody);
      const parsed = this.parseLLMResponse(response);

      log.info('preflight-gate', 'LLM preflight complete', {
        taskType: parsed.taskType,
        checklistItems: parsed.checklist.length,
        rubricItems: parsed.rubric.length,
        duration: Date.now() - startTime,
      });

      return parsed;
    } catch (error) {
      log.error('preflight-gate', 'LLM preflight failed', {
        error: (error as Error).message,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Standard evaluate method for Evaluator interface
   * Note: For preflight, use analyze() directly instead
   */
  async evaluate(
    solution: string,
    _rearmatter: RearmatterData,
    _criteria: PreflightOutput,
    _priorEvals?: EvalResult[]
  ): Promise<EvalResult> {
    // Preflight gate is special - it generates criteria, doesn't evaluate solutions
    // When called via evaluate(), treat solution as task body and return analysis result
    try {
      const preflight = await this.analyze(solution);
      return this.pass({
        preflight,
        message: 'Preflight analysis complete',
      });
    } catch (error) {
      return this.fail(`Preflight analysis failed: ${(error as Error).message}`);
    }
  }

  /**
   * Call LLM with task body and get preflight analysis
   * Uses Claude Agent SDK query() function for consistency with rest of codebase
   */
  private async callLLM(taskBody: string): Promise<string> {
    const prompt = this.buildPrompt(taskBody);

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      // Map model name to SDK format
      const sdkModel = MODEL_MAP[this.config.model!] || 'haiku';

      // Use SDK query() for consistency with rest of codebase
      const q = query({
        prompt,
        options: {
          cwd: resolve('.'),  // Current working directory
          model: sdkModel,
          systemPrompt: 'You are a helpful assistant that analyzes development tasks and generates quality criteria. Always respond with valid JSON only, no markdown formatting.',
          permissionMode: 'dontAsk',
          allowedTools: [],  // No tools needed for preflight - just text analysis
          abortController: controller,
          maxTurns: 1,  // Single turn for preflight analysis
          tools: [],  // No tools needed for preflight - just text analysis
        }
      });

      // Collect text responses from the query
      const textParts: string[] = [];

      for await (const msg of q) {
        switch (msg.type) {
          case 'assistant':
            // Extract text content from assistant messages
            for (const block of msg.message.content) {
              if (block.type === 'text' && 'text' in block) {
                textParts.push((block as { type: 'text'; text: string }).text);
              }
            }
            break;

          case 'result':
            // Check for errors in the result
            const resultMsg = msg as SDKResultMessage;
            if (msg.is_error) {
              throw new Error(`SDK query error: ${resultMsg.subtype}`);
            }
            break;
        }
      }

      const responseText = textParts.join('');
      if (!responseText) {
        throw new Error('No text content in LLM response');
      }

      return responseText;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build the preflight analysis prompt
   */
  private buildPrompt(taskBody: string): string {
    return `Analyze this development task and generate quality criteria for evaluating the solution.

TASK:
${taskBody}

Provide a JSON response with EXACTLY this structure (no markdown, just raw JSON):
{
  "taskType": "implementation | bug-fix | refactoring | testing | research | code-review",
  "checklist": [
    "Specific, verifiable checklist item 1",
    "Specific, verifiable checklist item 2",
    "..."
  ],
  "rubric": [
    {
      "criterion": "criterion name",
      "weight": 0.3,
      "description": "What this criterion evaluates"
    }
  ],
  "suggestedGates": ["checklist", "rubric", "adversarial", "accuracy", "deterministic"],
  "effortLevel": "low | medium | high | very-high",
  "estimatedToolCalls": 10,
  "reasoning": "Brief explanation of your analysis"
}

Guidelines for quality criteria:
1. Checklist items should be SPECIFIC to this task (not generic like "code compiles")
2. Include 5-10 checklist items covering edge cases, requirements, and quality
3. Rubric weights should sum to 1.0
4. Only suggest gates that are relevant:
   - "adversarial" for security-sensitive tasks
   - "deterministic" for code that can be tested/compiled
   - "accuracy" for research tasks requiring sources
5. Effort estimation:
   - low: Simple changes, <20 tool calls expected
   - medium: Moderate complexity, 20-50 tool calls
   - high: Complex changes, 50-100 tool calls
   - very-high: Major implementation, >100 tool calls

Respond with ONLY the JSON object, no other text.`;
  }

  /**
   * Parse and validate LLM response into PreflightOutput
   */
  private parseLLMResponse(response: string): PreflightOutput {
    // Clean response (remove markdown code blocks if present)
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: LLMPreflightResponse;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      log.error('preflight-gate', 'Failed to parse LLM response as JSON', {
        response: response.substring(0, 200),
        error: (error as Error).message,
      });
      throw new Error(`Invalid JSON from LLM: ${(error as Error).message}`);
    }

    // Validate and transform response
    return this.transformResponse(parsed);
  }

  /**
   * Transform and validate LLM response into PreflightOutput
   */
  private transformResponse(response: LLMPreflightResponse): PreflightOutput {
    // Validate task type
    const validTaskTypes = ['implementation', 'bug-fix', 'refactoring', 'testing', 'research', 'code-review'];
    const taskType = validTaskTypes.includes(response.taskType)
      ? response.taskType
      : 'implementation';

    // Validate checklist (ensure array of strings)
    const checklist = Array.isArray(response.checklist)
      ? response.checklist.filter(item => typeof item === 'string')
      : [];

    // Validate rubric (ensure proper structure)
    const rubric: RubricItem[] = Array.isArray(response.rubric)
      ? response.rubric
          .filter(item =>
            typeof item === 'object' &&
            typeof item.criterion === 'string' &&
            typeof item.weight === 'number' &&
            typeof item.description === 'string'
          )
          .map(item => ({
            criterion: item.criterion,
            weight: Math.max(0, Math.min(1, item.weight)),
            description: item.description,
          }))
      : [];

    // Validate suggested gates
    const validGates: GateType[] = ['checklist', 'rubric', 'adversarial', 'accuracy', 'deterministic', 'summarizer'];
    const suggestedGates = Array.isArray(response.suggestedGates)
      ? response.suggestedGates.filter(gate => validGates.includes(gate as GateType)) as GateType[]
      : [];

    // Validate effort level
    const validEffortLevels: EffortLevel[] = ['light', 'medium', 'heavy'];
    const effortMap: Record<string, EffortLevel> = {
      'low': 'light',
      'medium': 'medium',
      'high': 'heavy',
      'very-high': 'heavy',
      'light': 'light',
      'heavy': 'heavy',
    };
    const effortLevel = effortMap[response.effortLevel] || 'medium';

    // Validate estimated tool calls
    const estimatedToolCalls = typeof response.estimatedToolCalls === 'number'
      ? Math.max(1, Math.round(response.estimatedToolCalls))
      : 10;

    // Build output (requiredGates will be set by caller based on lifecycle config)
    return {
      taskType,
      checklist,
      rubric,
      requiredGates: [], // Set by dispatcher based on lifecycle config
      suggestedGates,
      effortLevel,
      estimatedToolCalls,
    };
  }
}

/**
 * Create a preflight gate instance
 */
export function createPreflightGate(config?: PreflightGateConfig): PreflightGate {
  return new PreflightGate(config);
}

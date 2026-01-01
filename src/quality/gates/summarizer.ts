/**
 * Summarizer Gate
 *
 * Handles ensemble results - finds consensus from multiple worker solutions.
 * Weights by rearmatter confidence to select best solution.
 */

import { BaseEvaluator } from '../registry.ts';
import type { GateType, EvalResult, PreflightOutput, RearmatterData } from '../types.ts';
import { log } from '../../shared/logger.ts';

/**
 * A solution from an ensemble worker
 */
export interface EnsembleSolution {
  workerId: string;
  solution: string;
  rearmatter: RearmatterData;
}

/**
 * Summarizer gate configuration
 */
export interface SummarizerGateConfig {
  solutions: EnsembleSolution[];
  consensusThreshold?: number;  // Minimum similarity for consensus (0-1)
}

/**
 * SummarizerGate evaluator
 *
 * Summarizes ensemble results by finding consensus or selecting highest confidence.
 * Only runs when multiple workers contribute solutions.
 */
export class SummarizerGate extends BaseEvaluator {
  readonly gate: GateType = 'summarizer';

  private config: SummarizerGateConfig;

  constructor(config: SummarizerGateConfig) {
    super();
    this.config = {
      consensusThreshold: 0.7,
      ...config,
    };
  }

  async evaluate(
    solution: string,
    rearmatter: RearmatterData,
    _criteria: PreflightOutput,
    _priorEvals?: EvalResult[]
  ): Promise<EvalResult> {
    const startTime = Date.now();
    const { solutions } = this.config;

    // If only one solution, just pass it through
    if (!solutions || solutions.length <= 1) {
      log.debug('summarizer-gate', 'Single or no solutions, passing through');
      return {
        ...this.pass({
          reason: 'Single solution, no summarization needed',
          selectedWorkerId: solutions?.[0]?.workerId,
        }),
        duration: Date.now() - startTime,
      };
    }

    log.info('summarizer-gate', `Summarizing ${solutions.length} solutions`);

    // Score each solution by confidence
    const scored = solutions.map(s => ({
      ...s,
      confidence: s.rearmatter.confidence ?? 0.5,
    }));

    // Sort by confidence (descending)
    scored.sort((a, b) => b.confidence - a.confidence);

    // Select the highest confidence solution
    const best = scored[0];

    // Calculate overall confidence based on agreement
    const similarities = this.calculateSimilarities(solutions);
    const avgSimilarity = similarities.length > 0
      ? similarities.reduce((a, b) => a + b, 0) / similarities.length
      : 1.0;

    const details = {
      solutionCount: solutions.length,
      selectedWorkerId: best.workerId,
      selectedConfidence: best.confidence,
      avgSimilarity,
      confidences: scored.map(s => ({
        workerId: s.workerId,
        confidence: s.confidence,
      })),
    };

    // If low agreement, note it but still pass
    if (avgSimilarity < this.config.consensusThreshold!) {
      return {
        gate: this.gate,
        passed: true,
        confidence: best.confidence * avgSimilarity,
        details,
        feedback: `Low consensus among solutions (${(avgSimilarity * 100).toFixed(0)}% similarity). Selected highest confidence solution from ${best.workerId}.`,
        duration: Date.now() - startTime,
      };
    }

    return {
      gate: this.gate,
      passed: true,
      confidence: best.confidence,
      details,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Calculate pairwise similarity between solutions
   * Returns array of similarity scores
   */
  private calculateSimilarities(solutions: EnsembleSolution[]): number[] {
    const similarities: number[] = [];

    for (let i = 0; i < solutions.length; i++) {
      for (let j = i + 1; j < solutions.length; j++) {
        const similarity = this.jaccard(
          solutions[i].solution,
          solutions[j].solution
        );
        similarities.push(similarity);
      }
    }

    return similarities;
  }

  /**
   * Calculate Jaccard similarity between two texts
   * Uses word-level tokenization
   */
  private jaccard(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 1.0;
  }
}

/**
 * Get the best solution from summarizer gate result
 */
export function getBestSolution(
  result: EvalResult,
  solutions: EnsembleSolution[]
): EnsembleSolution | undefined {
  const selectedId = result.details?.selectedWorkerId as string | undefined;
  if (!selectedId) return solutions[0];
  return solutions.find(s => s.workerId === selectedId);
}

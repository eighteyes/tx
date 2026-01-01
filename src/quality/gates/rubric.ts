/**
 * Rubric Gate
 *
 * Scores solution against dynamic criteria from pre-flight.
 * Uses weighted rubric items to compute overall score.
 */

import { BaseEvaluator } from '../registry.ts';
import type { GateType, EvalResult, PreflightOutput, RearmatterData, RubricItem } from '../types.ts';
import { log } from '../../shared/logger.ts';

/**
 * Score for a single rubric criterion
 */
interface RubricScore {
  criterion: string;
  weight: number;
  score: number;          // 0-1 score for this criterion
  weighted: number;       // score * weight
  feedback?: string;
}

/**
 * Default passing threshold (0-1)
 */
const DEFAULT_THRESHOLD = 0.7;

/**
 * RubricGate evaluator
 *
 * Scores solution against rubric from pre-flight.
 * Computes weighted average - passes if above threshold.
 */
export class RubricGate extends BaseEvaluator {
  readonly gate: GateType = 'rubric';

  private threshold: number;

  constructor(threshold: number = DEFAULT_THRESHOLD) {
    super();
    this.threshold = threshold;
  }

  async evaluate(
    solution: string,
    rearmatter: RearmatterData,
    criteria: PreflightOutput,
    _priorEvals?: EvalResult[]
  ): Promise<EvalResult> {
    const startTime = Date.now();

    // If no rubric, pass automatically
    if (!criteria.rubric || criteria.rubric.length === 0) {
      log.debug('rubric-gate', 'No rubric items, passing');
      return {
        ...this.pass({ itemCount: 0 }),
        duration: Date.now() - startTime,
      };
    }

    log.info('rubric-gate', `Evaluating ${criteria.rubric.length} rubric criteria`);

    // Score each rubric item
    const scores = await this.scoreRubricItems(solution, rearmatter, criteria.rubric);

    // Calculate weighted average
    const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
    const weightedSum = scores.reduce((sum, s) => sum + s.weighted, 0);
    const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    const details = {
      threshold: this.threshold,
      overallScore,
      scores,
    };

    // Pass if above threshold
    if (overallScore >= this.threshold) {
      return {
        gate: this.gate,
        passed: true,
        confidence: overallScore,
        details,
        duration: Date.now() - startTime,
      };
    }

    // Build feedback for low-scoring criteria
    const lowScorers = scores
      .filter(s => s.score < this.threshold)
      .sort((a, b) => a.score - b.score);

    const feedback = lowScorers
      .map(s => `- ${s.criterion} (${(s.score * 100).toFixed(0)}%): ${s.feedback || 'Below threshold'}`)
      .join('\n');

    return {
      gate: this.gate,
      passed: false,
      confidence: overallScore,
      feedback: `Score ${(overallScore * 100).toFixed(0)}% below threshold ${(this.threshold * 100).toFixed(0)}%:\n${feedback}`,
      details,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Score solution against rubric items
   * Currently uses heuristic scoring - TODO: integrate LLM
   */
  private async scoreRubricItems(
    solution: string,
    rearmatter: RearmatterData,
    rubric: RubricItem[]
  ): Promise<RubricScore[]> {
    const solutionLower = solution.toLowerCase();
    const scores: RubricScore[] = [];

    for (const item of rubric) {
      // Simple heuristic: check description keywords against solution
      const keywords = this.extractKeywords(item.description);
      const matchCount = keywords.filter(kw =>
        solutionLower.includes(kw.toLowerCase())
      ).length;

      const score = keywords.length > 0
        ? matchCount / keywords.length
        : 0.5; // Default to neutral if no keywords

      // Boost score based on rearmatter confidence if available
      const adjustedScore = rearmatter.confidence
        ? (score + rearmatter.confidence) / 2
        : score;

      scores.push({
        criterion: item.criterion,
        weight: item.weight,
        score: adjustedScore,
        weighted: adjustedScore * item.weight,
        feedback: adjustedScore < this.threshold
          ? `Consider addressing: ${item.description}`
          : undefined,
      });
    }

    return scores;
  }

  /**
   * Extract keywords from description
   */
  private extractKeywords(description: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where',
      'how', 'what', 'which', 'who', 'whom', 'this', 'that',
      'these', 'those', 'it', 'its', 'with', 'for', 'to', 'from',
      'in', 'on', 'at', 'by', 'of', 'all', 'any', 'no', 'not',
    ]);

    return description
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }
}

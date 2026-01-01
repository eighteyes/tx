/**
 * Checklist Gate
 *
 * Verifies that the solution meets task-specific checklist items.
 * Uses LLM to verify each checklist item from pre-flight criteria.
 */

import { BaseEvaluator } from '../registry.ts';
import type { GateType, EvalResult, PreflightOutput, RearmatterData } from '../types.ts';
import { log } from '../../shared/logger.ts';

/**
 * Checklist verification result for a single item
 */
interface ChecklistItemResult {
  item: string;
  passed: boolean;
  reason?: string;
}

/**
 * ChecklistGate evaluator
 *
 * Verifies solution against task-type checklist from pre-flight.
 * Returns pass if all items verified, fail with unchecked items as feedback.
 */
export class ChecklistGate extends BaseEvaluator {
  readonly gate: GateType = 'checklist';

  async evaluate(
    solution: string,
    rearmatter: RearmatterData,
    criteria: PreflightOutput,
    _priorEvals?: EvalResult[]
  ): Promise<EvalResult> {
    const startTime = Date.now();

    // If no checklist, pass automatically
    if (!criteria.checklist || criteria.checklist.length === 0) {
      log.debug('checklist-gate', 'No checklist items, passing');
      return {
        ...this.pass({ itemCount: 0 }),
        duration: Date.now() - startTime,
      };
    }

    log.info('checklist-gate', `Evaluating ${criteria.checklist.length} checklist items`);

    // For now, use a simple heuristic check
    // TODO: Integrate with LLM for proper verification
    const results = await this.verifyChecklistItems(solution, criteria.checklist);

    const passedItems = results.filter(r => r.passed);
    const failedItems = results.filter(r => !r.passed);

    const details = {
      total: criteria.checklist.length,
      passed: passedItems.length,
      failed: failedItems.length,
      items: results,
    };

    // All items must pass
    if (failedItems.length === 0) {
      return {
        ...this.pass(details),
        duration: Date.now() - startTime,
      };
    }

    // Build feedback for failed items
    const feedback = failedItems
      .map(item => `- ${item.item}${item.reason ? `: ${item.reason}` : ''}`)
      .join('\n');

    return {
      ...this.fail(`Checklist items not verified:\n${feedback}`, details),
      duration: Date.now() - startTime,
    };
  }

  /**
   * Verify checklist items against solution
   * Currently uses heuristic matching - TODO: integrate LLM
   */
  private async verifyChecklistItems(
    solution: string,
    checklist: string[]
  ): Promise<ChecklistItemResult[]> {
    const solutionLower = solution.toLowerCase();
    const results: ChecklistItemResult[] = [];

    for (const item of checklist) {
      // Simple heuristic: check if key concepts from checklist item appear in solution
      const keywords = this.extractKeywords(item);
      const matchCount = keywords.filter(kw =>
        solutionLower.includes(kw.toLowerCase())
      ).length;

      const passed = matchCount >= Math.ceil(keywords.length * 0.5);

      results.push({
        item,
        passed,
        reason: passed ? undefined : `Missing key concepts: ${keywords.join(', ')}`,
      });
    }

    return results;
  }

  /**
   * Extract keywords from a checklist item
   */
  private extractKeywords(item: string): string[] {
    // Remove common words and extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where',
      'how', 'what', 'which', 'who', 'whom', 'this', 'that',
      'these', 'those', 'it', 'its', 'with', 'for', 'to', 'from',
      'in', 'on', 'at', 'by', 'of', 'all', 'any', 'no', 'not',
    ]);

    return item
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }
}

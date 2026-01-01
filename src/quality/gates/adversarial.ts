/**
 * Adversarial Gate
 *
 * Challenges the solution by looking for flaws, edge cases, and assumptions.
 * This gate sees prior evaluations to challenge effectively.
 */

import { BaseEvaluator } from '../registry.ts';
import type { GateType, EvalResult, PreflightOutput, RearmatterData } from '../types.ts';
import { log } from '../../shared/logger.ts';

/**
 * Issue severity levels
 */
type Severity = 'critical' | 'major' | 'minor' | 'info';

/**
 * An identified issue or concern
 */
interface AdversarialIssue {
  severity: Severity;
  category: 'assumption' | 'edge-case' | 'missing' | 'inconsistency' | 'risk';
  description: string;
  suggestion?: string;
}

/**
 * AdversarialGate evaluator
 *
 * Attempts to find flaws, edge cases, and questionable assumptions.
 * Unlike other gates, this one ALWAYS sees prior evaluation results.
 */
export class AdversarialGate extends BaseEvaluator {
  readonly gate: GateType = 'adversarial';

  async evaluate(
    solution: string,
    rearmatter: RearmatterData,
    criteria: PreflightOutput,
    priorEvals?: EvalResult[]
  ): Promise<EvalResult> {
    const startTime = Date.now();

    log.info('adversarial-gate', 'Challenging solution', {
      solutionLength: solution.length,
      priorEvalCount: priorEvals?.length ?? 0,
      hasAssumptions: !!rearmatter.assumptions?.length,
      hasLimitations: !!rearmatter.limitations?.length,
    });

    // Collect all issues
    const issues: AdversarialIssue[] = [];

    // Check declared assumptions from rearmatter
    if (rearmatter.assumptions) {
      issues.push(...this.challengeAssumptions(rearmatter.assumptions));
    }

    // Check declared limitations from rearmatter
    if (rearmatter.limitations) {
      issues.push(...this.flagLimitations(rearmatter.limitations));
    }

    // Analyze prior evaluation failures
    if (priorEvals) {
      issues.push(...this.analyzeFailures(priorEvals));
    }

    // Check for common patterns that indicate problems
    issues.push(...this.detectPatternIssues(solution, criteria));

    // Categorize issues by severity
    const critical = issues.filter(i => i.severity === 'critical');
    const major = issues.filter(i => i.severity === 'major');
    const minor = issues.filter(i => i.severity === 'minor');
    const info = issues.filter(i => i.severity === 'info');

    const details = {
      total: issues.length,
      critical: critical.length,
      major: major.length,
      minor: minor.length,
      info: info.length,
      issues,
    };

    // Fail if any critical issues
    if (critical.length > 0) {
      const feedback = this.formatIssues('Critical issues found', critical);
      return {
        ...this.fail(feedback, details),
        duration: Date.now() - startTime,
      };
    }

    // Calculate confidence based on issues
    // Start at 1.0, reduce for each issue based on severity
    let confidence = 1.0;
    confidence -= major.length * 0.15;
    confidence -= minor.length * 0.05;
    confidence -= info.length * 0.01;
    confidence = Math.max(0, confidence);

    // Pass with concerns if only minor issues
    if (major.length === 0) {
      let feedback: string | undefined;
      if (minor.length > 0 || info.length > 0) {
        feedback = this.formatIssues('Minor concerns noted', [...minor, ...info]);
      }
      return {
        gate: this.gate,
        passed: true,
        confidence,
        details,
        feedback,
        duration: Date.now() - startTime,
      };
    }

    // Major issues present - flag but don't fail
    const feedback = this.formatIssues('Major concerns found', major);
    return {
      gate: this.gate,
      passed: true, // Adversarial gate typically flags rather than fails
      confidence,
      details,
      feedback,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Challenge declared assumptions
   */
  private challengeAssumptions(assumptions: string[]): AdversarialIssue[] {
    return assumptions.map(assumption => ({
      severity: 'major' as Severity,
      category: 'assumption' as const,
      description: `Assumption made: "${assumption}"`,
      suggestion: 'Verify this assumption or document its impact if incorrect',
    }));
  }

  /**
   * Flag declared limitations
   */
  private flagLimitations(limitations: string[]): AdversarialIssue[] {
    return limitations.map(limitation => ({
      severity: 'minor' as Severity,
      category: 'missing' as const,
      description: `Known limitation: "${limitation}"`,
      suggestion: 'Consider if this limitation is acceptable for the use case',
    }));
  }

  /**
   * Analyze failures from prior evaluations
   */
  private analyzeFailures(priorEvals: EvalResult[]): AdversarialIssue[] {
    const issues: AdversarialIssue[] = [];

    for (const eval_ of priorEvals) {
      if (!eval_.passed && eval_.feedback) {
        issues.push({
          severity: 'info' as Severity,
          category: 'inconsistency' as const,
          description: `Previous ${eval_.gate} gate failed: ${eval_.feedback}`,
        });
      }
    }

    return issues;
  }

  /**
   * Detect common pattern issues
   */
  private detectPatternIssues(solution: string, criteria: PreflightOutput): AdversarialIssue[] {
    const issues: AdversarialIssue[] = [];
    const solutionLower = solution.toLowerCase();

    // Check for TODO/FIXME markers
    if (solutionLower.includes('todo') || solutionLower.includes('fixme')) {
      issues.push({
        severity: 'minor',
        category: 'missing',
        description: 'Solution contains TODO/FIXME markers',
        suggestion: 'Complete or document these items',
      });
    }

    // Check for placeholder text
    if (solutionLower.includes('placeholder') || solutionLower.includes('...')) {
      issues.push({
        severity: 'minor',
        category: 'missing',
        description: 'Solution may contain placeholder content',
        suggestion: 'Replace placeholders with actual implementation',
      });
    }

    // Check for hardcoded values that might be problematic
    if (solutionLower.includes('localhost') || solutionLower.includes('127.0.0.1')) {
      issues.push({
        severity: 'info',
        category: 'risk',
        description: 'Solution contains hardcoded local addresses',
        suggestion: 'Consider making these configurable',
      });
    }

    // Check if accuracy requirements mention sources but solution lacks them
    if (criteria.accuracyRequirements?.requireSources) {
      if (!solutionLower.includes('source') &&
          !solutionLower.includes('reference') &&
          !solutionLower.includes('http')) {
        issues.push({
          severity: 'major',
          category: 'missing',
          description: 'Sources required but solution appears to lack citations',
          suggestion: 'Add source references to support claims',
        });
      }
    }

    return issues;
  }

  /**
   * Format issues into human-readable feedback
   */
  private formatIssues(header: string, issues: AdversarialIssue[]): string {
    if (issues.length === 0) return '';

    const lines = [header + ':'];
    for (const issue of issues) {
      lines.push(`- [${issue.severity.toUpperCase()}] ${issue.description}`);
      if (issue.suggestion) {
        lines.push(`  Suggestion: ${issue.suggestion}`);
      }
    }
    return lines.join('\n');
  }
}

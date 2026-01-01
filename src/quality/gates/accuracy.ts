/**
 * Accuracy Gate
 *
 * Validates sources and checks first-party vs second-party quality.
 * Verifies claims are backed by appropriate references.
 */

import { BaseEvaluator } from '../registry.ts';
import type { GateType, EvalResult, PreflightOutput, RearmatterData, SourceReference } from '../types.ts';
import { log } from '../../shared/logger.ts';

/**
 * Source validation result
 */
interface SourceValidation {
  source: SourceReference;
  isValid: boolean;
  quality: 'first-party' | 'second-party' | 'unknown';
  issue?: string;
}

/**
 * Known first-party domain patterns
 * These are official documentation or primary sources
 */
const FIRST_PARTY_PATTERNS = [
  /docs\./i,
  /developer\./i,
  /official/i,
  /\.gov$/i,
  /github\.com\/[^/]+\/[^/]+$/i,  // Official repos (not issues/discussions)
  /mozilla\.org/i,
  /w3\.org/i,
  /ietf\.org/i,
  /rfc-editor\.org/i,
];

/**
 * Known second-party domain patterns
 * These are blogs, tutorials, and community content
 */
const SECOND_PARTY_PATTERNS = [
  /medium\.com/i,
  /dev\.to/i,
  /stackoverflow\.com/i,
  /reddit\.com/i,
  /blog\./i,
  /tutorial/i,
  /hackernews/i,
];

/**
 * AccuracyGate evaluator
 *
 * Validates sources and their quality (first-party vs second-party).
 * Checks that claims are appropriately sourced.
 */
export class AccuracyGate extends BaseEvaluator {
  readonly gate: GateType = 'accuracy';

  async evaluate(
    solution: string,
    rearmatter: RearmatterData,
    criteria: PreflightOutput,
    _priorEvals?: EvalResult[]
  ): Promise<EvalResult> {
    const startTime = Date.now();
    const requirements = criteria.accuracyRequirements;

    // If no accuracy requirements, pass automatically
    if (!requirements) {
      log.debug('accuracy-gate', 'No accuracy requirements, passing');
      return {
        ...this.pass({ reason: 'No accuracy requirements specified' }),
        duration: Date.now() - startTime,
      };
    }

    log.info('accuracy-gate', 'Evaluating source accuracy', {
      requireSources: requirements.requireSources,
      preferFirstParty: requirements.preferFirstParty,
      minSourceCount: requirements.minSourceCount,
    });

    // Extract sources from rearmatter or solution
    const sources = rearmatter.sources || this.extractSourcesFromSolution(solution);

    // Validate each source
    const validations = sources.map(source => this.validateSource(source));
    const validSources = validations.filter(v => v.isValid);
    const firstPartySources = validations.filter(v => v.quality === 'first-party');
    const secondPartySources = validations.filter(v => v.quality === 'second-party');

    const details = {
      totalSources: sources.length,
      validSources: validSources.length,
      firstParty: firstPartySources.length,
      secondParty: secondPartySources.length,
      unknown: validations.filter(v => v.quality === 'unknown').length,
      validations,
    };

    const issues: string[] = [];

    // Check minimum source count
    if (requirements.minSourceCount && sources.length < requirements.minSourceCount) {
      issues.push(
        `Minimum ${requirements.minSourceCount} sources required, found ${sources.length}`
      );
    }

    // Check if sources required but none found
    if (requirements.requireSources && sources.length === 0) {
      issues.push('Sources required but none found');
    }

    // Check first-party preference
    if (requirements.preferFirstParty && firstPartySources.length === 0 && sources.length > 0) {
      issues.push('First-party sources preferred but none found');
    }

    // Calculate confidence based on source quality
    let confidence = 1.0;
    if (sources.length > 0) {
      const firstPartyRatio = firstPartySources.length / sources.length;
      confidence = 0.5 + (firstPartyRatio * 0.5); // 0.5-1.0 based on first-party ratio
    } else if (requirements.requireSources) {
      confidence = 0;
    }

    // Fail if critical issues
    if (issues.length > 0 && (requirements.requireSources || requirements.minSourceCount)) {
      return {
        gate: this.gate,
        passed: false,
        confidence,
        feedback: `Accuracy validation failed:\n${issues.map(i => `- ${i}`).join('\n')}`,
        details,
        duration: Date.now() - startTime,
      };
    }

    // Pass with optional feedback
    return {
      gate: this.gate,
      passed: true,
      confidence,
      details,
      feedback: issues.length > 0
        ? `Source quality notes:\n${issues.map(i => `- ${i}`).join('\n')}`
        : undefined,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Extract sources from solution text
   */
  private extractSourcesFromSolution(solution: string): SourceReference[] {
    const sources: SourceReference[] = [];

    // Find URLs in solution
    const urlRegex = /https?:\/\/[^\s\)\]"'<>]+/gi;
    const urls = solution.match(urlRegex) || [];

    for (const url of urls) {
      sources.push({
        url,
        type: this.classifySource(url),
      });
    }

    return sources;
  }

  /**
   * Validate a source reference
   */
  private validateSource(source: SourceReference): SourceValidation {
    // Already classified
    const quality = source.type !== 'unknown'
      ? source.type
      : source.url
        ? this.classifySource(source.url)
        : 'unknown';

    // Simple validation - check if URL looks valid
    const isValid = !source.url || this.isValidUrl(source.url);

    return {
      source,
      isValid,
      quality,
      issue: isValid ? undefined : 'Invalid URL format',
    };
  }

  /**
   * Classify a source as first-party, second-party, or unknown
   */
  private classifySource(url: string): 'first-party' | 'second-party' | 'unknown' {
    const urlLower = url.toLowerCase();

    for (const pattern of FIRST_PARTY_PATTERNS) {
      if (pattern.test(urlLower)) {
        return 'first-party';
      }
    }

    for (const pattern of SECOND_PARTY_PATTERNS) {
      if (pattern.test(urlLower)) {
        return 'second-party';
      }
    }

    return 'unknown';
  }

  /**
   * Check if URL is valid format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

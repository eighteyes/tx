/**
 * Aggregation Engine for Ensemble Results
 *
 * Provides various strategies for combining results from multiple agents:
 * - concat: Simple concatenation with agent labels
 * - deduplicate: Remove duplicate findings
 * - voting: Vote on best result (Phase 3)
 * - consensus: Find common themes (Phase 3)
 * - custom: Custom aggregation via Claude query (Phase 3)
 */

import type { AggregationStrategy, AggregationResult } from '../shared/types.ts';
import { log } from '../shared/logger.ts';

export interface AgentResult {
  agent: string;
  content: string;
}

export interface AggregationOptions {
  customPrompt?: string;
  query?: (prompt: string, opts?: any) => Promise<string>;
}

export class AggregationEngine {
  /**
   * Aggregate results from multiple agents using specified strategy
   */
  static async aggregate(
    strategy: AggregationStrategy,
    results: AgentResult[],
    options: AggregationOptions = {}
  ): Promise<AggregationResult> {
    log.info('aggregation', 'Aggregating results', {
      strategy,
      agentCount: results.length,
      hasCustomPrompt: !!options.customPrompt,
    });

    switch (strategy) {
      case 'concat':
        return this.aggregateConcat(results);

      case 'deduplicate':
        return this.aggregateDeduplicate(results);

      case 'voting':
      case 'consensus':
      case 'custom':
        log.warn('aggregation', `Strategy '${strategy}' deferred to Phase 3, using concat fallback`);
        return this.aggregateConcat(results);

      default:
        log.warn('aggregation', `Unknown strategy '${strategy}', using concat fallback`);
        return this.aggregateConcat(results);
    }
  }

  /**
   * Concat strategy: Simple concatenation with agent labels
   */
  private static aggregateConcat(results: AgentResult[]): AggregationResult {
    const sections: string[] = [];

    for (const result of results) {
      sections.push(`## Agent: ${result.agent}\n\n${result.content}`);
    }

    const aggregated_content = sections.join('\n\n---\n\n');

    return {
      aggregated_content,
      metadata: {
        strategy: 'concat',
        agent_count: results.length,
      },
    };
  }

  /**
   * Deduplicate strategy: Remove duplicate findings
   * Uses simple line-based deduplication
   */
  private static aggregateDeduplicate(results: AgentResult[]): AggregationResult {
    const allLines = new Set<string>();
    const agentContributions: Record<string, number> = {};

    for (const result of results) {
      const lines = result.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      for (const line of lines) {
        if (!allLines.has(line)) {
          allLines.add(line);
          agentContributions[result.agent] = (agentContributions[result.agent] || 0) + 1;
        }
      }
    }

    const aggregated_content = Array.from(allLines).join('\n');

    return {
      aggregated_content,
      metadata: {
        strategy: 'deduplicate',
        agent_count: results.length,
        unique_findings: allLines.size,
        agent_contributions: agentContributions,
      },
    };
  }
}

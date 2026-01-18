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
        return this.aggregateVoting(results);

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

  /**
   * Voting strategy: Pick the result that appears most frequently
   *
   * Uses content similarity to group results and pick the majority.
   * If no clear majority, picks the longest result as most comprehensive.
   *
   * Similarity is calculated using normalized Levenshtein distance.
   * Results within 20% similarity are considered equivalent.
   */
  private static aggregateVoting(results: AgentResult[]): AggregationResult {
    if (results.length === 0) {
      return {
        aggregated_content: '',
        metadata: {
          strategy: 'voting',
          agent_count: 0,
          winner: null,
          vote_count: 0,
        },
      };
    }

    if (results.length === 1) {
      return {
        aggregated_content: results[0].content,
        metadata: {
          strategy: 'voting',
          agent_count: 1,
          winner: results[0].agent,
          vote_count: 1,
        },
      };
    }

    // Group similar results using content fingerprinting
    const groups: { agents: string[]; content: string; fingerprint: string }[] = [];
    const SIMILARITY_THRESHOLD = 0.8; // 80% similarity to be in same group

    for (const result of results) {
      const fingerprint = this.createFingerprint(result.content);
      let foundGroup = false;

      for (const group of groups) {
        const similarity = this.calculateSimilarity(fingerprint, group.fingerprint);
        if (similarity >= SIMILARITY_THRESHOLD) {
          group.agents.push(result.agent);
          // Keep the longer content as more comprehensive
          if (result.content.length > group.content.length) {
            group.content = result.content;
            group.fingerprint = fingerprint;
          }
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        groups.push({
          agents: [result.agent],
          content: result.content,
          fingerprint,
        });
      }
    }

    // Find the group with the most votes
    groups.sort((a, b) => {
      // Primary: more votes wins
      if (b.agents.length !== a.agents.length) {
        return b.agents.length - a.agents.length;
      }
      // Secondary: longer content wins (more comprehensive)
      return b.content.length - a.content.length;
    });

    const winner = groups[0];

    log.info('aggregation', 'Voting result', {
      groupCount: groups.length,
      winnerAgents: winner.agents,
      voteCount: winner.agents.length,
      totalAgents: results.length,
    });

    // Build metadata about all votes
    const voteBreakdown = groups.map(g => ({
      agents: g.agents,
      votes: g.agents.length,
      contentLength: g.content.length,
    }));

    return {
      aggregated_content: winner.content,
      metadata: {
        strategy: 'voting',
        agent_count: results.length,
        winner: winner.agents[0],
        winning_coalition: winner.agents,
        vote_count: winner.agents.length,
        group_count: groups.length,
        vote_breakdown: voteBreakdown,
      },
    };
  }

  /**
   * Create a fingerprint from content for similarity comparison
   * Normalizes whitespace, lowercases, and extracts key tokens
   */
  private static createFingerprint(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  /**
   * Calculate similarity between two fingerprints using Jaccard similarity
   * Returns value between 0 (completely different) and 1 (identical)
   */
  private static calculateSimilarity(fp1: string, fp2: string): number {
    if (fp1 === fp2) return 1;
    if (!fp1 || !fp2) return 0;

    // Use word-based Jaccard similarity
    const words1 = new Set(fp1.split(' ').filter(w => w.length > 2));
    const words2 = new Set(fp2.split(' ').filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}

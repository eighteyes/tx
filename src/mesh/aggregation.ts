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
        return this.aggregateConsensus(results);

      case 'custom':
        log.warn('aggregation', `Strategy 'custom' deferred to Phase 2, using concat fallback`);
        return this.aggregateCustomFallback(results);

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
   * Uses case-insensitive line-based deduplication
   */
  private static aggregateDeduplicate(results: AgentResult[]): AggregationResult {
    // Track normalised → original line (first seen wins)
    const seenNorm = new Map<string, string>();
    let totalLines = 0;

    for (const result of results) {
      const lines = result.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      totalLines += lines.length;

      for (const line of lines) {
        const norm = line.toLowerCase();
        if (!seenNorm.has(norm)) {
          seenNorm.set(norm, line);
        }
      }
    }

    const uniqueLines = Array.from(seenNorm.values());
    const duplicatesRemoved = totalLines - uniqueLines.length;
    const aggregated_content = uniqueLines.join('\n');

    return {
      aggregated_content,
      metadata: {
        strategy: 'deduplicate',
        agent_count: results.length,
        unique_lines: uniqueLines.length,
        duplicates_removed: duplicatesRemoved,
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

    // Detect tie: top two groups have same vote count
    const isTie = groups.length >= 2 && groups[0].agents.length === groups[1].agents.length;

    let aggregated_content: string;
    if (isTie) {
      // Format tie result
      const tieOptions = groups.map(g =>
        `- "${g.content}" (${g.agents.join(', ')})`
      ).join('\n');
      aggregated_content = `Tie — no clear winner.\n\n${tieOptions}`;
    } else {
      // Format winning result with vote attribution
      const voteCount = winner.agents.length;
      const totalAgents = results.length;
      aggregated_content = `${winner.content}\n\n[${voteCount}/${totalAgents} agents: ${winner.agents.join(', ')}]`;
    }

    return {
      aggregated_content,
      metadata: {
        strategy: 'voting',
        agent_count: results.length,
        winner: isTie ? null : winner.agents[0],
        winning_coalition: isTie ? [] : winner.agents,
        vote_count: winner.agents.length,
        group_count: groups.length,
        is_tie: isTie,
      },
    };
  }

  /**
   * Consensus strategy: Find lines that appear across multiple agent results
   * Lines appearing in 2+ results are "common themes"
   */
  private static aggregateConsensus(results: AgentResult[]): AggregationResult {
    if (results.length === 0) {
      return {
        aggregated_content: '',
        metadata: { strategy: 'consensus', agent_count: 0, common_themes: 0, unique_points: 0 },
      };
    }

    // Count normalised line occurrences across agents
    const lineCount = new Map<string, { original: string; count: number }>();

    for (const result of results) {
      const lines = result.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      // Deduplicate within the same agent to avoid double-counting
      const seenInAgent = new Set<string>();
      for (const line of lines) {
        const norm = line.toLowerCase();
        if (!seenInAgent.has(norm)) {
          seenInAgent.add(norm);
          const entry = lineCount.get(norm);
          if (entry) {
            entry.count++;
          } else {
            lineCount.set(norm, { original: line, count: 1 });
          }
        }
      }
    }

    const threshold = Math.max(2, Math.ceil(results.length * 0.5));
    const commonThemes: string[] = [];
    const uniquePoints: string[] = [];

    for (const { original, count } of lineCount.values()) {
      if (count >= threshold) {
        commonThemes.push(original);
      } else {
        uniquePoints.push(original);
      }
    }

    const sections: string[] = [];
    if (commonThemes.length > 0) {
      sections.push(`## Common Themes\n\n${commonThemes.join('\n')}`);
    }
    if (uniquePoints.length > 0) {
      sections.push(`## Unique Points\n\n${uniquePoints.join('\n')}`);
    }

    return {
      aggregated_content: sections.join('\n\n'),
      metadata: {
        strategy: 'consensus',
        agent_count: results.length,
        common_themes: commonThemes.length,
        unique_points: uniquePoints.length,
      },
    };
  }

  /**
   * Custom strategy Phase 2 fallback: concat with Phase 2 Fallback label
   * Full custom aggregation via LLM query is deferred to Phase 2
   */
  private static aggregateCustomFallback(results: AgentResult[]): AggregationResult {
    const base = this.aggregateConcat(results);
    return {
      aggregated_content: `## Phase 2 Fallback\n\nCustom aggregation via LLM is deferred to Phase 2.\n\n${base.aggregated_content}`,
      metadata: {
        ...base.metadata,
        strategy: 'custom',
        strategy_type: 'custom',
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

/**
 * Aggregation Engine
 *
 * Implements multiple strategies for aggregating results from parallel ensemble agents.
 *
 * Strategies:
 * - concat: Simple concatenation with agent labels
 * - deduplicate: Remove duplicate findings, preserve unique insights
 * - voting: Identify consensus through vote counts
 * - consensus: Find common themes, highlight disagreements
 * - custom: Use provided prompt to guide aggregation via Claude (Phase 2)
 */

import type { AggregationResult } from '../shared/types.ts';

export class AggregationEngine {
  /**
   * Aggregate results from multiple agents using the specified strategy
   *
   * @param strategy - The aggregation strategy to use
   * @param results - Array of {agent, content} pairs to aggregate
   * @param options - Optional configuration (customPrompt, model)
   * @returns AggregationResult with aggregated content and metadata
   */
  static async aggregate(
    strategy: 'concat' | 'deduplicate' | 'voting' | 'consensus' | 'custom',
    results: Array<{ agent: string; content: string }>,
    options?: { customPrompt?: string; model?: string }
  ): Promise<AggregationResult> {
    // Categorize results
    const successful = results.filter(r => r.content && r.content.trim().length > 0);
    const failed = results.filter(r => !r.content || r.content.trim().length === 0);

    let aggregated = '';
    const metadata: Record<string, unknown> = {};

    // Execute strategy
    switch (strategy) {
      case 'concat':
        aggregated = this.concat(successful);
        metadata.agent_count = successful.length;
        break;

      case 'deduplicate':
        const dedupeResult = this.deduplicate(successful);
        aggregated = dedupeResult.content;
        metadata.duplicates_removed = dedupeResult.dupeCount;
        metadata.unique_lines = dedupeResult.uniqueCount;
        break;

      case 'voting':
        aggregated = this.voting(successful);
        metadata.voting_method = 'majority';
        break;

      case 'consensus':
        const consensusResult = this.consensus(successful);
        aggregated = consensusResult.content;
        metadata.common_themes = consensusResult.commonThemes.length;
        metadata.unique_points = consensusResult.uniquePoints.length;
        break;

      case 'custom':
        // Placeholder for Phase 2: Custom prompt-based aggregation
        aggregated = this.customPlaceholder(successful, options?.customPrompt);
        metadata.strategy_type = 'custom';
        break;

      default:
        aggregated = this.concat(successful);
        metadata.strategy = strategy;
    }

    return {
      strategy,
      source_count: results.length,
      successful_agents: successful.map(r => r.agent),
      failed_agents: failed.map(r => r.agent),
      aggregated_content: aggregated,
      metadata
    };
  }

  /**
   * Concat strategy: Simple concatenation with agent labels
   */
  private static concat(results: Array<{ agent: string; content: string }>): string {
    return results
      .map(r => `## ${r.agent}\n\n${r.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Deduplicate strategy: Remove duplicate lines while preserving unique insights
   */
  private static deduplicate(
    results: Array<{ agent: string; content: string }>
  ): { content: string; dupeCount: number; uniqueCount: number } {
    const seen = new Set<string>();
    let dupeCount = 0;
    let totalLines = 0;

    // Collect all unique lines
    for (const result of results) {
      const lines = result.content.split('\n').filter(l => l.trim().length > 0);
      for (const line of lines) {
        const normalized = line.trim().toLowerCase();
        if (seen.has(normalized)) {
          dupeCount++;
        } else {
          seen.add(normalized);
        }
        totalLines++;
      }
    }

    const uniqueLines = Array.from(seen)
      .map(l => {
        // Try to find original casing
        for (const result of results) {
          const match = result.content.split('\n').find(line => line.trim().toLowerCase() === l);
          if (match) return match.trim();
        }
        return l;
      });

    const content = `## Unique Findings (${seen.size} unique, ${dupeCount} duplicates removed)\n\n${uniqueLines.join('\n')}`;

    return {
      content,
      dupeCount,
      uniqueCount: seen.size
    };
  }

  /**
   * Voting strategy: Identify consensus through vote counts
   * Best for structured responses (yes/no, agree/disagree, ratings, etc.)
   */
  private static voting(results: Array<{ agent: string; content: string }>): string {
    // Count occurrences of each response
    const votes = new Map<string, number>();
    const agentsByVote = new Map<string, string[]>();

    for (const result of results) {
      const normalized = result.content.trim();
      const count = votes.get(normalized) || 0;
      votes.set(normalized, count + 1);

      if (!agentsByVote.has(normalized)) {
        agentsByVote.set(normalized, []);
      }
      agentsByVote.get(normalized)!.push(result.agent);
    }

    // Find winner(s)
    let maxVotes = 0;
    for (const count of votes.values()) {
      if (count > maxVotes) maxVotes = count;
    }

    const total = results.length;
    const percentage = ((maxVotes / total) * 100).toFixed(1);
    const winners = Array.from(votes.entries())
      .filter(([_, count]) => count === maxVotes)
      .map(([content, count]) => ({
        content: content.substring(0, 100),
        votes: count,
        agents: agentsByVote.get(content) || []
      }));

    if (winners.length === 1) {
      const winner = winners[0];
      return `## Consensus Result (${winner.votes}/${total} votes, ${percentage}%)\n\n${winner.content}\n\nSupported by: ${winner.agents.join(', ')}`;
    } else {
      // Multiple winners (tie)
      const winnerText = winners
        .map(w => `- "${w.content}" (${w.votes}/${total} votes from ${w.agents.join(', ')})`)
        .join('\n');
      return `## Voting Results (Tie between ${winners.length} options)\n\n${winnerText}`;
    }
  }

  /**
   * Consensus strategy: Identify common themes and highlight disagreements
   */
  private static consensus(
    results: Array<{ agent: string; content: string }>
  ): { content: string; commonThemes: string[]; uniquePoints: string[] } {
    const lines = results.flatMap(r => r.content.split('\n').filter(l => l.trim().length > 0));
    const lineFreq = new Map<string, { count: number; agents: Set<string> }>();

    // Count line occurrences
    for (const result of results) {
      const resultLines = result.content.split('\n').filter(l => l.trim().length > 0);
      const seen = new Set<string>();

      for (const line of resultLines) {
        const normalized = line.trim();
        if (seen.has(normalized)) continue; // Skip duplicates within same agent
        seen.add(normalized);

        const existing = lineFreq.get(normalized) || { count: 0, agents: new Set() };
        existing.count++;
        existing.agents.add(result.agent);
        lineFreq.set(normalized, existing);
      }
    }

    // Separate by frequency
    const commonThemes: string[] = [];
    const uniquePoints: string[] = [];

    for (const [line, data] of lineFreq.entries()) {
      if (data.count > 1) {
        commonThemes.push(`${line} (${data.count}/${results.length} agents: ${Array.from(data.agents).join(', ')})`);
      } else {
        uniquePoints.push(`${line} (${Array.from(data.agents)[0]})`);
      }
    }

    // Sort by frequency
    commonThemes.sort((a, b) => {
      const countA = parseInt(a.match(/\((\d+)\//)![1]);
      const countB = parseInt(b.match(/\((\d+)\//)![1]);
      return countB - countA;
    });

    const content = `## Consensus Analysis\n\n### Common Themes (${commonThemes.length})\n${commonThemes.join('\n') || 'None'}\n\n### Unique Points (${uniquePoints.length})\n${uniquePoints.join('\n') || 'None'}`;

    return {
      content,
      commonThemes,
      uniquePoints
    };
  }

  /**
   * Custom strategy placeholder: Shows structure for Phase 2 implementation
   * In Phase 2, this will call Claude with the custom aggregation prompt
   */
  private static customPlaceholder(results: Array<{ agent: string; content: string }>, _customPrompt?: string): string {
    // Phase 2: Use customPrompt to guide Claude in aggregation
    // For now, fall back to concat strategy
    const concatResult = this.concat(results);
    return `[Custom Aggregation - Phase 2 Implementation]\n\nFallback to concatenation:\n\n${concatResult}`;
  }
}

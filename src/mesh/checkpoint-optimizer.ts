/**
 * Checkpoint Optimizer
 *
 * Analyzes mesh manifest to automatically place checkpoints and infer fork_from
 * relationships based on file I/O patterns.
 *
 * Strategy:
 * - Score agents by "fanout" (how many other agents read files they write)
 * - Auto-enable checkpoints for high-fanout agents (score >= threshold)
 * - Infer fork_from for agents that read from a single checkpointed writer
 *
 * This optimization reduces context re-creation by sharing session state
 * from "setup" agents to downstream workers.
 */

import { log } from '../shared/logger.ts';
import type { ManifestEntry } from '../worker/mesh-validator.ts';
import type { AgentConfig } from './config-loader.ts';

/**
 * Checkpoint optimization configuration
 */
export interface CheckpointOptimizationConfig {
  /** Enable auto-checkpoint and fork inference (default: false) */
  enabled: boolean;
  /** Fanout threshold: agents with score >= threshold get checkpoint (default: 3) */
  threshold?: number;
  /** Agents to never auto-checkpoint (default: []) */
  exclude?: string[];
}

/**
 * Result of checkpoint optimization analysis
 */
export interface CheckpointOptimizationResult {
  /** Agent name → fanout score */
  scores: Map<string, number>;
  /** Agents that were auto-checkpointed */
  autoCheckpointed: string[];
  /** Agent name → inferred fork_from agent */
  inferredForks: Map<string, string>;
}

/**
 * Compute checkpoint scores based on manifest fanout analysis.
 *
 * For each file in the manifest:
 * - Each writer gets credit for how many agents read that file
 *
 * Higher scores = more "setup" work that benefits from checkpointing.
 *
 * @param manifest - Array of manifest entries declaring file I/O
 * @returns Map of agent name → fanout score
 */
export function computeCheckpointScores(manifest: ManifestEntry[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const entry of manifest) {
    // Each writer gets points for reader count
    const readerCount = entry.reads.length;

    for (const writer of entry.writes) {
      const currentScore = scores.get(writer) || 0;
      scores.set(writer, currentScore + readerCount);
    }
  }

  return scores;
}

/**
 * Auto-enable checkpoints for high-fanout agents.
 *
 * Agents with score >= threshold get checkpoint: true, unless:
 * - Already explicitly set (explicit config wins)
 * - In the exclude list
 *
 * @param agents - Mutable array of agent configs
 * @param scores - Fanout scores from computeCheckpointScores
 * @param config - Optimization configuration
 * @returns List of agents that were auto-checkpointed
 */
export function autoEnableCheckpoints(
  agents: AgentConfig[],
  scores: Map<string, number>,
  config: CheckpointOptimizationConfig
): string[] {
  const threshold = config.threshold ?? 3;
  const exclude = new Set(config.exclude ?? []);
  const autoCheckpointed: string[] = [];

  for (const agent of agents) {
    // Explicit config wins - don't override
    if (agent.checkpoint !== undefined) {
      continue;
    }

    // Skip excluded agents
    if (exclude.has(agent.name)) {
      continue;
    }

    const score = scores.get(agent.name) || 0;
    if (score >= threshold) {
      // Mutate agent config to add checkpoint
      (agent as { checkpoint: boolean }).checkpoint = true;
      autoCheckpointed.push(agent.name);

      log.info('checkpoint-optimizer', 'Auto-enabled checkpoint', {
        agent: agent.name,
        score,
        threshold
      });
    }
  }

  return autoCheckpointed;
}

/**
 * Infer fork_from for an agent based on manifest dependencies.
 *
 * Strategy:
 * - Find all files this agent reads
 * - Get the writers of those files
 * - If exactly one checkpointed writer → fork from them
 * - If multiple checkpointed writers → ambiguous, return null
 *
 * @param agentName - The agent to infer fork_from for
 * @param manifest - File I/O manifest
 * @param checkpointedAgents - Set of agents with checkpoint: true
 * @returns Agent name to fork from, or null if ambiguous/none
 */
export function inferForkFrom(
  agentName: string,
  manifest: ManifestEntry[],
  checkpointedAgents: Set<string>
): string | null {
  // Find all files this agent reads
  const filesThisAgentReads = manifest.filter(entry => entry.reads.includes(agentName));

  // Get unique writers of those files (excluding self)
  const writers = new Set<string>();
  for (const entry of filesThisAgentReads) {
    for (const writer of entry.writes) {
      if (writer !== agentName) {
        writers.add(writer);
      }
    }
  }

  // Filter to only checkpointed writers
  const checkpointedWriters = [...writers].filter(w => checkpointedAgents.has(w));

  // If single dominant checkpointed writer → fork from them
  if (checkpointedWriters.length === 1) {
    return checkpointedWriters[0];
  }

  // If multiple checkpointed writers → ambiguous, don't infer
  // Future enhancement: could pick by topological order or highest score
  return null;
}

/**
 * Run the full checkpoint optimization pipeline.
 *
 * 1. Score agents by fanout
 * 2. Auto-enable checkpoints for high-fanout agents
 * 3. Infer fork_from for downstream agents
 *
 * Mutates agent configs in place.
 *
 * @param agents - Mutable array of agent configs
 * @param manifest - File I/O manifest
 * @param config - Optimization configuration
 * @param meshName - Mesh name for logging
 * @returns Optimization result with scores and changes made
 */
export function runCheckpointOptimization(
  agents: AgentConfig[],
  manifest: ManifestEntry[],
  config: CheckpointOptimizationConfig,
  meshName: string
): CheckpointOptimizationResult {
  // Step 1: Compute scores
  const scores = computeCheckpointScores(manifest);

  // Step 2: Auto-enable checkpoints
  const autoCheckpointed = autoEnableCheckpoints(agents, scores, config);

  // Build set of all checkpointed agents (explicit + auto)
  const checkpointedAgents = new Set<string>();
  for (const agent of agents) {
    if (agent.checkpoint === true) {
      checkpointedAgents.add(agent.name);
    }
  }

  // Step 3: Infer fork_from
  const inferredForks = new Map<string, string>();

  for (const agent of agents) {
    // Skip if already has fork_from set
    if (agent.fork_from !== undefined) {
      continue;
    }

    // Skip checkpointed agents (they are sources, not forks)
    if (checkpointedAgents.has(agent.name)) {
      continue;
    }

    const forkFrom = inferForkFrom(agent.name, manifest, checkpointedAgents);
    if (forkFrom) {
      // Mutate agent config
      (agent as { fork_from: string }).fork_from = forkFrom;
      inferredForks.set(agent.name, forkFrom);

      log.info('checkpoint-optimizer', 'Inferred fork_from', {
        agent: agent.name,
        forkFrom
      });
    }
  }

  // Log summary
  log.info('checkpoint-optimizer', 'Checkpoint analysis complete', {
    meshName,
    scores: Object.fromEntries(scores),
    autoCheckpointed,
    inferredForks: Object.fromEntries(inferredForks)
  });

  return {
    scores,
    autoCheckpointed,
    inferredForks
  };
}

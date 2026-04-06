/**
 * StaticRouter - Sequential chain resolution for static-mode meshes
 *
 * Responsibilities:
 * - Resolve next agent in an ordered chain given current agent
 * - Identify entry (first) and completion (last) agents
 * - Provide chain metadata for dispatcher orchestration
 */

import { log } from '../shared/logger.ts';

/**
 * Resolved static route — next agent in the chain
 */
export interface StaticRoute {
  target: string;    // Fully qualified: mesh/agent
  source: 'static';
  index: number;     // Position in chain (0-based)
}

/**
 * StaticRouter resolves routing for static-mode meshes.
 *
 * Given the current agent, returns the next agent in the ordered chain.
 * Returns null when the current agent is the last in the chain (completion).
 */
export class StaticRouter {
  private readonly meshName: string;
  private readonly agents: string[];
  private readonly indexMap: Map<string, number>;

  constructor(meshName: string, agents: string[]) {
    this.meshName = meshName;
    this.agents = [...agents];
    this.indexMap = new Map();
    for (let i = 0; i < agents.length; i++) {
      this.indexMap.set(agents[i], i);
    }
    log.debug('static-router', 'Initialized static chain', {
      meshName, chain: agents,
    });
  }

  /**
   * Resolve the next agent after the given agent.
   * Returns null if the agent is the last in the chain.
   * Throws if the agent is not in the chain.
   */
  next(fromAgent: string): StaticRoute | null {
    const index = this.indexMap.get(fromAgent);
    if (index === undefined) {
      throw new Error(`Agent '${fromAgent}' not found in static chain for mesh '${this.meshName}'`);
    }

    const nextIndex = index + 1;
    if (nextIndex >= this.agents.length) {
      return null; // Chain complete
    }

    return {
      target: `${this.meshName}/${this.agents[nextIndex]}`,
      source: 'static',
      index: nextIndex,
    };
  }

  /** First agent in the chain */
  entryAgent(): string {
    return this.agents[0];
  }

  /** Last agent in the chain */
  completionAgent(): string {
    return this.agents[this.agents.length - 1];
  }

  /** Whether the given agent is the last in the chain */
  isLast(agentName: string): boolean {
    return agentName === this.agents[this.agents.length - 1];
  }

  /** Full ordered chain (copy) */
  chain(): string[] {
    return [...this.agents];
  }
}

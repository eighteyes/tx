/**
 * DispatchRouter - Centralized routing resolution for dispatcher-mode meshes
 *
 * Responsibilities:
 * - Resolve agent outcome/route_to to concrete target agent
 * - Detect terminal agents (no routing entry)
 * - Provide injection context for agent prompts (valid outcomes, sentinel, agents)
 * - Handle escalation (outcome: escalate → core/core)
 */

import { log } from '../shared/logger.ts';
import type { DispatcherRoutingConfig, ResolvedRoute, DispatchInjectionContext } from '../shared/types.ts';

/**
 * DispatchRouter resolves routing decisions for dispatcher-mode meshes.
 *
 * Given a sender agent and their outcome/route_to, it determines the
 * concrete target agent using the mesh's dispatcher routing config.
 */
export class DispatchRouter {
  private readonly meshName: string;
  private readonly routing: DispatcherRoutingConfig;
  private readonly agentNames: Set<string>;

  constructor(meshName: string, routing: DispatcherRoutingConfig, agentNames: string[]) {
    this.meshName = meshName;
    this.routing = routing;
    this.agentNames = new Set(agentNames);
  }

  /**
   * Resolve a routing decision for a given agent message.
   *
   * Priority:
   * 1. outcome: escalate → core/core
   * 2. route_to override (validated against mesh agents)
   * 3. Linear routing (string target)
   * 4. Branch routing (outcome → target from config map)
   * 5. Terminal agent (no config entry) + outcome: complete → core/core
   *
   * Returns null when resolution fails (invalid outcome, missing default).
   */
  resolve(fromAgent: string, outcome?: string, routeTo?: string): ResolvedRoute | null {
    // Escalation is always honored
    if (outcome === 'escalate') {
      return { target: 'core/core', source: 'escalate', outcome };
    }

    // route_to override — validate target exists
    if (routeTo) {
      if (this.agentNames.has(routeTo)) {
        return {
          target: `${this.meshName}/${routeTo}`,
          source: 'override',
          outcome,
        };
      }
      // Invalid route_to — fall through to normal resolution (caller handles nudge)
      log.warn('dispatch-router', 'Invalid route_to target', {
        meshName: this.meshName, fromAgent, routeTo,
        validAgents: [...this.agentNames],
      });
      return null;
    }

    const entry = this.routing[fromAgent];

    // Terminal agent — no routing entry
    if (entry === undefined) {
      if (outcome === 'complete') {
        return { target: 'core/core', source: 'terminal', outcome };
      }
      // Terminal agent sent non-complete outcome — unusual but route to core
      log.warn('dispatch-router', 'Terminal agent sent non-complete outcome', {
        meshName: this.meshName, fromAgent, outcome,
      });
      return { target: 'core/core', source: 'terminal', outcome };
    }

    // Linear routing — string value, always routes to that agent
    if (typeof entry === 'string') {
      const target = entry === 'core' ? 'core/core' : `${this.meshName}/${entry}`;
      return { target, source: 'linear', outcome };
    }

    // Branch routing — object value, match outcome to target
    const outcomeMap = entry;
    const resolvedAgent = outcome ? outcomeMap[outcome] : undefined;

    if (resolvedAgent) {
      const target = resolvedAgent === 'core' ? 'core/core' : `${this.meshName}/${resolvedAgent}`;
      return { target, source: 'branch', outcome };
    }

    // Try default fallback
    if (outcomeMap['default']) {
      const target = outcomeMap['default'] === 'core' ? 'core/core' : `${this.meshName}/${outcomeMap['default']}`;
      return { target, source: 'branch', outcome, usedDefault: true };
    }

    // No match, no default — resolution fails
    log.warn('dispatch-router', 'No route resolved for outcome', {
      meshName: this.meshName, fromAgent, outcome,
      validOutcomes: Object.keys(outcomeMap),
    });
    return null;
  }

  /**
   * Check whether an agent is terminal (no routing config entry).
   */
  isTerminal(agentName: string): boolean {
    return this.routing[agentName] === undefined;
  }

  /**
   * Get valid outcome values for a branch agent.
   * Returns null for linear agents (any outcome accepted).
   * Returns empty array for terminal agents.
   */
  getValidOutcomes(agentName: string): string[] | null {
    const entry = this.routing[agentName];
    if (entry === undefined) return [];
    if (typeof entry === 'string') return null;
    return Object.keys(entry).filter(k => k !== 'default');
  }

  /**
   * Build injection context for an agent's prompt.
   * Provides the sentinel address, valid outcomes, and available agents.
   */
  getInjectionContext(agentName: string): DispatchInjectionContext {
    return {
      sentinel: `${this.meshName}/dispatch`,
      validOutcomes: this.getValidOutcomes(agentName),
      availableAgents: [...this.agentNames],
      isTerminal: this.isTerminal(agentName),
    };
  }
}

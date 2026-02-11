/**
 * DispatchRouter - Centralized routing resolution for dispatcher-mode meshes
 *
 * Responsibilities:
 * - Resolve agent outcome/route_to to concrete target agent
 * - Detect terminal agents (no routing entry)
 * - Provide injection context for agent prompts (valid outcomes, sentinel, agents)
 * - Handle escalation (outcome: escalate → core/core)
 * - Handle fan-out arrays with trailing options (discuss/complete)
 */

import { log } from '../shared/logger.ts';
import type { DispatcherRoutingConfig, ResolvedRoute, DispatchInjectionContext, FanOutOptions } from '../shared/types.ts';

/**
 * Parsed fan-out group: agents + options extracted from array entry
 */
interface ParsedFanOut {
  sourceAgent: string;      // Agent whose routing is the fan-out array
  agents: string[];         // Target agent names (strings only)
  options: FanOutOptions;   // Trailing options ({ discuss, complete })
}

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

  // Parsed fan-out groups (source agent → group info)
  private readonly fanOutGroups: Map<string, ParsedFanOut> = new Map();
  // Reverse lookup: member agent → their fan-out group
  private readonly fanOutMembers: Map<string, ParsedFanOut> = new Map();

  constructor(meshName: string, routing: DispatcherRoutingConfig, agentNames: string[]) {
    this.meshName = meshName;
    this.routing = routing;
    this.agentNames = new Set(agentNames);

    // Parse fan-out arrays to extract agents vs trailing options
    for (const [agent, entry] of Object.entries(routing)) {
      if (Array.isArray(entry)) {
        const agents: string[] = [];
        let options: FanOutOptions = {};

        for (const item of entry) {
          if (typeof item === 'string') {
            agents.push(item);
          } else if (typeof item === 'object' && item !== null) {
            options = item as FanOutOptions;
          }
        }

        const group: ParsedFanOut = { sourceAgent: agent, agents, options };
        this.fanOutGroups.set(agent, group);

        // Register each member
        for (const member of agents) {
          this.fanOutMembers.set(member, group);
        }
      }
    }
  }

  /**
   * Resolve a routing decision for a given agent message.
   *
   * Priority:
   * 1. outcome: escalate → core/core
   * 2. route_to override (validated against mesh agents)
   * 3. Fan-out routing (array target — source agent triggers fan-out)
   * 4. Fan-out member implicit routing (auto-generated from group options)
   * 5. Linear routing (string target)
   * 6. Branch routing (outcome → target from config map)
   * 7. Terminal agent (no config entry) + outcome: complete → core/core
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

    // Fan-out routing — array value, spawn multiple agents in parallel
    if (Array.isArray(entry)) {
      const group = this.fanOutGroups.get(fromAgent)!;
      const targets = group.agents.map(a => a === 'core' ? 'core/core' : `${this.meshName}/${a}`);
      return { target: targets[0], targets, source: 'fan-out', outcome };
    }

    // Fan-out member implicit routing — agent has no explicit entry but is in a fan-out group
    if (entry === undefined) {
      const memberGroup = this.fanOutMembers.get(fromAgent);
      if (memberGroup) {
        return this.resolveFanOutMember(fromAgent, outcome, memberGroup);
      }

      // Terminal agent — no routing entry and not a fan-out member
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
    const outcomeMap = entry as Record<string, string>;
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
   * Resolve routing for a fan-out group member using group options.
   *
   * - outcome: complete → group's complete target (join agent)
   * - outcome: discuss → nudge to use route_to (peer selection)
   * - other outcomes → terminal behavior
   */
  private resolveFanOutMember(
    fromAgent: string,
    outcome: string | undefined,
    group: ParsedFanOut
  ): ResolvedRoute | null {
    const { options } = group;

    // outcome: complete → route to join agent
    if (outcome === 'complete' && options.complete) {
      const target = options.complete === 'core' ? 'core/core' : `${this.meshName}/${options.complete}`;
      return { target, source: 'branch', outcome };
    }

    // outcome: discuss without route_to (route_to already handled above in resolve())
    if (outcome === 'discuss') {
      if (!options.discuss) {
        log.warn('dispatch-router', 'Fan-out member sent discuss but discuss not enabled', {
          meshName: this.meshName, fromAgent, group: group.agents,
        });
        return null;
      }
      // discuss without route_to — can't determine peer
      log.warn('dispatch-router', 'Fan-out discuss requires route_to for peer selection', {
        meshName: this.meshName, fromAgent, peers: group.agents,
      });
      return null;
    }

    // outcome: complete but no join agent configured
    if (outcome === 'complete') {
      return { target: 'core/core', source: 'terminal', outcome };
    }

    // Unrecognized outcome — terminal behavior
    log.warn('dispatch-router', 'Fan-out member sent unrecognized outcome', {
      meshName: this.meshName, fromAgent, outcome,
      validOutcomes: options.discuss ? ['complete', 'discuss'] : ['complete'],
    });
    return { target: 'core/core', source: 'terminal', outcome };
  }

  /**
   * Check whether an agent is terminal (no routing config entry
   * and not an implicit fan-out member).
   */
  isTerminal(agentName: string): boolean {
    if (this.routing[agentName] !== undefined) return false;
    if (this.fanOutMembers.has(agentName)) return false;
    return true;
  }

  /**
   * Get valid outcome values for an agent.
   * Returns null for linear/fan-out source agents (any outcome accepted).
   * Returns outcome list for branch agents and fan-out members.
   * Returns empty array for terminal agents.
   */
  getValidOutcomes(agentName: string): string[] | null {
    const entry = this.routing[agentName];

    // Fan-out member — outcomes from group options
    if (entry === undefined && this.fanOutMembers.has(agentName)) {
      const group = this.fanOutMembers.get(agentName)!;
      const outcomes: string[] = [];
      if (group.options.complete) outcomes.push('complete');
      if (group.options.discuss) outcomes.push('discuss');
      return outcomes;
    }

    if (entry === undefined) return []; // Terminal
    if (typeof entry === 'string') return null; // Linear
    if (Array.isArray(entry)) return null; // Fan-out source
    return Object.keys(entry).filter(k => k !== 'default'); // Branch
  }

  /**
   * Get parallel group info for a fan-out source agent.
   *
   * Returns the parsed fan-out group with agents and join agent
   * (from the trailing options object's `complete` field).
   */
  getParallelGroup(fanOutAgent: string): { agents: string[]; joinAgent: string | null } | null {
    const group = this.fanOutGroups.get(fanOutAgent);
    if (!group) return null;

    return {
      agents: group.agents,
      joinAgent: group.options.complete || null,
    };
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

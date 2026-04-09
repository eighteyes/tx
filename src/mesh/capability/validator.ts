/**
 * MeshValidator - Static analysis for generated mesh configs
 *
 * Validates mesh configurations before execution by checking structural
 * integrity, reachability, guardrails, and best-practice flags.
 *
 * Responsibilities:
 * - Check agent reachability (static and object routing)
 * - Detect dead-end agents missing outbound routes
 * - Verify guardrails coverage (max_turns per agent)
 * - Warn on missing capability block
 * - Warn on missing dev_mode flag
 * - Validate all route targets reference real agents or core
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const CORE_TARGETS = new Set(['core', 'core/core']);

/**
 * Extract all route target names from an object-style routing tree.
 * Handles nested outcome→target mappings like:
 *   { complete: { core: "Done" }, ask: { agentB: "Help" } }
 */
function extractTargets(routingObj: Record<string, any>): Set<string> {
  const targets = new Set<string>();

  for (const value of Object.values(routingObj)) {
    if (typeof value === 'string') {
      targets.add(value);
    } else if (typeof value === 'object' && value !== null) {
      // value is outcome→target map, keys are agent names
      for (const target of Object.keys(value)) {
        targets.add(target);
      }
    }
  }

  return targets;
}

/**
 * Validate a generated mesh config for structural correctness.
 */
export function validateGeneratedMesh(config: Record<string, any>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const agents: Array<{ name: string }> = config.agents ?? [];
  const agentNames = new Set(agents.map(a => a.name));
  const routing = config.routing;
  const isStatic = config.routing_mode === 'static' && Array.isArray(routing);

  // -- Reachability & dead ends --
  if (isStatic) {
    // Static: every name in routing array must exist in agents
    for (const name of routing as string[]) {
      if (!agentNames.has(name)) {
        errors.push(`Static routing references '${name}' which is not in agents list`);
      }
    }
  } else if (routing && typeof routing === 'object' && !Array.isArray(routing)) {
    const routingObj = routing as Record<string, Record<string, any>>;
    const agentsWithInbound = new Set<string>();
    const agentsWithOutbound = new Set<string>();

    // Entry point counts as having inbound
    if (config.entry_point) {
      agentsWithInbound.add(config.entry_point);
    }

    for (const [agentName, routes] of Object.entries(routingObj)) {
      agentsWithOutbound.add(agentName);
      const targets = extractTargets(routes);
      for (const target of targets) {
        if (!CORE_TARGETS.has(target)) {
          agentsWithInbound.add(target);
        }
      }
    }

    // Dead ends: agents with no outbound routing (except those routing to core only)
    for (const agent of agentNames) {
      if (!agentsWithOutbound.has(agent)) {
        errors.push(`Agent '${agent}' has no outbound routing — dead end`);
      }
    }

    // Reachability: every agent must have inbound route or be entry_point
    for (const agent of agentNames) {
      if (!agentsWithInbound.has(agent)) {
        errors.push(`Agent '${agent}' is unreachable — no inbound route and not entry_point`);
      }
    }

    // Route targets: all must be valid agent names or core
    for (const [agentName, routes] of Object.entries(routingObj)) {
      const targets = extractTargets(routes);
      for (const target of targets) {
        if (!CORE_TARGETS.has(target) && !agentNames.has(target)) {
          errors.push(`Routing for '${agentName}' targets '${target}' which is not a valid agent`);
        }
      }
    }
  }

  // -- Guardrails: every agent must have max_turns --
  const guardrailAgents = config.guardrails?.agents ?? {};
  for (const agent of agentNames) {
    const agentGuardrail = guardrailAgents[agent];
    if (!agentGuardrail || agentGuardrail.max_turns == null) {
      errors.push(`Agent '${agent}' missing max_turns in guardrails.agents`);
    }
  }

  // -- Capability block --
  if (!config.capability) {
    warnings.push('Missing capability block — mesh will not be routable by capability matching');
  }

  // -- dev_mode --
  if (!config.dev_mode) {
    warnings.push('dev_mode is not enabled — generated meshes should start in dev_mode');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

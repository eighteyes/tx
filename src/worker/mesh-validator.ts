/**
 * Mesh Config Validator
 *
 * Validates mesh configuration files before they are loaded by the dispatcher.
 * Provides early detection of configuration errors with helpful messages.
 *
 * Validation levels:
 * - Errors: Block mesh from loading (missing required fields, invalid types)
 * - Warnings: Allow loading but log issues (unknown fields, potential typos)
 *
 * Usage:
 * ```typescript
 * const result = MeshValidator.validate(config, 'my-mesh');
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */

import type { SemanticModel, EnsembleConfig, TaskDistributionConfig, AggregationStrategy, FanOutOptions } from '../shared/types.ts';
import { log } from '../shared/logger.ts';

/**
 * Agent configuration within a mesh
 */
export interface MeshAgentConfig {
  name: string;
  model: SemanticModel;
  prompt?: string;  // Path to prompt file relative to workDir (required unless command is set)
  command?: string;  // Slash command to prepend (e.g., "/know:build")
  workspace?: WorkspaceConfigSchema;
}

/**
 * Workspace configuration schema
 */
export interface WorkspaceConfigSchema {
  output?: string;
  schema?: Record<string, unknown>;
}

/**
 * Routing rule configuration
 */
export interface RoutingRule {
  [target: string]: string;  // target agent -> description
}

/**
 * Per-agent routing configuration
 */
export interface AgentRouting {
  [transition: string]: RoutingRule;  // transition name -> routing rule
}

/**
 * Mesh routing configuration
 */
export interface MeshRouting {
  [agent: string]: AgentRouting;  // agent name -> routing config
}

/**
 * Rearmatter (transparency metadata) configuration
 */
export interface RearmatterConfig {
  enabled?: boolean;
  fields?: string[];
  thresholds?: {
    confidence?: number;
    grade?: string;
  };
}

/**
 * Full mesh configuration schema
 */
export interface MeshConfigSchema {
  mesh: string;
  description?: string;
  agents: MeshAgentConfig[];
  entry_point?: string;
  completion_agent?: string;
  routing?: MeshRouting;
  rearmatter?: RearmatterConfig;
  workspace?: WorkspaceConfigSchema;
  capabilities?: string[];
  frontmatter?: Record<string, unknown>;
  ensemble?: EnsembleConfig;
  manifest?: ManifestEntry[];
}

/**
 * Manifest entry - declares a file in the mesh I/O manifest
 */
export interface ManifestEntry {
  id: string;
  location?: string;
  persistent?: boolean;
  description?: string;
  reads: string[];
  writes: string[];
  autoInject?: boolean;  // Override mesh-level autoInjectManifestFiles for this entry
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config?: MeshConfigSchema;
}

/**
 * Field specification for validation
 */
interface FieldSpec {
  type: string;  // single type or pipe-separated compound (e.g. 'boolean|array')
  required?: boolean;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

/**
 * Valid grade values for thresholds
 */
const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];

/**
 * Known mesh config fields with their specifications
 */
const MESH_FIELD_SPECS: Record<string, FieldSpec> = {
  // Required fields
  mesh: { type: 'string', required: true },
  agents: { type: 'array', required: true },

  // Optional fields
  description: { type: 'string' },
  entry_point: { type: 'string' },
  completion_agent: { type: 'string' },  // DEPRECATED: Use completion_agents
  completion_agents: { type: 'array' },  // Agents at mesh boundary (can message core/core)
  boundary_agents: { type: 'array' },   // DEPRECATED: Use completion_agents (backward compatibility)
  type: { type: 'string', enum: ['persistent', 'ephemeral'] },
  auto_despawn: { type: 'boolean' },
  keepalive: { type: 'boolean' },
  grace_period_ms: { type: 'number', minimum: 0, maximum: 60000 },
  topology: { type: 'string', enum: ['static', 'dynamic'] },
  routing_mode: { type: 'string', enum: ['agent', 'dispatcher', 'manifest', 'free', 'static'] },
  routing: { type: 'object|array' },
  rearmatter: { type: 'object' },
  workspace: { type: 'object' },  // Workspace config as object (path, create_on_init, etc.)
  brain: { type: 'boolean' },
  capabilities: { type: 'array' },
  capability: { type: 'object' },  // Bidirectional capability declaration for router matching
  frontmatter: { type: 'object' },
  'clear-before': { type: 'boolean' },
  // Intent-based routing
  intents: { type: 'object' },  // { patterns: string[], commands?: Record<string, string> }
  // System mesh flag
  system: { type: 'boolean' },
  // Custom config object for mesh-specific settings
  config: { type: 'object' },
  // Idle timeout (false = disabled, number = minutes)
  idle_timeout_minutes: { type: 'number' },  // Note: false is handled specially
  // Workflow topology (for documentation)
  workflow_topology: { type: 'string' },
  // Worktree shorthand
  worktree: { type: 'boolean' },
  // Lifecycle hooks
  lifecycle: { type: 'object' },
  // Iteration config for quality gates
  iteration: { type: 'object' },  // { maxIterations?: number, onFail?: 'loop' | 'halt' }
  // FSM (Finite State Machine) configuration for workflow orchestration
  fsm: { type: 'object' },  // FSMConfig: { initialState, states, transitions, context }
  // Ensemble configuration: multiple agents on same task with result aggregation
  ensemble: { type: 'object' },  // EnsembleConfig: { agents, aggregation_strategy, timeout_ms, ... }
  // Task distribution configuration: spawner splits task into subtasks
  task_distribution: { type: 'object' },  // TaskDistributionConfig: { spawner, subagents, reviewer, distribution_strategy, ... }
  // Session continuation: persist context across messages
  continuation: { type: 'boolean|array' },  // true | [agent1, agent2]
  // Inject original task message into downstream agents
  injectOriginalMessage: { type: 'boolean' },
  // Tool restriction policy
  toolRestriction: { type: 'string', enum: ['unrestricted', 'mcp-only'] },
  // Turn workspace (custom workspace template for turn-based games)
  turn_workspace: { type: 'object' },
  // Playbook notes for design rationale and documentation
  playbook_notes: { type: 'string' },
  // Debug mode: enables forensics postHook for mesh execution analysis
  debug: { type: 'boolean' },
  // File manifest: declares files, their readers/writers, and locations
  manifest: { type: 'array' },
  // Guardrails: per-mesh overrides for gate thresholds, limits, routing retries
  guardrails: { type: 'object' },
  // Session persistence across mesh runs
  persistence: { type: 'boolean|array' },  // true | [agent1, agent2]
  // Parallel execution blocks with fork/join semantics
  parallelism: { type: 'array' },  // ParallelBlock[]: { agents, entry, exit, timeout?, on_partial? }
  // Routing fallback and retry limits
  routing_fallback: { type: 'string' },
  routing_retry_max: { type: 'number' },
  // Manifest enforcement settings
  manifest_enforcement: { type: 'object' },
  // Mesh-wide message limit (guardrail)
  max_mesh_messages: { type: 'number|object' },  // number or { strict, warning, limit }
  // Auto-inject manifest reads into agent context
  autoInjectManifestFiles: { type: 'boolean' },
  // Development
  dev_mode: { type: 'boolean' },
  // Mesh completion behavior
  stop_on_first_complete: { type: 'boolean' },
  check_queue_on_complete: { type: 'boolean' },
  disable: { type: 'boolean' },
};

/**
 * Known agent config fields
 */
const AGENT_FIELD_SPECS: Record<string, FieldSpec> = {
  name: { type: 'string', required: true },
  model: { type: 'string', required: true, enum: ['opus', 'sonnet', 'haiku'] },
  prompt: { type: 'string' },
  command: { type: 'string' },
  workspace: { type: 'object' },
  mcpServers: { type: 'object' },
  description: { type: 'string' },  // Optional agent documentation
  max_turns: { type: 'number' },  // API round-trip limit per invocation
  max_messages: { type: 'number' },  // Outbound message limit per invocation (chaos contract)
  // File preload: dump files into agent context (globs supported)
  load: { type: 'array' },  // string[]: file paths or glob patterns
  // Session forking: checkpoint and fork_from for context sharing
  checkpoint: { type: 'string', enum: ['start', 'end'] },  // Checkpoint type (boolean true also accepted, normalized to 'start')
  fork_from: { type: 'string' },  // Fork from another agent's checkpoint
  orchestrator: { type: 'boolean' },  // Restrict to Read + Write(msgs only)
  // Browser + thinking + prompt config
  chrome: { type: 'boolean' },           // Launch agent with --chrome (ChromeCliRunner)
  thinking: { type: 'object' },          // Extended thinking config { budget_tokens }
  fragments: { type: 'array' },          // Prompt fragment names to inject (string[])
  load_claude_md: { type: 'boolean' },   // Control CLAUDE.md injection (default: true)
  permissions: { type: 'object' },       // Tool permission overrides { allowedTools, disallowedTools }
  postconditions: { type: 'array' },     // Postcondition checks after worker completion
};

/**
 * MeshValidator - Validates mesh configuration objects
 *
 * Performs structural validation of mesh configs to catch errors early:
 * - Required field presence
 * - Type checking
 * - Enum value validation
 * - Consistency checks (entry_point matches an agent, etc.)
 * - Unknown field warnings
 */
export class MeshValidator {
  /**
   * Validate a mesh configuration
   *
   * @param config - The mesh configuration object to validate
   * @param filename - The filename (for error messages)
   * @returns ValidationResult with errors/warnings
   */
  static validate(config: unknown, filename?: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const context = filename ? ` (${filename})` : '';

    // Check if config is an object
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      errors.push(`Invalid mesh config${context}: must be a JSON object`);
      return { valid: false, errors, warnings };
    }

    const cfg = config as Record<string, unknown>;

    // Validate required fields
    this.validateRequiredFields(cfg, errors, context);
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // Validate field types and values
    this.validateFieldTypes(cfg, errors, warnings, context);

    // Validate agents array
    if (Array.isArray(cfg.agents)) {
      this.validateAgents(cfg.agents, errors, warnings, context);
    }

    // Auto-default for single-agent meshes: set entry_point to the single agent
    // Note: completion_agent is NOT auto-set to allow routing-based exit patterns
    if (Array.isArray(cfg.agents) && cfg.agents.length === 1) {
      const singleAgent = cfg.agents[0] as Record<string, unknown>;
      const agentName = singleAgent.name as string;

      if (!cfg.entry_point && agentName) {
        cfg.entry_point = agentName;
        log.debug('mesh-validator', `Auto-set entry_point to '${agentName}' for single-agent mesh${context}`);
      }
    }

    // Validate entry_point if present
    if (cfg.entry_point && Array.isArray(cfg.agents)) {
      this.validateEntryPoint(cfg.entry_point as string, cfg.agents, errors, warnings, context);
    } else if (!cfg.entry_point) {
      warnings.push(`No entry_point specified${context}, will use first agent`);
    }

    // Validate completion_agent(s) if present
    if (Array.isArray(cfg.agents)) {
      this.validateCompletionAgents(cfg, cfg.agents, warnings, context);
    }

    // Validate routing if present
    if (cfg.routing && Array.isArray(cfg.agents)) {
      if (cfg.routing_mode === 'dispatcher') {
        this.validateDispatcherRouting(cfg.routing, cfg.agents, errors, warnings, context);
      } else {
        this.validateRouting(cfg.routing, cfg.agents, warnings, context);
      }
    }

    // Validate rearmatter if present
    if (cfg.rearmatter) {
      this.validateRearmatter(cfg.rearmatter, errors, warnings, context);
    }

    // Validate FSM if present
    if (cfg.fsm && Array.isArray(cfg.agents)) {
      this.validateFSM(cfg.fsm, cfg.agents, errors, warnings, context);
    }

    // FSM requires routing
    if (cfg.fsm && !cfg.routing) {
      errors.push(`FSM requires 'routing' configuration${context}`);
    }

    // Validate multi-agent mesh routing (skip for dispatcher/manifest/free mode and task_distribution/ensemble meshes)
    if (Array.isArray(cfg.agents) && cfg.agents.length > 1 &&
        cfg.routing_mode !== 'dispatcher' && cfg.routing_mode !== 'manifest' && cfg.routing_mode !== 'free' &&
        !cfg.task_distribution && !cfg.ensemble) {
      this.validateMultiAgentRouting(cfg, errors, warnings, context);
    }

    // Validate FSM state agent routing (skip for dispatcher/manifest/free mode)
    if (cfg.fsm && cfg.routing && Array.isArray(cfg.agents) && cfg.routing_mode !== 'dispatcher' && cfg.routing_mode !== 'manifest' && cfg.routing_mode !== 'free') {
      this.validateFSMStateRouting(cfg.fsm, cfg.routing, cfg.agents, errors, warnings, context);
    }

    // Validate top-level ensemble config if present
    if (cfg.ensemble && Array.isArray(cfg.agents)) {
      this.validateMeshEnsemble(cfg.ensemble, cfg.agents, errors, warnings, context);
    }

    // Validate task_distribution if present
    if (cfg.task_distribution && Array.isArray(cfg.agents)) {
      this.validateTaskDistribution(cfg.task_distribution, cfg.agents, errors, warnings, context);
    }

    // Validate manifest if present
    if (cfg.manifest && Array.isArray(cfg.agents)) {
      this.validateManifest(
        cfg.manifest,
        cfg.routing,
        cfg.agents,
        errors,
        warnings,
        context,
        cfg.workspace,
        cfg.fsm
      );
    }

    // Validate static routing mode: routing must be a non-empty string array,
    // every entry must match a defined agent name
    if (cfg.routing_mode === 'static') {
      if (!cfg.routing || !Array.isArray(cfg.routing)) {
        errors.push(`routing_mode: static requires routing to be a non-empty array of agent names${context}`);
      } else if (cfg.routing.length === 0) {
        errors.push(`routing_mode: static requires at least one agent in routing array${context}`);
      } else {
        const agentNames = new Set((cfg.agents || []).map((a: any) => a.name));
        for (const name of cfg.routing) {
          if (typeof name !== 'string') {
            errors.push(`routing_mode: static — routing array entries must be strings, got ${typeof name}${context}`);
          } else if (!agentNames.has(name)) {
            errors.push(`routing_mode: static — agent '${name}' in routing array not found in agents list${context}`);
          }
        }
      }
    }

    // Validate free routing mode
    if (cfg.routing_mode === 'free') {
      // Warning: free mode with routing section (ignored at runtime)
      if (cfg.routing) {
        warnings.push(`routing_mode 'free' ignores 'routing' configuration${context}. Agents self-route from full roster.`);
      }

      // Warning: free mode with fsm section (not compatible)
      if (cfg.fsm) {
        warnings.push(`routing_mode 'free' ignores 'fsm' configuration${context}. Agents self-organize without state machine.`);
      }
    }

    // Validate manifest routing mode
    if (cfg.routing_mode === 'manifest') {
      // Error: manifest mode without manifest section
      if (!cfg.manifest || !Array.isArray(cfg.manifest) || cfg.manifest.length === 0) {
        errors.push(`routing_mode 'manifest' requires a non-empty 'manifest' section${context}`);
      }

      // Error: agent with zero manifest entries in manifest mode
      if (Array.isArray(cfg.agents) && Array.isArray(cfg.manifest)) {
        for (const agent of cfg.agents) {
          const agentName = typeof agent === 'string' ? agent : agent.name;
          if (!agentName) continue;
          const hasEntry = cfg.manifest.some((entry: any) =>
            (entry.reads && entry.reads.includes(agentName)) ||
            (entry.writes && entry.writes.includes(agentName))
          );
          if (!hasEntry) {
            errors.push(`Agent '${agentName}' has no manifest entries (reads or writes) but routing_mode is 'manifest'${context}`);
          }
        }
      }

      // Warning: manifest mode with routing section (ignored at runtime)
      if (cfg.routing) {
        warnings.push(`routing_mode 'manifest' ignores 'routing' configuration${context}. Manifest declarations drive orchestration.`);
      }

      // Warning: manifest mode with fsm section (ignored at runtime)
      if (cfg.fsm) {
        warnings.push(`routing_mode 'manifest' ignores 'fsm' configuration${context}. Manifest declarations drive orchestration.`);
      }
    }

    // Validate feature incompatibilities
    this.validateFeatureCompatibility(cfg, errors, warnings, context);

    // Deprecation warnings for top-level routing_fallback/routing_retry_max
    if (cfg.routing_fallback !== undefined || cfg.routing_retry_max !== undefined) {
      warnings.push(`Top-level 'routing_fallback'/'routing_retry_max' are deprecated${context}. Move to guardrails.routing_error.routing_fallback / guardrails.routing_error.routing_retry_max`);
    }

    // Check for unknown fields
    this.checkUnknownFields(cfg, MESH_FIELD_SPECS, warnings, context);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      config: errors.length === 0 ? cfg as unknown as MeshConfigSchema : undefined
    };
  }

  /**
   * Validate required fields are present
   */
  private static validateRequiredFields(
    config: Record<string, unknown>,
    errors: string[],
    context: string
  ): void {
    if (!config.mesh) {
      errors.push(`Missing required field 'mesh'${context}`);
    }

    if (!config.agents) {
      errors.push(`Missing required field 'agents'${context}`);
    } else if (!Array.isArray(config.agents)) {
      errors.push(`Field 'agents' must be an array${context}`);
    } else if (config.agents.length === 0) {
      errors.push(`Agents array is empty${context}`);
    }
  }

  /**
   * Validate field types match specifications
   */
  private static validateFieldTypes(
    config: Record<string, unknown>,
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    for (const [field, value] of Object.entries(config)) {
      const spec = MESH_FIELD_SPECS[field];
      if (!spec) continue; // Unknown fields handled separately

      const actualType = this.getType(value);

      // Special case: idle_timeout_minutes can be false (boolean) or number
      if (field === 'idle_timeout_minutes' && value === false) {
        continue; // false is valid for disabling timeout
      }

      // Special case: workspace can be string (legacy) or object (preferred)
      if (field === 'workspace' && actualType === 'string') {
        // Legacy string format - accept but warn
        warnings.push(`Field 'workspace' should be object format { path: "..." }, got string${context}. Legacy format still works but object format is preferred.`);
        continue;
      }

      const allowedTypes = spec.type.split('|');
      if (!allowedTypes.includes(actualType)) {
        warnings.push(`Field '${field}' should be ${spec.type}, got ${actualType}${context}`);
        continue;
      }

      // Check enum values
      if (spec.enum && !spec.enum.includes(value as string)) {
        warnings.push(`Field '${field}' must be one of [${spec.enum.join(', ')}], got '${value}'${context}`);
      }

      // Check numeric bounds
      if (spec.type === 'number') {
        const num = value as number;
        if (spec.minimum !== undefined && num < spec.minimum) {
          warnings.push(`Field '${field}' must be >= ${spec.minimum}, got ${num}${context}`);
        }
        if (spec.maximum !== undefined && num > spec.maximum) {
          warnings.push(`Field '${field}' must be <= ${spec.maximum}, got ${num}${context}`);
        }
      }
    }
  }

  /**
   * Validate agents array
   */
  private static validateAgents(
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    const seenNames = new Set<string>();

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const prefix = `agents[${i}]`;

      if (!agent || typeof agent !== 'object') {
        errors.push(`${prefix} must be an object${context}`);
        continue;
      }

      const agentObj = agent as Record<string, unknown>;

      // Validate required agent fields
      if (!agentObj.name) {
        errors.push(`${prefix}: missing required field 'name'${context}`);
      } else if (typeof agentObj.name !== 'string') {
        errors.push(`${prefix}: 'name' must be a string${context}`);
      } else {
        // Check for duplicate names
        if (seenNames.has(agentObj.name)) {
          errors.push(`${prefix}: duplicate agent name '${agentObj.name}'${context}`);
        }
        seenNames.add(agentObj.name);
      }

      if (!agentObj.model) {
        errors.push(`${prefix}: missing required field 'model'${context}`);
      } else if (typeof agentObj.model !== 'string') {
        errors.push(`${prefix}: 'model' must be a string${context}`);
      } else if (!['opus', 'sonnet', 'haiku'].includes(agentObj.model)) {
        errors.push(`${prefix}: 'model' must be one of [opus, sonnet, haiku], got '${agentObj.model}'${context}`);
      }

      // Require at least one of prompt or command
      if (!agentObj.prompt && !agentObj.command) {
        errors.push(`${prefix}: must have at least one of 'prompt' or 'command'${context}`);
      }
      if (agentObj.prompt && typeof agentObj.prompt !== 'string') {
        errors.push(`${prefix}: 'prompt' must be a string${context}`);
      }
      if (agentObj.command && typeof agentObj.command !== 'string') {
        errors.push(`${prefix}: 'command' must be a string${context}`);
      }

      // Check for unknown agent fields
      this.checkUnknownFields(agentObj, AGENT_FIELD_SPECS, warnings, `${context} in ${prefix}`);
    }
  }

  /**
   * Validate entry_point matches an agent name
   */
  private static validateEntryPoint(
    entryPoint: string,
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    const agentNames = agents
      .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
      .map(a => a.name as string);

    if (!agentNames.includes(entryPoint)) {
      errors.push(`entry_point '${entryPoint}' not found in agents [${agentNames.join(', ')}]${context}`);
    }
  }

  /**
   * Validate completion_agent(s) - supports both singular and array formats
   * Array format takes precedence if both are specified
   */
  private static validateCompletionAgents(
    config: Record<string, unknown>,
    agents: unknown[],
    warnings: string[],
    context: string
  ): void {
    const agentNames = agents
      .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
      .map(a => a.name as string);

    // Array format (takes precedence)
    if (Array.isArray(config.completion_agents)) {
      for (const name of config.completion_agents) {
        if (!agentNames.includes(name as string)) {
          warnings.push(`completion_agents '${name}' not found in agents${context}`);
        }
      }
      if (config.completion_agent) {
        warnings.push(`Both completion_agent and completion_agents set - array takes precedence${context}`);
      }
      return;
    }

    // Singular format (backward compat)
    if (config.completion_agent && !agentNames.includes(config.completion_agent as string)) {
      warnings.push(`completion_agent '${config.completion_agent}' not found in agents${context}`);
    }
  }

  /**
   * Validate routing configuration
   */
  private static validateRouting(
    routing: unknown,
    agents: unknown[],
    warnings: string[],
    context: string
  ): void {
    if (typeof routing !== 'object' || routing === null) {
      warnings.push(`routing should be an object${context}`);
      return;
    }

    const agentNames = new Set(
      agents
        .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
        .map(a => a.name as string)
    );

    const routingObj = routing as Record<string, unknown>;

    for (const [agent, rules] of Object.entries(routingObj)) {
      if (!agentNames.has(agent)) {
        warnings.push(`routing references unknown agent '${agent}'${context}`);
      }

      if (typeof rules !== 'object' || rules === null) {
        warnings.push(`routing.${agent} should be an object${context}`);
        continue;
      }

      // Validate each routing rule has valid targets
      const rulesObj = rules as Record<string, unknown>;
      for (const [transition, targets] of Object.entries(rulesObj)) {
        if (typeof targets !== 'object' || targets === null) {
          warnings.push(`routing.${agent}.${transition} should be an object${context}`);
          continue;
        }

        const targetsObj = targets as Record<string, unknown>;
        for (const [target, desc] of Object.entries(targetsObj)) {
          // core is always a valid target
          if (target !== 'core' && !agentNames.has(target)) {
            warnings.push(`routing.${agent}.${transition} references unknown target '${target}'${context}`);
          }
          if (typeof desc !== 'string') {
            warnings.push(`routing.${agent}.${transition}.${target} description should be a string${context}`);
          }
        }
      }
    }
  }

  /**
   * Validate dispatcher-mode routing configuration
   *
   * Dispatcher routing uses flat agent → target mapping:
   * - String value = linear (auto-route to named agent)
   * - Object value = branch (outcome keys → target agents, optional 'default')
   * - Absent agent = terminal (dispatcher routes to core/core on completion)
   */
  private static validateDispatcherRouting(
    routing: unknown,
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    if (typeof routing !== 'object' || routing === null) {
      errors.push(`routing should be an object${context}`);
      return;
    }

    const agentNames = new Set(
      agents
        .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
        .map(a => a.name as string)
    );

    const routingObj = routing as Record<string, unknown>;

    // Track fan-out groups for join agent / discuss validation
    const fanOutGroups: Array<{
      source: string;
      agents: string[];
      options: FanOutOptions;
    }> = [];

    // Track fan-out member agents (they get implicit routing, so don't warn about missing entries)
    const fanOutMemberAgents = new Set<string>();

    for (const [agent, value] of Object.entries(routingObj)) {
      if (!agentNames.has(agent)) {
        warnings.push(`routing references unknown agent '${agent}'${context}`);
      }

      if (typeof value === 'string') {
        // Linear: value is the target agent name
        if (value !== 'core' && !agentNames.has(value)) {
          warnings.push(`routing.${agent}: target '${value}' not found in agents${context}`);
        }
      } else if (Array.isArray(value)) {
        // Fan-out: array of target agents + optional trailing options object
        const targetAgents: string[] = [];
        let options: FanOutOptions = {};

        for (const item of value) {
          if (typeof item === 'string') {
            targetAgents.push(item);
          } else if (typeof item === 'object' && item !== null) {
            options = item as FanOutOptions;
          } else {
            errors.push(`routing.${agent}: fan-out array items must be strings or a trailing options object${context}`);
          }
        }

        if (targetAgents.length < 2) {
          warnings.push(`routing.${agent}: fan-out array should have at least 2 target agents${context}`);
        }
        for (const target of targetAgents) {
          if (target !== 'core' && !agentNames.has(target)) {
            warnings.push(`routing.${agent}: fan-out target '${target}' not found in agents${context}`);
          }
          fanOutMemberAgents.add(target);
        }

        // Validate options
        if (options.complete && options.complete !== 'core' && !agentNames.has(options.complete)) {
          warnings.push(`routing.${agent}: fan-out complete target '${options.complete}' not found in agents${context}`);
        }
        if (!options.complete) {
          warnings.push(`routing.${agent}: fan-out has no 'complete' target — join gate will not activate${context}`);
        }

        // Validate fan_in mode
        if (options.fan_in && !['batch', 'queue', 'drain'].includes(options.fan_in)) {
          errors.push(`routing.${agent}: fan_in must be 'batch', 'queue', or 'drain', got '${options.fan_in}'${context}`);
        }
        // Validate transform
        if (options.transform && options.transform !== 'summarize') {
          errors.push(`routing.${agent}: transform must be 'summarize', got '${options.transform}'${context}`);
        }

        // Warn about discuss + no max_turns
        if (options.discuss) {
          const agentConfigs = agents as Array<Record<string, unknown>>;
          for (const target of targetAgents) {
            const agentCfg = agentConfigs.find(a => a.name === target);
            if (agentCfg && !agentCfg.max_turns) {
              warnings.push(`routing.${agent}: fan-out member '${target}' has discuss enabled but no max_turns — risk of runaway peer chat${context}`);
            }
          }
        }

        fanOutGroups.push({ source: agent, agents: targetAgents, options });
      } else if (typeof value === 'object' && value !== null) {
        // Branch: keys are outcome names, values are target agents
        const outcomes = value as Record<string, unknown>;
        for (const [outcome, target] of Object.entries(outcomes)) {
          if (typeof target !== 'string') {
            errors.push(`routing.${agent}.${outcome} must be a string (target agent name)${context}`);
          } else if (target !== 'core' && !agentNames.has(target)) {
            warnings.push(`routing.${agent}.${outcome}: target '${target}' not found in agents${context}`);
          }
        }
      } else {
        errors.push(`routing.${agent} must be a string (linear target), array (fan-out), or object (outcome map)${context}`);
      }
    }

    // Warn about agents with no routing entry (they become terminal)
    // Skip fan-out members — they get implicit routing from group options
    for (const agentName of agentNames) {
      if (!routingObj[agentName] && !fanOutMemberAgents.has(agentName)) {
        warnings.push(`Agent '${agentName}' has no dispatcher routing entry (will be treated as terminal)${context}`);
      }
    }
  }

  /**
   * Validate rearmatter configuration
   */
  private static validateRearmatter(
    rearmatter: unknown,
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    if (typeof rearmatter !== 'object' || rearmatter === null) {
      errors.push(`rearmatter must be an object${context}`);
      return;
    }

    const rm = rearmatter as Record<string, unknown>;

    // Validate enabled
    if (rm.enabled !== undefined && typeof rm.enabled !== 'boolean') {
      errors.push(`rearmatter.enabled must be a boolean${context}`);
    }

    // Validate fields - check structure only, allow arbitrary field names
    if (rm.fields !== undefined) {
      if (!Array.isArray(rm.fields)) {
        errors.push(`rearmatter.fields must be an array${context}`);
      } else {
        for (const field of rm.fields) {
          if (typeof field !== 'string') {
            errors.push(`rearmatter.fields contains non-string value: ${field}${context}`);
          }
          // No allowlist check - meshes can define domain-specific rearmatter fields
        }
      }
    }

    // Validate thresholds
    if (rm.thresholds !== undefined) {
      if (typeof rm.thresholds !== 'object' || rm.thresholds === null) {
        errors.push(`rearmatter.thresholds must be an object${context}`);
      } else {
        const th = rm.thresholds as Record<string, unknown>;

        if (th.confidence !== undefined) {
          if (typeof th.confidence !== 'number') {
            errors.push(`rearmatter.thresholds.confidence must be a number${context}`);
          } else if (th.confidence < 0 || th.confidence > 1) {
            errors.push(`rearmatter.thresholds.confidence must be between 0.0 and 1.0${context}`);
          }
        }

        if (th.grade !== undefined) {
          if (typeof th.grade !== 'string') {
            errors.push(`rearmatter.thresholds.grade must be a string${context}`);
          } else if (!VALID_GRADES.includes(th.grade.toUpperCase())) {
            errors.push(`rearmatter.thresholds.grade must be one of [${VALID_GRADES.join(', ')}]${context}`);
          }
        }

        // Check for unknown threshold fields
        for (const field of Object.keys(th)) {
          if (field !== 'confidence' && field !== 'grade') {
            warnings.push(`Unknown rearmatter.thresholds field '${field}'${context}`);
          }
        }
      }
    }

    // Check for unknown rearmatter fields
    const knownRearmatterFields = ['enabled', 'fields', 'thresholds'];
    for (const field of Object.keys(rm)) {
      if (!knownRearmatterFields.includes(field)) {
        warnings.push(`Unknown rearmatter field '${field}'${context}`);
      }
    }
  }

  /**
   * Validate FSM configuration (exit-based routing schema)
   * Schema: docs/mesh-fsm-config.md
   */
  private static validateFSM(
    fsm: unknown,
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    if (typeof fsm !== 'object' || fsm === null) {
      errors.push(`fsm must be an object${context}`);
      return;
    }

    const fsmObj = fsm as Record<string, unknown>;

    // Validate required fields
    if (!fsmObj.initial) {
      errors.push(`fsm.initial is required${context}`);
    } else if (typeof fsmObj.initial !== 'string') {
      errors.push(`fsm.initial must be a string${context}`);
    }

    if (!fsmObj.states) {
      errors.push(`fsm.states is required${context}`);
    } else if (typeof fsmObj.states !== 'object' || fsmObj.states === null) {
      errors.push(`fsm.states must be an object or array${context}`);
    } else if (Object.keys(fsmObj.states).length === 0) {
      errors.push(`fsm.states cannot be empty${context}`);
    }

    if (fsmObj.scripts && (typeof fsmObj.scripts !== 'object' || Array.isArray(fsmObj.scripts) || fsmObj.scripts === null)) {
      errors.push(`fsm.scripts must be an object${context}`);
    }

    // Get agent names for reference validation
    const agentNames = new Set(
      agents
        .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
        .map(a => a.name as string)
    );

    // Validate states (object/map, not array)
    const stateNames = new Set<string>();
    if (typeof fsmObj.states === 'object' && fsmObj.states !== null && !Array.isArray(fsmObj.states)) {
      const statesObj = fsmObj.states as Record<string, unknown>;

      for (const [stateName, stateValue] of Object.entries(statesObj)) {
        stateNames.add(stateName);
        const prefix = `fsm.states.${stateName}`;

        if (!stateValue || typeof stateValue !== 'object' || Array.isArray(stateValue)) {
          errors.push(`${prefix} must be an object${context}`);
          continue;
        }

        const state = stateValue as Record<string, unknown>;

        // Validate agents field (optional array)
        if (state.agents !== undefined) {
          if (!Array.isArray(state.agents)) {
            errors.push(`${prefix}.agents must be an array${context}`);
          } else {
            for (const agent of state.agents) {
              if (typeof agent !== 'string') {
                errors.push(`${prefix}.agents must contain strings${context}`);
              } else if (!agentNames.has(agent)) {
                warnings.push(`${prefix}.agents: '${agent}' not found in mesh agents${context}`);
              }
            }
          }
        }

        // Validate state type (optional, defaults to 'normal')
        // NOTE: state.type is DEPRECATED in favor of state.ensemble.type
        if (state.type !== undefined) {
          if (typeof state.type !== 'string') {
            errors.push(`${prefix}.type must be a string${context}`);
          } else if (!['normal', 'ensemble'].includes(state.type)) {
            errors.push(`${prefix}.type must be 'normal' or 'ensemble', got '${state.type}'${context}`);
          } else if (state.type === 'ensemble') {
            // Warn about deprecated pattern
            warnings.push(`${prefix}: 'type: ensemble' is deprecated. Use 'ensemble: { type: parallel }' instead${context}`);
          }
        }

        // Validate subtask flag (optional boolean) - DEPRECATED
        if (state.subtask !== undefined) {
          if (typeof state.subtask !== 'boolean') {
            errors.push(`${prefix}.subtask must be a boolean${context}`);
          } else {
            warnings.push(`${prefix}: 'subtask: true' is deprecated. Use explicit ensemble routing instead${context}`);
          }
        }

        // Validate ensemble configuration (new structure: ensemble.type === 'parallel')
        const hasLegacyEnsembleType = state.type === 'ensemble';
        const hasNewEnsembleConfig = state.ensemble !== undefined && typeof state.ensemble === 'object' && state.ensemble !== null && !Array.isArray(state.ensemble);

        // Check for type: ensemble without ensemble config (legacy error)
        if (hasLegacyEnsembleType && !state.ensemble) {
          errors.push(`${prefix}: type 'ensemble' requires 'ensemble' configuration${context}`);
        }

        if (state.ensemble !== undefined) {
          if (typeof state.ensemble !== 'object' || state.ensemble === null || Array.isArray(state.ensemble)) {
            errors.push(`${prefix}.ensemble must be an object${context}`);
          } else {
            const ensemble = state.ensemble as Record<string, unknown>;
            const ensemblePrefix = `${prefix}.ensemble`;

            // Validate ensemble.type (required for new config, optional for legacy)
            if (ensemble.type !== undefined) {
              if (ensemble.type !== 'parallel') {
                errors.push(`${ensemblePrefix}.type must be 'parallel', got '${ensemble.type}'${context}`);
              }
            } else if (!hasLegacyEnsembleType) {
              // New ensemble config without type field should have type: parallel
              warnings.push(`${ensemblePrefix}: missing 'type' field. Add 'type: parallel' for clarity${context}`);
            }

            // Validate that either agents array OR (agent + count) is provided, not both
            const hasAgents = ensemble.agents !== undefined;
            const hasAgentWithCount = ensemble.agent !== undefined;

            if (!hasAgents && !hasAgentWithCount) {
              errors.push(`${ensemblePrefix}: must specify either 'agents' array OR 'agent' with 'count'${context}`);
            } else if (hasAgents && hasAgentWithCount) {
              errors.push(`${ensemblePrefix}: cannot specify both 'agents' array AND 'agent' with 'count'${context}`);
            }

            // Validate agents array
            if (hasAgents) {
              if (!Array.isArray(ensemble.agents)) {
                errors.push(`${ensemblePrefix}.agents must be an array${context}`);
              } else {
                if (ensemble.agents.length === 0) {
                  errors.push(`${ensemblePrefix}.agents cannot be empty${context}`);
                }
                for (const agent of ensemble.agents) {
                  if (typeof agent !== 'string') {
                    errors.push(`${ensemblePrefix}.agents must contain strings${context}`);
                  } else if (!agentNames.has(agent)) {
                    warnings.push(`${ensemblePrefix}.agents: '${agent}' not found in mesh agents${context}`);
                  }
                }
              }
            }

            // Validate agent + count pattern
            if (hasAgentWithCount) {
              if (typeof ensemble.agent !== 'string') {
                errors.push(`${ensemblePrefix}.agent must be a string${context}`);
              } else if (!agentNames.has(ensemble.agent)) {
                warnings.push(`${ensemblePrefix}.agent: '${ensemble.agent}' not found in mesh agents${context}`);
              }

              // Count is required when using agent pattern
              if (ensemble.count === undefined) {
                errors.push(`${ensemblePrefix}: 'count' is required when using 'agent' pattern${context}`);
              } else {
                // Count can be number or string (variable reference like $parallelism)
                const countType = typeof ensemble.count;
                if (countType !== 'number' && countType !== 'string') {
                  errors.push(`${ensemblePrefix}.count must be a number or variable reference (string)${context}`);
                } else if (countType === 'number' && (ensemble.count as number) < 1) {
                  errors.push(`${ensemblePrefix}.count must be >= 1${context}`);
                } else if (countType === 'string' && !(ensemble.count as string).startsWith('$')) {
                  errors.push(`${ensemblePrefix}.count as string must be a variable reference (start with $)${context}`);
                }
              }
            }

            // Validate aggregation strategy (required)
            const validAggregations: AggregationStrategy[] = ['concat', 'deduplicate', 'voting', 'consensus', 'custom'];
            if (!ensemble.aggregation) {
              errors.push(`${ensemblePrefix}.aggregation is required${context}`);
            } else if (typeof ensemble.aggregation !== 'string') {
              errors.push(`${ensemblePrefix}.aggregation must be a string${context}`);
            } else if (!validAggregations.includes(ensemble.aggregation as AggregationStrategy)) {
              errors.push(`${ensemblePrefix}.aggregation must be one of [${validAggregations.join(', ')}], got '${ensemble.aggregation}'${context}`);
            }

            // Validate timeout_ms (optional)
            if (ensemble.timeout_ms !== undefined) {
              if (typeof ensemble.timeout_ms !== 'number') {
                errors.push(`${ensemblePrefix}.timeout_ms must be a number${context}`);
              } else if (ensemble.timeout_ms < 100 || ensemble.timeout_ms > 600000) {
                errors.push(`${ensemblePrefix}.timeout_ms must be between 100 and 600000${context}`);
              }
            }

            // Validate fault_tolerance (optional)
            if (ensemble.fault_tolerance !== undefined) {
              if (typeof ensemble.fault_tolerance !== 'object' || ensemble.fault_tolerance === null) {
                errors.push(`${ensemblePrefix}.fault_tolerance must be an object${context}`);
              } else {
                const ft = ensemble.fault_tolerance as Record<string, unknown>;

                if (ft.min_success_count !== undefined) {
                  if (typeof ft.min_success_count !== 'number') {
                    errors.push(`${ensemblePrefix}.fault_tolerance.min_success_count must be a number${context}`);
                  } else if (ft.min_success_count < 1) {
                    errors.push(`${ensemblePrefix}.fault_tolerance.min_success_count must be >= 1${context}`);
                  }
                }

                if (ft.retry_failed !== undefined && typeof ft.retry_failed !== 'boolean') {
                  errors.push(`${ensemblePrefix}.fault_tolerance.retry_failed must be a boolean${context}`);
                }

                // Check for unknown fault_tolerance fields
                const knownFTFields = ['min_success_count', 'retry_failed'];
                for (const field of Object.keys(ft)) {
                  if (!knownFTFields.includes(field)) {
                    warnings.push(`Unknown ${ensemblePrefix}.fault_tolerance field '${field}'${context}`);
                  }
                }
              }
            }

            // Check for unknown ensemble fields
            const knownEnsembleFields = ['type', 'agents', 'agent', 'count', 'aggregation', 'timeout_ms', 'fault_tolerance'];
            for (const field of Object.keys(ensemble)) {
              if (!knownEnsembleFields.includes(field)) {
                warnings.push(`Unknown ${ensemblePrefix} field '${field}'${context}`);
              }
            }
          }
        }

        // Validate exit block (optional, but critical for routing)
        if (state.exit !== undefined) {
          if (typeof state.exit !== 'object' || state.exit === null || Array.isArray(state.exit)) {
            errors.push(`${prefix}.exit must be an object${context}`);
          } else {
            const exit = state.exit as Record<string, unknown>;

            // Validate exit.when (array of condition/target pairs)
            if (exit.when !== undefined) {
              if (!Array.isArray(exit.when)) {
                errors.push(`${prefix}.exit.when must be an array${context}`);
              } else {
                for (let i = 0; i < exit.when.length; i++) {
                  const whenClause = exit.when[i];
                  if (typeof whenClause !== 'object' || whenClause === null) {
                    errors.push(`${prefix}.exit.when[${i}] must be an object${context}`);
                    continue;
                  }
                  const clause = whenClause as Record<string, unknown>;
                  if (!clause.condition) {
                    errors.push(`${prefix}.exit.when[${i}].condition is required${context}`);
                  }
                  if (!clause.target) {
                    errors.push(`${prefix}.exit.when[${i}].target is required${context}`);
                  } else if (typeof clause.target === 'string' && stateNames.size > 0) {
                    // Will validate target state exists after all states are processed
                  }
                }
              }
            }

            // Validate exit.default (fallback state name)
            if (exit.default !== undefined) {
              if (typeof exit.default !== 'string') {
                errors.push(`${prefix}.exit.default must be a string${context}`);
              }
            }
          }
        }
      }

      // Validate when clause targets and defaults reference valid states
      for (const [stateName, stateValue] of Object.entries(statesObj)) {
        if (!stateValue || typeof stateValue !== 'object') continue;
        const state = stateValue as Record<string, unknown>;
        const prefix = `fsm.states.${stateName}`;

        if (state.exit && typeof state.exit === 'object') {
          const exit = state.exit as Record<string, unknown>;

          if (Array.isArray(exit.when)) {
            for (let i = 0; i < exit.when.length; i++) {
              const clause = exit.when[i] as Record<string, unknown>;
              if (typeof clause.target === 'string' && !stateNames.has(clause.target)) {
                errors.push(`${prefix}.exit.when[${i}].target '${clause.target}' not found in states${context}`);
              }
            }
          }

          if (typeof exit.default === 'string' && !stateNames.has(exit.default)) {
            errors.push(`${prefix}.exit.default '${exit.default}' not found in states${context}`);
          }
        }
      }
    }

    // Validate initial references a valid state
    if (typeof fsmObj.initial === 'string' && stateNames.size > 0) {
      if (!stateNames.has(fsmObj.initial)) {
        errors.push(`fsm.initial '${fsmObj.initial}' not found in states${context}`);
      }
    }

    // Validate context if present
    if (fsmObj.context !== undefined) {
      if (typeof fsmObj.context !== 'object' || fsmObj.context === null || Array.isArray(fsmObj.context)) {
        errors.push(`fsm.context must be an object${context}`);
      }
    }

    // Validate context_descriptions if present
    if (fsmObj.context_descriptions !== undefined) {
      if (typeof fsmObj.context_descriptions !== 'object' || fsmObj.context_descriptions === null || Array.isArray(fsmObj.context_descriptions)) {
        errors.push(`fsm.context_descriptions must be an object${context}`);
      } else {
        // Validate all values are strings
        for (const [key, value] of Object.entries(fsmObj.context_descriptions)) {
          if (typeof value !== 'string') {
            errors.push(`fsm.context_descriptions.${key} must be a string${context}`);
          }
        }
      }
    }

    // Check for unknown fsm fields
    const knownFSMFields = ['initial', 'states', 'context', 'context_descriptions', 'scripts'];
    for (const field of Object.keys(fsmObj)) {
      if (!knownFSMFields.includes(field)) {
        warnings.push(`Unknown fsm field '${field}'${context}`);
      }
    }
  }

  /**
   * Validate file manifest against routing graph
   *
   * Cross-references declared manifest files with routing to verify
   * that readers have writers in their predecessor set.
   */
  static validateManifest(
    manifest: unknown,
    routing: unknown,
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string,
    workspaceConfig?: unknown,
    fsm?: unknown
  ): void {
    if (!Array.isArray(manifest)) {
      errors.push(`manifest must be an array${context}`);
      return;
    }

    const agentNames = new Set(
      agents
        .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
        .map(a => a.name as string)
    );

    // Extract known location names from workspace.locations
    const knownLocations = new Set<string>();
    if (workspaceConfig && typeof workspaceConfig === 'object') {
      const ws = workspaceConfig as Record<string, unknown>;
      if (ws.locations && typeof ws.locations === 'object' && !Array.isArray(ws.locations)) {
        for (const loc of Object.keys(ws.locations as Record<string, unknown>)) {
          knownLocations.add(loc);
        }
      }
    }

    // Structural validation: check each entry
    const seenIds = new Set<string>();

    for (let i = 0; i < manifest.length; i++) {
      const entry = manifest[i];
      const prefix = `manifest[${i}]`;

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`${prefix} must be an object${context}`);
        continue;
      }

      const file = entry as Record<string, unknown>;

      // Validate id
      if (!file.id || typeof file.id !== 'string') {
        errors.push(`${prefix}: missing required field 'id'${context}`);
        continue;
      }

      if (seenIds.has(file.id)) {
        errors.push(`${prefix}: duplicate manifest id '${file.id}'${context}`);
      }
      seenIds.add(file.id);

      // Validate description
      if (file.description !== undefined && typeof file.description !== 'string') {
        errors.push(`${prefix} '${file.id}': description must be a string${context}`);
      }

      // Validate persistent
      if (file.persistent !== undefined && typeof file.persistent !== 'boolean') {
        errors.push(`${prefix} '${file.id}': persistent must be a boolean${context}`);
      }

      // Validate autoInject
      if (file.autoInject !== undefined && typeof file.autoInject !== 'boolean') {
        errors.push(`${prefix} '${file.id}': autoInject must be a boolean${context}`);
      }

      // Validate location against workspace.locations
      if (file.location !== undefined) {
        if (typeof file.location !== 'string') {
          errors.push(`${prefix} '${file.id}': location must be a string${context}`);
        } else if (knownLocations.size > 0 && !knownLocations.has(file.location)) {
          warnings.push(`${prefix} '${file.id}': location '${file.location}' not defined in workspace.locations${context}`);
        }
      }

      // Validate reads/writes arrays
      const reads = Array.isArray(file.reads) ? file.reads as string[] : [];
      const writes = Array.isArray(file.writes) ? file.writes as string[] : [];

      // Check agent references
      for (const agent of reads) {
        if (typeof agent === 'string' && !agentNames.has(agent)) {
          errors.push(`${prefix}: reads references unknown agent '${agent}'${context}`);
        }
      }
      for (const agent of writes) {
        if (typeof agent === 'string' && !agentNames.has(agent)) {
          errors.push(`${prefix}: writes references unknown agent '${agent}'${context}`);
        }
      }

      // Check: file has readers but zero writers (persistent files may be pre-existing)
      if (reads.length > 0 && writes.length === 0 && file.persistent !== true) {
        errors.push(`${prefix} '${file.id}': has readers but no writers${context}`);
      }
    }

    // Ordering validation: build execution graph from routing + FSM transitions
    const hasFsm = fsm && typeof fsm === 'object' && !Array.isArray(fsm);
    const hasRouting = routing && typeof routing === 'object';
    if (!hasRouting && !hasFsm) return;

    // Build execution graph: extract directed edges (sender → target)
    const edges = new Map<string, Set<string>>(); // agent → set of successors

    // Add routing edges
    if (hasRouting) {
      const routingObj = routing as Record<string, unknown>;
      for (const [sender, rules] of Object.entries(routingObj)) {
        if (!rules || typeof rules !== 'object') continue;
        const rulesObj = rules as Record<string, unknown>;

        for (const [, targets] of Object.entries(rulesObj)) {
          if (!targets || typeof targets !== 'object') continue;
          const targetsObj = targets as Record<string, unknown>;

          for (const target of Object.keys(targetsObj)) {
            if (target === 'core') continue; // core is not a mesh agent
            if (!edges.has(sender)) edges.set(sender, new Set());
            edges.get(sender)!.add(target);
          }
        }
      }
    }

    // Add FSM state transition edges: source state agents → target state agents
    if (hasFsm) {
      const fsmObj = fsm as Record<string, unknown>;
      if (fsmObj.states && typeof fsmObj.states === 'object' && !Array.isArray(fsmObj.states)) {
        const statesObj = fsmObj.states as Record<string, unknown>;

        // Helper: get all agents for a state (normal + ensemble)
        const getStateAgents = (stateName: string): string[] => {
          const stateValue = statesObj[stateName];
          if (!stateValue || typeof stateValue !== 'object') return [];
          const state = stateValue as Record<string, unknown>;
          const result: string[] = [];
          if (Array.isArray(state.agents)) {
            for (const a of state.agents) {
              if (typeof a === 'string') result.push(a);
            }
          }
          if (state.ensemble && typeof state.ensemble === 'object') {
            const ens = state.ensemble as Record<string, unknown>;
            if (Array.isArray(ens.agents)) {
              for (const a of ens.agents) {
                if (typeof a === 'string') result.push(a);
              }
            }
            if (typeof ens.agent === 'string') result.push(ens.agent);
          }
          return result;
        };

        for (const [stateName, stateValue] of Object.entries(statesObj)) {
          if (!stateValue || typeof stateValue !== 'object') continue;
          const state = stateValue as Record<string, unknown>;
          const sourceAgents = getStateAgents(stateName);
          if (sourceAgents.length === 0) continue;

          // Collect target state names from exit.default and exit.when[].target
          const targetStates = new Set<string>();
          if (state.exit && typeof state.exit === 'object') {
            const exit = state.exit as Record<string, unknown>;
            if (typeof exit.default === 'string') targetStates.add(exit.default);
            if (Array.isArray(exit.when)) {
              for (const clause of exit.when) {
                if (clause && typeof clause === 'object') {
                  const target = (clause as Record<string, unknown>).target;
                  if (typeof target === 'string') targetStates.add(target);
                }
              }
            }
          }

          // Add edges: each source agent → each target state agent
          for (const targetStateName of targetStates) {
            const targetAgents = getStateAgents(targetStateName);
            for (const src of sourceAgents) {
              for (const tgt of targetAgents) {
                if (src === tgt) continue;
                if (!edges.has(src)) edges.set(src, new Set());
                edges.get(src)!.add(tgt);
              }
            }
          }
        }
      }
    }

    // Build reverse edge map for BFS predecessor computation
    const reverseEdges = new Map<string, Set<string>>();
    for (const [src, targets] of edges) {
      for (const tgt of targets) {
        if (!reverseEdges.has(tgt)) reverseEdges.set(tgt, new Set());
        reverseEdges.get(tgt)!.add(src);
      }
    }

    // BFS predecessors per agent (handles cycles correctly)
    const predecessors = new Map<string, Set<string>>();
    for (const name of agentNames) {
      const preds = new Set<string>();
      const queue = [...(reverseEdges.get(name) || [])];
      while (queue.length > 0) {
        const pred = queue.shift()!;
        if (preds.has(pred)) continue;
        preds.add(pred);
        for (const grandpred of reverseEdges.get(pred) || []) {
          if (!preds.has(grandpred)) queue.push(grandpred);
        }
      }
      predecessors.set(name, preds);
    }

    // Validate each manifest file: reader must have a writer predecessor
    for (const entry of manifest) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const file = entry as Record<string, unknown>;
      if (!file.id || typeof file.id !== 'string') continue;

      // Persistent files skip ordering checks (available across turns)
      if (file.persistent === true) continue;

      const reads = Array.isArray(file.reads) ? file.reads as string[] : [];
      const writes = Array.isArray(file.writes) ? file.writes as string[] : [];
      const writerSet = new Set(writes);

      for (const reader of reads) {
        if (typeof reader !== 'string') continue;

        // Self-read-after-write is valid
        if (writerSet.has(reader)) continue;

        // Check if any writer is a predecessor of this reader
        const readerPreds = predecessors.get(reader) || new Set();
        const hasWriterPredecessor = writes.some(
          w => typeof w === 'string' && readerPreds.has(w)
        );

        if (!hasWriterPredecessor) {
          warnings.push(
            `manifest '${file.id}': reader '${reader}' has no writer predecessor in routing${context}`
          );
        }
      }
    }
  }

  /**
   * Validate feature compatibility
   *
   * Detects incompatible feature combinations that cause runtime issues:
   * - continuation + fork_from: continuation keeps sessions alive, preventing
   *   checkpoint isolation needed by fork_from
   */
  private static validateFeatureCompatibility(
    config: Record<string, unknown>,
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    // continuation + fork_from checkpoint chain = incompatible
    // Checkpoints need isolated session snapshots. Continuation reuses live sessions,
    // preventing checkpoint saves. Result: fork_from finds no checkpoint to fork from.
    const hasContinuation = config.continuation === true ||
      (Array.isArray(config.continuation) && config.continuation.length > 0);

    if (hasContinuation && Array.isArray(config.agents)) {
      const hasForkFrom = config.agents.some((agent: unknown) => {
        if (!agent || typeof agent !== 'object') return false;
        return (agent as Record<string, unknown>).fork_from !== undefined;
      });

      if (hasForkFrom) {
        errors.push(
          `Incompatible features: 'continuation' and 'fork_from' cannot be used together${context}. ` +
          `Continuation reuses live sessions, preventing checkpoint isolation needed by fork_from. ` +
          `Set 'continuation: false' to enable checkpoint chain.`
        );
      }
    }
  }

  /**
   * Check for unknown fields
   */
  private static checkUnknownFields(
    obj: Record<string, unknown>,
    knownFields: Record<string, FieldSpec>,
    warnings: string[],
    context: string
  ): void {
    for (const field of Object.keys(obj)) {
      if (!knownFields[field]) {
        warnings.push(`Unknown field '${field}' (may be typo or unused)${context}`);
      }
    }
  }

  /**
   * Get the type of a value
   */
  private static getType(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }

  /**
   * Validate all mesh configs in a directory
   *
   * @param configs - Map of mesh name to config object
   * @returns Combined validation result
   */
  static validateAll(configs: Map<string, unknown>, options?: { silent?: boolean }): {
    valid: boolean;
    results: Map<string, ValidationResult>;
    totalErrors: number;
    totalWarnings: number;
  } {
    const results = new Map<string, ValidationResult>();
    let totalErrors = 0;
    let totalWarnings = 0;
    const silent = options?.silent ?? false;

    for (const [name, config] of configs) {
      const result = this.validate(config, `${name}.json`);
      results.set(name, result);
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;

      if (!silent) {
        if (result.errors.length > 0) {
          log.error('mesh-validator', `Mesh '${name}' has errors`, { errors: result.errors });
        }
        if (result.warnings.length > 0) {
          log.warn('mesh-validator', `Mesh '${name}' has warnings`, { warnings: result.warnings });
        }
      }
    }

    return {
      valid: totalErrors === 0,
      results,
      totalErrors,
      totalWarnings
    };
  }

  /**
   * Validate top-level mesh ensemble configuration (EnsembleConfig)
   * This is the mesh-level coordinator ensemble (not FSM state-level ensemble).
   */
  private static validateMeshEnsemble(
    config: unknown,
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    if (!config || typeof config !== 'object') {
      errors.push(`Invalid ensemble config${context}: must be an object`);
      return;
    }

    const ensemble = config as Record<string, unknown>;
    const agentNames = new Set((agents as Record<string, unknown>[]).map(a => a.name as string));
    const prefix = 'ensemble';

    // Validate agents array (required)
    if (!ensemble.agents) {
      errors.push(`${prefix}.agents is required${context}`);
    } else if (!Array.isArray(ensemble.agents) || ensemble.agents.length === 0) {
      errors.push(`${prefix}.agents must be a non-empty array${context}`);
    } else {
      for (const agent of ensemble.agents as string[]) {
        if (!agentNames.has(agent)) {
          errors.push(`${prefix}.agents: '${agent}' not found in mesh agents${context}`);
        }
      }
    }

    // Validate aggregation_strategy (required)
    const validStrategies = ['concat', 'deduplicate', 'voting', 'consensus', 'custom'];
    if (!ensemble.aggregation_strategy) {
      errors.push(`${prefix}.aggregation_strategy is required${context}`);
    } else if (!validStrategies.includes(ensemble.aggregation_strategy as string)) {
      errors.push(`${prefix}.aggregation_strategy must be one of [${validStrategies.join(', ')}], got '${ensemble.aggregation_strategy}'${context}`);
    }

    // custom strategy requires aggregation_prompt
    if (ensemble.aggregation_strategy === 'custom' && !ensemble.aggregation_prompt) {
      errors.push(`${prefix}: custom aggregation_strategy requires 'aggregation_prompt'${context}`);
    }

    // Validate timeout_ms (optional)
    if (ensemble.timeout_ms !== undefined) {
      if (typeof ensemble.timeout_ms !== 'number' || ensemble.timeout_ms < 100 || ensemble.timeout_ms > 600000) {
        errors.push(`${prefix}.timeout_ms must be a number between 100 and 600000${context}`);
      }
    }

    // Validate fault_tolerance (optional)
    if (ensemble.fault_tolerance !== undefined) {
      if (typeof ensemble.fault_tolerance !== 'object' || ensemble.fault_tolerance === null) {
        errors.push(`${prefix}.fault_tolerance must be an object${context}`);
      } else {
        const ft = ensemble.fault_tolerance as Record<string, unknown>;
        if (ft.min_success_count !== undefined) {
          if (typeof ft.min_success_count !== 'number' || ft.min_success_count < 1) {
            errors.push(`${prefix}.fault_tolerance.min_success_count must be a number >= 1${context}`);
          } else if (Array.isArray(ensemble.agents) && ft.min_success_count > ensemble.agents.length) {
            errors.push(`${prefix}.fault_tolerance.min_success_count (${ft.min_success_count}) exceeds agent count (${ensemble.agents.length})${context}`);
          }
        }
      }
    }
  }

  /**
   * Validate task distribution configuration
   */
  private static validateTaskDistribution(
    config: unknown,
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    if (!config || typeof config !== 'object') {
      errors.push(`Invalid task_distribution config${context}: must be a JSON object`);
      return;
    }

    const distribution = config as Record<string, unknown>;
    const agentNames = (agents as Record<string, unknown>[]).map(a => a.name);

    // Validate spawner exists
    if (!distribution.spawner || typeof distribution.spawner !== 'string') {
      errors.push(`Task distribution config${context}: 'spawner' is required and must be a string`);
      return;
    }

    if (!agentNames.includes(distribution.spawner as string)) {
      errors.push(`Task distribution spawner '${distribution.spawner}' not found in mesh agents${context}`);
    }

    // Validate reviewer exists
    if (!distribution.reviewer || typeof distribution.reviewer !== 'string') {
      errors.push(`Task distribution config${context}: 'reviewer' is required and must be a string`);
      return;
    }

    if (!agentNames.includes(distribution.reviewer as string)) {
      errors.push(`Task distribution reviewer '${distribution.reviewer}' not found in mesh agents${context}`);
    }

    // Validate subagents array
    if (!distribution.subagents || !Array.isArray(distribution.subagents) || distribution.subagents.length === 0) {
      errors.push(`Task distribution config${context}: 'subagents' must be a non-empty array`);
      return;
    }

    // Validate all subagents exist
    for (const agent of distribution.subagents as string[]) {
      if (!agentNames.includes(agent)) {
        errors.push(`Task distribution subagent '${agent}' not found in mesh agents${context}`);
      }
    }

    // Validate distribution_strategy
    const validStrategies = ['equal', 'weighted', 'adaptive', 'custom'];
    if (!distribution.distribution_strategy || !validStrategies.includes(distribution.distribution_strategy as string)) {
      errors.push(`Task distribution config${context}: 'distribution_strategy' must be one of: ${validStrategies.join(', ')}`);
    }

    // For custom strategy, distribution_prompt must be provided
    if (distribution.distribution_strategy === 'custom' && !distribution.distribution_prompt) {
      errors.push(`Task distribution config${context}: custom distribution strategy requires 'distribution_prompt'`);
    }

    // Validate subtask_count if present
    if (distribution.subtask_count !== undefined) {
      const count = distribution.subtask_count as number;
      if (typeof count !== 'number' || count < 1) {
        errors.push(`Task distribution config${context}: 'subtask_count' must be >= 1`);
      }
    }

    // Validate timeout_ms if present
    if (distribution.timeout_ms !== undefined) {
      const timeout = distribution.timeout_ms as number;
      if (typeof timeout !== 'number' || timeout < 100 || timeout > 600000) {
        errors.push(`Task distribution config${context}: 'timeout_ms' must be between 100 and 600000`);
      }
    }

    // Validate allow_partial_failure if present
    if (distribution.allow_partial_failure !== undefined && typeof distribution.allow_partial_failure !== 'boolean') {
      errors.push(`Task distribution config${context}: 'allow_partial_failure' must be a boolean`);
    }
  }

  /**
   * Validate routing configuration for multi-agent meshes
   *
   * Multi-agent meshes should have routing configuration to define message flow.
   * Without routing, agents don't know where to send their messages.
   *
   * Note: Ensemble agents are excluded from warnings since their output is
   * collected by EnsembleCoordinator, not routed via messages.
   */
  private static validateMultiAgentRouting(
    config: Record<string, unknown>,
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    const agents = config.agents as unknown[];
    const routing = config.routing as Record<string, unknown> | undefined;
    const fsm = config.fsm as Record<string, unknown> | undefined;
    const ensemble = config.ensemble as Record<string, unknown> | undefined;

    // Top-level ensemble configs don't need routing - EnsembleCoordinator handles output
    // Check if this is a pure ensemble mesh (all agents are in the ensemble)
    if (ensemble && !routing) {
      const ensembleAgentList = ensemble.agents as string[] | undefined;
      if (Array.isArray(ensembleAgentList)) {
        const agentNames = (agents as Array<Record<string, unknown>>)
          .filter(a => a !== null && typeof a === 'object')
          .map(a => a.name as string);

        // If all agents are in the ensemble, routing is not required
        const allInEnsemble = agentNames.every(name => ensembleAgentList.includes(name));
        if (allInEnsemble) {
          // Pure ensemble mesh - no routing needed
          return;
        }
      }
    }

    // Multi-agent mesh without any routing is an error
    if (!routing) {
      errors.push(`Multi-agent mesh missing routing configuration${context}`);
      return;
    }

    // Collect ensemble agents (they don't need routing)
    const ensembleAgents = new Set<string>();
    if (fsm && typeof fsm.states === 'object' && fsm.states !== null) {
      const statesObj = fsm.states as Record<string, unknown>;
      for (const [, stateValue] of Object.entries(statesObj)) {
        if (!stateValue || typeof stateValue !== 'object') continue;
        const state = stateValue as Record<string, unknown>;

        // Check for ensemble state (both legacy state.type === 'ensemble' and new state.ensemble.type === 'parallel')
        const isLegacyEnsemble = state.type === 'ensemble';
        const isNewEnsemble = state.ensemble !== undefined &&
          typeof state.ensemble === 'object' &&
          state.ensemble !== null &&
          (state.ensemble as Record<string, unknown>).type === 'parallel';

        if ((isLegacyEnsemble || isNewEnsemble) && state.ensemble) {
          const ensemble = state.ensemble as Record<string, unknown>;
          if (Array.isArray(ensemble.agents)) {
            for (const agent of ensemble.agents) {
              if (typeof agent === 'string') ensembleAgents.add(agent);
            }
          }
          if (typeof ensemble.agent === 'string') {
            ensembleAgents.add(ensemble.agent);
          }
        }
      }
    }

    // Get agent names
    const agentNames = agents
      .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
      .map(a => a.name as string);

    // Check each agent has routing (warning only - some patterns like ensemble don't need it)
    for (const agentName of agentNames) {
      if (!routing[agentName]) {
        // Skip ensemble agents - they don't need explicit routing
        if (ensembleAgents.has(agentName)) continue;

        warnings.push(`Agent '${agentName}' has no routing configuration${context}`);
      }
    }
  }

  /**
   * Validate FSM state agent routing
   *
   * Ensures agents referenced in FSM states have appropriate routing:
   * - Ensemble state agents: Do NOT need routing (handled by EnsembleCoordinator)
   * - Normal state agents: SHOULD have routing to define message destinations
   *
   * FSM handles state transitions, but routing handles message destinations.
   * These are complementary: FSM says "go to synthesize state", routing says
   * "send task-complete to core/core".
   */
  private static validateFSMStateRouting(
    fsm: unknown,
    routing: unknown,
    agents: unknown[],
    errors: string[],
    warnings: string[],
    context: string
  ): void {
    if (typeof fsm !== 'object' || fsm === null) return;
    if (typeof routing !== 'object' || routing === null) return;

    const fsmObj = fsm as Record<string, unknown>;
    const routingObj = routing as Record<string, unknown>;

    if (!fsmObj.states || typeof fsmObj.states !== 'object') return;

    const statesObj = fsmObj.states as Record<string, unknown>;

    // Collect agents by state type
    const ensembleAgents = new Set<string>();
    const normalStateAgents = new Set<string>();

    for (const [stateName, stateValue] of Object.entries(statesObj)) {
      if (!stateValue || typeof stateValue !== 'object') continue;
      const state = stateValue as Record<string, unknown>;

      // Check if this is an ensemble state (both legacy and new structure)
      const isLegacyEnsembleState = state.type === 'ensemble';
      const isNewEnsembleState = state.ensemble !== undefined &&
        typeof state.ensemble === 'object' &&
        state.ensemble !== null &&
        (state.ensemble as Record<string, unknown>).type === 'parallel';
      const isEnsembleState = isLegacyEnsembleState || isNewEnsembleState;

      if (isEnsembleState && state.ensemble) {
        // Collect ensemble agents - they don't need routing
        const ensemble = state.ensemble as Record<string, unknown>;
        if (Array.isArray(ensemble.agents)) {
          for (const agent of ensemble.agents) {
            if (typeof agent === 'string') {
              ensembleAgents.add(agent);
            }
          }
        }
        if (typeof ensemble.agent === 'string') {
          ensembleAgents.add(ensemble.agent);
        }
      } else {
        // Normal state - collect agents that should have routing
        if (Array.isArray(state.agents)) {
          for (const agent of state.agents) {
            if (typeof agent === 'string') {
              normalStateAgents.add(agent);
            }
          }
        }
      }
    }

    // Validate normal state agents have routing
    for (const agentName of normalStateAgents) {
      // Skip if agent is also used in ensemble state (ensemble takes precedence)
      if (ensembleAgents.has(agentName)) continue;

      if (!routingObj[agentName]) {
        // Normal state agents should have routing to define where their messages go
        warnings.push(
          `FSM state uses agent '${agentName}' but agent has no routing configuration${context}. ` +
          `Normal state agents should have routing to define message destinations.`
        );
      }
    }

    // Validate ensemble agents have routing (recommended for new ensemble.type: parallel config)
    // Ensemble agents should have routing to define where their completion messages go
    for (const agentName of ensembleAgents) {
      if (!routingObj[agentName]) {
        warnings.push(
          `Ensemble agent '${agentName}' should have routing configuration${context}. ` +
          `Add routing for ensemble agents to define completion message destinations.`
        );
      }
    }
  }
}

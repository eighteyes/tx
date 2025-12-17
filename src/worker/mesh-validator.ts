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

import type { SemanticModel } from '../shared/types.ts';
import { log } from '../shared/logger.ts';

/**
 * Agent configuration within a mesh
 */
export interface MeshAgentConfig {
  name: string;
  model: SemanticModel;
  prompt: string;  // Path to prompt file relative to workDir
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
  type?: 'persistent' | 'ephemeral';
  auto_despawn?: boolean;
  keepalive?: boolean;
  grace_period_ms?: number;
  topology?: 'static' | 'dynamic';
  routing?: MeshRouting;
  rearmatter?: RearmatterConfig;
  workspace?: WorkspaceConfigSchema;
  brain?: boolean;
  capabilities?: string[];
  frontmatter?: Record<string, unknown>;
  'clear-before'?: boolean;
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
  type: 'string' | 'boolean' | 'number' | 'array' | 'object';
  required?: boolean;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

/**
 * Valid rearmatter fields
 */
const VALID_REARMATTER_FIELDS = ['grade', 'confidence', 'speculation', 'gaps', 'assumptions'];

/**
 * Valid grade values
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
  completion_agent: { type: 'string' },
  type: { type: 'string', enum: ['persistent', 'ephemeral'] },
  auto_despawn: { type: 'boolean' },
  keepalive: { type: 'boolean' },
  grace_period_ms: { type: 'number', minimum: 0, maximum: 60000 },
  topology: { type: 'string', enum: ['static', 'dynamic'] },
  routing: { type: 'object' },
  rearmatter: { type: 'object' },
  workspace: { type: 'object' },
  brain: { type: 'boolean' },
  capabilities: { type: 'array' },
  frontmatter: { type: 'object' },
  'clear-before': { type: 'boolean' }
};

/**
 * Known agent config fields
 */
const AGENT_FIELD_SPECS: Record<string, FieldSpec> = {
  name: { type: 'string', required: true },
  model: { type: 'string', required: true, enum: ['opus', 'sonnet', 'haiku'] },
  prompt: { type: 'string', required: true },
  workspace: { type: 'object' }
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

    // Validate entry_point if present
    if (cfg.entry_point && Array.isArray(cfg.agents)) {
      this.validateEntryPoint(cfg.entry_point as string, cfg.agents, errors, warnings, context);
    } else if (!cfg.entry_point) {
      warnings.push(`No entry_point specified${context}, will use first agent`);
    }

    // Validate completion_agent if present
    if (cfg.completion_agent && Array.isArray(cfg.agents)) {
      this.validateCompletionAgent(cfg.completion_agent as string, cfg.agents, warnings, context);
    }

    // Validate routing if present
    if (cfg.routing && Array.isArray(cfg.agents)) {
      this.validateRouting(cfg.routing, cfg.agents, warnings, context);
    }

    // Validate rearmatter if present
    if (cfg.rearmatter) {
      this.validateRearmatter(cfg.rearmatter, errors, warnings, context);
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
      if (spec.type !== actualType) {
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

      if (!agentObj.prompt) {
        errors.push(`${prefix}: missing required field 'prompt'${context}`);
      } else if (typeof agentObj.prompt !== 'string') {
        errors.push(`${prefix}: 'prompt' must be a string${context}`);
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
   * Validate completion_agent matches an agent name
   */
  private static validateCompletionAgent(
    completionAgent: string,
    agents: unknown[],
    warnings: string[],
    context: string
  ): void {
    const agentNames = agents
      .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
      .map(a => a.name as string);

    if (!agentNames.includes(completionAgent)) {
      warnings.push(`completion_agent '${completionAgent}' not found in agents${context}`);
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

    // Validate fields
    if (rm.fields !== undefined) {
      if (!Array.isArray(rm.fields)) {
        errors.push(`rearmatter.fields must be an array${context}`);
      } else {
        for (const field of rm.fields) {
          if (typeof field !== 'string') {
            errors.push(`rearmatter.fields contains non-string value: ${field}${context}`);
          } else if (!VALID_REARMATTER_FIELDS.includes(field)) {
            warnings.push(`Unknown rearmatter field '${field}' (valid: ${VALID_REARMATTER_FIELDS.join(', ')})${context}`);
          }
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
  static validateAll(configs: Map<string, unknown>): {
    valid: boolean;
    results: Map<string, ValidationResult>;
    totalErrors: number;
    totalWarnings: number;
  } {
    const results = new Map<string, ValidationResult>();
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const [name, config] of configs) {
      const result = this.validate(config, `${name}.json`);
      results.set(name, result);
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;

      // Log validation results
      if (result.errors.length > 0) {
        log.error('mesh-validator', `Mesh '${name}' has errors`, { errors: result.errors });
      }
      if (result.warnings.length > 0) {
        log.warn('mesh-validator', `Mesh '${name}' has warnings`, { warnings: result.warnings });
      }
    }

    return {
      valid: totalErrors === 0,
      results,
      totalErrors,
      totalWarnings
    };
  }
}

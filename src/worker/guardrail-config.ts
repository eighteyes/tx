/**
 * GuardrailConfig - Unified guardrail threshold resolution
 *
 * Responsibilities:
 * - Load .ai/tx/data/config.yaml global guardrails
 * - Accept mesh-local guardrails from mesh config.yaml
 * - Resolve thresholds with mesh-local winning over global
 * - Override chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { log } from '../shared/logger.ts';
import type { MeshGuardrailConfig } from '../mesh/config-loader.ts';

export interface GuardrailMode {
  strict: boolean;
  warning: boolean;
}

interface GateOverride {
  strict?: boolean;
  warning?: boolean;
  kill_threshold?: number | null;
  allowed_paths?: string[];  // Additional paths allowed (bash_guard only)
}

interface RoutingErrorOverride {
  strict?: boolean;
  warning?: boolean;
  max_retries?: number;
  routing_retry_max?: number | null;
  routing_fallback?: string | null;
}

interface MaxMessagesOverride {
  strict?: boolean;
  warning?: boolean;
  limit?: number | null;
}

interface MaxMeshMessagesOverride {
  strict?: boolean;
  warning?: boolean;
  limit?: number | null;
}

interface MaxInvocationsOverride {
  strict?: boolean;
  warning?: boolean;
  limit?: number | null;
}

interface MaxTurnsOverride {
  strict?: boolean;
  warning?: boolean;
  limit?: number | null;
}

interface DuplicateTargetOverride {
  strict?: boolean;
  warning?: boolean;
}

interface MaxInstancesOverride {
  strict?: boolean;
  warning?: boolean;
  limit?: number | null;
}

interface PostconditionOverride {
  strict?: boolean;
  warning?: boolean;
}

interface AgentOverrides {
  write_gate?: GateOverride;
  read_gate?: GateOverride;
  identity_gate?: GateOverride;
  bash_guard?: GateOverride;
  routing_error?: RoutingErrorOverride;
  max_messages?: MaxMessagesOverride | number | null;
  max_turns?: MaxTurnsOverride | number | null;
  duplicate_target?: DuplicateTargetOverride;
  postcondition?: PostconditionOverride;
  max_invocations?: MaxInvocationsOverride | number | null;
}

interface MeshOverrides extends AgentOverrides {
  agents?: Record<string, AgentOverrides>;
  max_mesh_messages?: MaxMeshMessagesOverride | number | null;
  max_instances?: MaxInstancesOverride | number | null;
}

interface GuardrailsSchema {
  write_gate?: GateOverride;
  read_gate?: GateOverride;
  identity_gate?: GateOverride;
  bash_guard?: GateOverride;
  routing_error?: RoutingErrorOverride;
  max_messages?: MaxMessagesOverride | number | null;
  max_turns?: MaxTurnsOverride | number | null;
  max_mesh_messages?: MaxMeshMessagesOverride | number | null;
  max_instances?: MaxInstancesOverride | number | null;
  duplicate_target?: DuplicateTargetOverride;
  postcondition?: PostconditionOverride;
  max_invocations?: MaxInvocationsOverride | number | null;
  meshes?: Record<string, MeshOverrides>;
}

interface NudgeConfigYaml {
  enabled?: boolean;
  delay_ms?: number;
  max_nudges_per_agent?: number;
}

interface TxConfig {
  guardrails?: GuardrailsSchema;
  nudge?: NudgeConfigYaml;
}

const DEFAULT_MODE: GuardrailMode = { strict: false, warning: true };

/** Per-guardrail default modes — override DEFAULT_MODE where needed */
const GUARDRAIL_DEFAULT_MODES: Record<string, GuardrailMode> = {
  bash_guard:       { strict: false, warning: false },  // Disabled — re-enable via config.yaml if needed
  identity_gate:    { strict: false, warning: true },   // Warn on identity mismatch
  write_gate:       { strict: false, warning: true },   // Warn on path violations
  read_gate:        { strict: false, warning: true },   // Warn on path violations
  routing_error:    { strict: false, warning: true },   // Warn on routing failures
  max_messages:     { strict: true,  warning: true },   // Kill on message limit
  max_turns:        { strict: false, warning: true },   // Warn on turn limit (SDK handles hard limit)
  max_mesh_messages:{ strict: false, warning: true },   // Warn on mesh message limit
  duplicate_target: { strict: false, warning: true },   // Warn on duplicate routing
  postcondition:    { strict: false, warning: true },   // Warn on postcondition failure
  max_invocations:  { strict: true,  warning: true },   // Kill on invocation limit
};

const DEFAULTS = {
  write_gate: { kill_threshold: null as number | null },
  read_gate: { kill_threshold: null as number | null },
  identity_gate: { kill_threshold: null as number | null },
  bash_guard: { kill_threshold: 3 as number | null },
  routing_error: { max_retries: 3, routing_retry_max: null as number | null, routing_fallback: null as string | null },
  max_messages: null as number | null,
  max_turns: null as number | null,
  max_mesh_messages: null as number | null,
  max_instances: null as number | null,
  max_invocations: null as number | null,
};

export class GuardrailConfig {
  private config: TxConfig;
  private meshLocal: Map<string, MeshGuardrailConfig> = new Map();

  constructor(workDir: string) {
    const configPath = path.join(workDir, '.ai', 'tx', 'data', 'config.yaml');
    this.config = {};
    if (fs.existsSync(configPath)) {
      try {
        this.config = YAML.parse(fs.readFileSync(configPath, 'utf-8')) || {};
        log.debug('guardrail-config', 'Loaded config', { path: configPath });
      } catch (err) {
        log.warn('guardrail-config', 'Failed to parse config.yaml', { error: String(err) });
      }
    }
  }

  /**
   * Register mesh-local guardrail overrides from mesh config.yaml.
   * Call once per mesh load.
   */
  registerMesh(meshName: string, guardrails: MeshGuardrailConfig): void {
    this.meshLocal.set(meshName, guardrails);
    log.debug('guardrail-config', 'Registered mesh-local guardrails', { meshName });
  }

  /**
   * Resolve kill_threshold for a gate.
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default.
   */
  getKillThreshold(
    gate: 'write_gate' | 'read_gate' | 'identity_gate' | 'bash_guard',
    meshName: string,
    agentName: string,
  ): number | null {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    // Mesh-local agent
    const localAgent = local?.agents?.[agentName]?.[gate]?.kill_threshold;
    if (localAgent !== undefined) return localAgent;

    // Mesh-local mesh
    const localMesh = local?.[gate]?.kill_threshold;
    if (localMesh !== undefined) return localMesh;

    // Global agent
    const globalAgent = g?.meshes?.[meshName]?.agents?.[agentName]?.[gate]?.kill_threshold;
    if (globalAgent !== undefined) return globalAgent;

    // Global mesh
    const globalMesh = g?.meshes?.[meshName]?.[gate]?.kill_threshold;
    if (globalMesh !== undefined) return globalMesh;

    // Global
    const globalVal = g?.[gate]?.kill_threshold;
    if (globalVal !== undefined) return globalVal;

    return DEFAULTS[gate].kill_threshold;
  }

  /**
   * Resolve routing error max retries.
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default (3).
   */
  getRoutingMaxRetries(meshName: string, agentName: string): number {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    const localAgent = local?.agents?.[agentName]?.routing_error?.max_retries;
    if (localAgent !== undefined) return localAgent;

    const localMesh = local?.routing_error?.max_retries;
    if (localMesh !== undefined) return localMesh;

    const globalAgent = g?.meshes?.[meshName]?.agents?.[agentName]?.routing_error?.max_retries;
    if (globalAgent !== undefined) return globalAgent;

    const globalMesh = g?.meshes?.[meshName]?.routing_error?.max_retries;
    if (globalMesh !== undefined) return globalMesh;

    const globalVal = g?.routing_error?.max_retries;
    if (globalVal !== undefined) return globalVal;

    return DEFAULTS.routing_error.max_retries;
  }

  /**
   * Extract numeric limit from union type (number | null | {limit, strict, warning}).
   */
  private extractLimit(value: MaxMessagesOverride | MaxTurnsOverride | MaxMeshMessagesOverride | MaxInvocationsOverride | number | null | undefined): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value === 'number') return value;
    // Object form: { strict, warning, limit }
    // limit absent (undefined) → continue chain
    // limit: null → explicit "no limit" (stop chain)
    // limit: <number> → set limit (stop chain)
    if (value.limit === undefined) return undefined;
    return value.limit;
  }

  /**
   * Resolve max_messages limit.
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default (null).
   */
  getMaxMessages(meshName: string, agentName: string): number | null {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    const localAgent = this.extractLimit(local?.agents?.[agentName]?.max_messages);
    if (localAgent !== undefined) return localAgent;

    const localMesh = this.extractLimit(local?.max_messages);
    if (localMesh !== undefined) return localMesh;

    const globalAgent = this.extractLimit(g?.meshes?.[meshName]?.agents?.[agentName]?.max_messages);
    if (globalAgent !== undefined) return globalAgent;

    const globalMesh = this.extractLimit(g?.meshes?.[meshName]?.max_messages);
    if (globalMesh !== undefined) return globalMesh;

    const globalVal = this.extractLimit(g?.max_messages);
    if (globalVal !== undefined) return globalVal;

    return DEFAULTS.max_messages;
  }

  /**
   * Resolve max_invocations limit.
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default (null).
   */
  getMaxInvocations(meshName: string, agentName: string): number | null {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    const localAgent = this.extractLimit(local?.agents?.[agentName]?.max_invocations);
    if (localAgent !== undefined) return localAgent;

    const localMesh = this.extractLimit(local?.max_invocations);
    if (localMesh !== undefined) return localMesh;

    const globalAgent = this.extractLimit(g?.meshes?.[meshName]?.agents?.[agentName]?.max_invocations);
    if (globalAgent !== undefined) return globalAgent;

    const globalMesh = this.extractLimit(g?.meshes?.[meshName]?.max_invocations);
    if (globalMesh !== undefined) return globalMesh;

    const globalVal = this.extractLimit(g?.max_invocations);
    if (globalVal !== undefined) return globalVal;

    return DEFAULTS.max_invocations;
  }

  /**
   * Resolve max_turns limit.
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default (null).
   */
  getMaxTurns(meshName: string, agentName: string): number | null {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    const localAgent = this.extractLimit(local?.agents?.[agentName]?.max_turns);
    if (localAgent !== undefined) return localAgent;

    const localMesh = this.extractLimit(local?.max_turns);
    if (localMesh !== undefined) return localMesh;

    const globalAgent = this.extractLimit(g?.meshes?.[meshName]?.agents?.[agentName]?.max_turns);
    if (globalAgent !== undefined) return globalAgent;

    const globalMesh = this.extractLimit(g?.meshes?.[meshName]?.max_turns);
    if (globalMesh !== undefined) return globalMesh;

    const globalVal = this.extractLimit(g?.max_turns);
    if (globalVal !== undefined) return globalVal;

    return DEFAULTS.max_turns;
  }

  /**
   * Resolve max_mesh_messages limit.
   * Mesh-level only (no agent override — this is a mesh-wide cap).
   * Chain: mesh-local mesh config > mesh config.yaml > global mesh > global > default (null).
   */
  getMaxMeshMessages(meshName: string): number | null {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    // Mesh-local max_mesh_messages (from mesh's config.yaml guardrails section)
    const localMesh = this.extractLimit(local?.max_mesh_messages as MaxMeshMessagesOverride | number | null | undefined);
    if (localMesh !== undefined) return localMesh;

    // Global mesh override
    const globalMesh = this.extractLimit(g?.meshes?.[meshName]?.max_mesh_messages);
    if (globalMesh !== undefined) return globalMesh;

    // Global default
    const globalVal = this.extractLimit(g?.max_mesh_messages);
    if (globalVal !== undefined) return globalVal;

    return DEFAULTS.max_mesh_messages;
  }

  /**
   * Resolve max_instances limit for parallel mesh execution.
   * Mesh-level only (no agent override — this limits parallel instances per base mesh).
   * Chain: mesh-local mesh config > global mesh > global > default (null = unlimited).
   */
  getMaxInstances(meshName: string): number | null {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    // Mesh-local max_instances (from mesh's config.yaml guardrails section)
    const localMesh = this.extractLimit(local?.max_instances as MaxInstancesOverride | number | null | undefined);
    if (localMesh !== undefined) return localMesh;

    // Global mesh override
    const globalMesh = this.extractLimit(g?.meshes?.[meshName]?.max_instances);
    if (globalMesh !== undefined) return globalMesh;

    // Global default
    const globalVal = this.extractLimit(g?.max_instances);
    if (globalVal !== undefined) return globalVal;

    return DEFAULTS.max_instances;
  }

  /**
   * Resolve routing fallback config (edge iteration loop prevention).
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default.
   */
  getRoutingFallback(meshName: string, agentName?: string): { max: number | null; fallback: string | null } {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    // Mesh-local agent
    if (agentName) {
      const localAgent = local?.agents?.[agentName]?.routing_error;
      if (localAgent?.routing_retry_max !== undefined) {
        return { max: localAgent.routing_retry_max, fallback: localAgent.routing_fallback ?? DEFAULTS.routing_error.routing_fallback };
      }
    }

    // Mesh-local mesh
    const localMesh = local?.routing_error;
    if (localMesh?.routing_retry_max !== undefined) {
      return { max: localMesh.routing_retry_max, fallback: localMesh.routing_fallback ?? DEFAULTS.routing_error.routing_fallback };
    }

    // Global agent
    if (agentName) {
      const globalAgent = g?.meshes?.[meshName]?.agents?.[agentName]?.routing_error;
      if (globalAgent?.routing_retry_max !== undefined) {
        return { max: globalAgent.routing_retry_max, fallback: globalAgent.routing_fallback ?? DEFAULTS.routing_error.routing_fallback };
      }
    }

    // Global mesh
    const globalMesh = g?.meshes?.[meshName]?.routing_error;
    if (globalMesh?.routing_retry_max !== undefined) {
      return { max: globalMesh.routing_retry_max, fallback: globalMesh.routing_fallback ?? DEFAULTS.routing_error.routing_fallback };
    }

    // Global
    const globalVal = g?.routing_error;
    if (globalVal?.routing_retry_max !== undefined) {
      return { max: globalVal.routing_retry_max, fallback: globalVal.routing_fallback ?? DEFAULTS.routing_error.routing_fallback };
    }

    return { max: DEFAULTS.routing_error.routing_retry_max, fallback: DEFAULTS.routing_error.routing_fallback };
  }

  /**
   * Resolve guardrail mode (strict/warning) for any guardrail.
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default.
   * Default: { strict: false, warning: true }
   */
  getMode(
    guardrail: 'write_gate' | 'read_gate' | 'identity_gate' | 'bash_guard' | 'routing_error' | 'max_messages' | 'max_turns' | 'max_mesh_messages' | 'duplicate_target' | 'postcondition' | 'max_invocations',
    meshName: string,
    agentName?: string,
  ): GuardrailMode {
    const sources = this.collectModeSources(guardrail, meshName, agentName);
    const defaults = GUARDRAIL_DEFAULT_MODES[guardrail] ?? DEFAULT_MODE;
    const strict = sources.find(s => s?.strict !== undefined)?.strict ?? defaults.strict;
    const warning = sources.find(s => s?.warning !== undefined)?.warning ?? defaults.warning;
    return { strict, warning };
  }

  /**
   * Resolve bash_guard allowed_paths from config.
   * Merges: mesh-local agent > mesh-local mesh > global agent > global mesh > global.
   * All levels accumulate (union), not override.
   */
  getBashAllowedPaths(meshName: string, agentName?: string): string[] {
    const paths = new Set<string>();
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;

    // Collect from all levels (union — more permissive wins)
    const sources = [
      g?.bash_guard?.allowed_paths,
      g?.meshes?.[meshName]?.bash_guard?.allowed_paths,
      local?.bash_guard?.allowed_paths,
    ];
    if (agentName) {
      sources.push(
        g?.meshes?.[meshName]?.agents?.[agentName]?.bash_guard?.allowed_paths,
        local?.agents?.[agentName]?.bash_guard?.allowed_paths,
      );
    }
    for (const list of sources) {
      if (Array.isArray(list)) {
        for (const p of list) paths.add(p);
      }
    }

    return Array.from(paths);
  }

  /**
   * Collect mode sources in priority order for a guardrail.
   * Returns array from highest to lowest priority.
   */
  private collectModeSources(
    guardrail: string,
    meshName: string,
    agentName?: string,
  ): Array<{ strict?: boolean; warning?: boolean } | undefined> {
    const local = this.meshLocal.get(meshName);
    const g = this.config.guardrails;
    const sources: Array<{ strict?: boolean; warning?: boolean } | undefined> = [];

    // Agent-level guardrails (write_gate, read_gate, identity_gate, bash_guard, routing_error, max_messages, max_turns, duplicate_target, postcondition)
    // max_mesh_messages is mesh-level only
    const agentGuardrails = ['write_gate', 'read_gate', 'identity_gate', 'bash_guard', 'routing_error', 'max_messages', 'max_turns', 'duplicate_target', 'postcondition', 'max_invocations'];
    if (agentName && agentGuardrails.includes(guardrail)) {
      // Mesh-local agent
      const localAgentOverrides = local?.agents?.[agentName];
      const localAgentVal = localAgentOverrides ? (localAgentOverrides as Record<string, unknown>)[guardrail] : undefined;
      sources.push(this.extractModeFields(localAgentVal));

      // Mesh-local mesh
      const localMeshVal = local ? (local as Record<string, unknown>)[guardrail] : undefined;
      sources.push(this.extractModeFields(localMeshVal));

      // Global agent
      const globalAgentOverrides = g?.meshes?.[meshName]?.agents?.[agentName];
      const globalAgentVal = globalAgentOverrides ? (globalAgentOverrides as Record<string, unknown>)[guardrail] : undefined;
      sources.push(this.extractModeFields(globalAgentVal));

      // Global mesh
      const globalMeshOverrides = g?.meshes?.[meshName];
      const globalMeshVal = globalMeshOverrides ? (globalMeshOverrides as Record<string, unknown>)[guardrail] : undefined;
      sources.push(this.extractModeFields(globalMeshVal));
    } else {
      // Mesh-level only (max_mesh_messages) — still check mesh-local
      const localVal = local ? (local as Record<string, unknown>)[guardrail] : undefined;
      sources.push(this.extractModeFields(localVal));
      const globalMeshOverrides = g?.meshes?.[meshName];
      const globalMeshVal = globalMeshOverrides ? (globalMeshOverrides as Record<string, unknown>)[guardrail] : undefined;
      sources.push(this.extractModeFields(globalMeshVal));
    }

    // Global level
    sources.push(this.extractModeFields(g?.[guardrail as keyof GuardrailsSchema]));

    return sources;
  }

  /**
   * Extract strict/warning fields from a guardrail config value.
   * Handles both object configs and scalar values (number | null for max_messages/max_turns).
   */
  private extractModeFields(value: unknown): { strict?: boolean; warning?: boolean } | undefined {
    if (value === undefined || value === null || typeof value === 'number') return undefined;
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // YAML null parses as JS null — treat null as "not set"
      const strict = (obj.strict !== undefined && obj.strict !== null) ? obj.strict as boolean : undefined;
      const warning = (obj.warning !== undefined && obj.warning !== null) ? obj.warning as boolean : undefined;
      if (strict !== undefined || warning !== undefined) {
        return { strict, warning };
      }
    }
    return undefined;
  }

  /**
   * Get nudge auto-recovery configuration
   */
  getNudgeConfig(): { enabled?: boolean; delayMs?: number; maxNudgesPerAgent?: number } {
    const n = this.config.nudge;
    if (!n) return {};
    return {
      enabled: n.enabled,
      delayMs: n.delay_ms,
      maxNudgesPerAgent: n.max_nudges_per_agent,
    };
  }
}

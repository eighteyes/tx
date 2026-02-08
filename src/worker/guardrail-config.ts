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
}

interface RoutingErrorOverride {
  strict?: boolean;
  warning?: boolean;
  max_retries?: number;
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

interface MaxTurnsOverride {
  strict?: boolean;
  warning?: boolean;
  limit?: number | null;
}

interface AgentOverrides {
  write_gate?: GateOverride;
  read_gate?: GateOverride;
  identity_gate?: GateOverride;
  routing_error?: RoutingErrorOverride;
  max_messages?: MaxMessagesOverride | number | null;
  max_turns?: MaxTurnsOverride | number | null;
}

interface ArtifactConfig {
  strict?: boolean;
  warning?: boolean;
  post_validation?: boolean;
  pre_validation?: boolean;
  max_retry?: number;
}

interface EdgeLimitConfig {
  strict?: boolean;
  warning?: boolean;
  routing_retry_max?: number | null;
  routing_fallback?: string | null;
}

interface MeshOverrides extends AgentOverrides {
  agents?: Record<string, AgentOverrides>;
  artifact?: ArtifactConfig;
  edge_limit?: EdgeLimitConfig;
  max_mesh_messages?: MaxMeshMessagesOverride | number | null;
}

interface GuardrailsSchema {
  write_gate?: GateOverride;
  read_gate?: GateOverride;
  identity_gate?: GateOverride;
  routing_error?: RoutingErrorOverride;
  edge_limit?: EdgeLimitConfig;
  artifact?: ArtifactConfig;
  max_messages?: MaxMessagesOverride | number | null;
  max_turns?: MaxTurnsOverride | number | null;
  max_mesh_messages?: MaxMeshMessagesOverride | number | null;
  meshes?: Record<string, MeshOverrides>;
}

interface TxConfig {
  guardrails?: GuardrailsSchema;
}

const DEFAULT_MODE: GuardrailMode = { strict: false, warning: true };

const DEFAULTS = {
  write_gate: { kill_threshold: null as number | null },
  read_gate: { kill_threshold: null as number | null },
  identity_gate: { kill_threshold: null as number | null },
  routing_error: { max_retries: 3 },
  edge_limit: { routing_retry_max: null as number | null, routing_fallback: null as string | null },
  artifact: { post_validation: true, pre_validation: true, max_retry: 2 },
  max_messages: null as number | null,
  max_turns: null as number | null,
  max_mesh_messages: null as number | null,
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
    gate: 'write_gate' | 'read_gate' | 'identity_gate',
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
  private extractLimit(value: MaxMessagesOverride | MaxTurnsOverride | MaxMeshMessagesOverride | number | null | undefined): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value === 'number') return value;
    // Object form: { strict, warning, limit }
    // limit: null means "not set" — return undefined to continue the chain
    // limit: <number> means "set" — return the number
    return value.limit === null || value.limit === undefined ? undefined : value.limit;
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
   * Resolve artifact validation config.
   * Mesh-level only (no agent override — artifacts are mesh-scoped).
   */
  getArtifactConfig(meshName: string): { preValidation: boolean; postValidation: boolean; maxRetry: number } {
    const g = this.config.guardrails;

    const meshArtifact = g?.meshes?.[meshName]?.artifact ?? g?.artifact;
    return {
      preValidation: meshArtifact?.pre_validation ?? g?.artifact?.pre_validation ?? DEFAULTS.artifact.pre_validation,
      postValidation: meshArtifact?.post_validation ?? g?.artifact?.post_validation ?? DEFAULTS.artifact.post_validation,
      maxRetry: meshArtifact?.max_retry ?? g?.artifact?.max_retry ?? DEFAULTS.artifact.max_retry,
    };
  }

  /**
   * Resolve edge limit config.
   * Global and mesh-level only.
   */
  getEdgeLimit(meshName: string): { max: number | null; fallback: string | null } {
    const g = this.config.guardrails;

    const meshEdge = g?.meshes?.[meshName]?.edge_limit ?? g?.edge_limit;
    return {
      max: meshEdge?.routing_retry_max ?? g?.edge_limit?.routing_retry_max ?? DEFAULTS.edge_limit.routing_retry_max,
      fallback: meshEdge?.routing_fallback ?? g?.edge_limit?.routing_fallback ?? DEFAULTS.edge_limit.routing_fallback,
    };
  }

  /**
   * Resolve guardrail mode (strict/warning) for any guardrail.
   * Chain: mesh-local agent > mesh-local mesh > global agent > global mesh > global > default.
   * Default: { strict: false, warning: true }
   */
  getMode(
    guardrail: 'write_gate' | 'read_gate' | 'identity_gate' | 'routing_error' | 'edge_limit' | 'artifact' | 'max_messages' | 'max_turns' | 'max_mesh_messages',
    meshName: string,
    agentName?: string,
  ): GuardrailMode {
    const sources = this.collectModeSources(guardrail, meshName, agentName);
    const strict = sources.find(s => s?.strict !== undefined)?.strict ?? DEFAULT_MODE.strict;
    const warning = sources.find(s => s?.warning !== undefined)?.warning ?? DEFAULT_MODE.warning;
    return { strict, warning };
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

    // Agent-level guardrails (write_gate, read_gate, identity_gate, routing_error, max_messages, max_turns)
    // max_mesh_messages is mesh-level only
    const agentGuardrails = ['write_gate', 'read_gate', 'identity_gate', 'routing_error', 'max_messages', 'max_turns'];
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
      // Mesh-level only (artifact, edge_limit) — still check mesh-local
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
}

/**
 * MeshConfigLoader - Mesh Configuration Loading and Management
 *
 * Extracted from dispatcher.ts Phase 2 refactoring.
 * Handles mesh config file parsing, validation, normalization, and FSM setup.
 *
 * Features:
 * - Multi-location scanning (project + global meshes)
 * - YAML/JSON config support
 * - FSM config normalization
 * - Validation via MeshValidator
 * - JIT (just-in-time) config loading
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { log } from '../shared/logger.ts';
import { MeshValidator } from '../worker/mesh-validator.ts';
import type { ManifestEntry } from '../worker/mesh-validator.ts';
import type { FSMConfig, FSMStateConfig, EnsembleConfig, SemanticModel, RoutingMode, DispatcherRoutingConfig } from '../shared/types.ts';
import type { WorkspaceConfig } from '../workspace/manager.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { ToolRestriction } from '../worker/sdk-runner.ts';
import type { AgentPermissions } from '../worker/permissions.ts';

/**
 * Routing destination in mesh config
 * Format: { destination_agent: "reason string" }
 */
export type MeshRoutingDestination = Record<string, string>;

/**
 * Agent routing in mesh config
 * Format: { status_type: { destination_agent: "reason" } }
 */
export type MeshAgentRouting = Record<string, MeshRoutingDestination>;

/**
 * Mesh routing config
 * Format: { agent_name: { status_type: { destination_agent: "reason" } } }
 */
export type MeshRouting = Record<string, MeshAgentRouting>;

/**
 * Iteration config for quality gates
 */
export interface IterationConfig {
  maxIterations?: number;  // Max re-runs on quality failure (default: 3)
  onFail?: 'loop' | 'halt';  // What to do on quality failure (default: loop)
}

/**
 * Manifest enforcement config for artifact validation
 */
export interface ManifestEnforcementConfig {
  post_validation?: boolean;  // Check writes exist after agent completes (default: true)
  pre_validation?: boolean;   // Check reads exist before dispatching (default: true)
  max_retry?: number;         // Resume agent N times before failing out (default: 2)
  strict?: boolean;           // Strict mode: block/kill on validation failure (default: false)
  warning?: boolean;          // Warning mode: log warning on failure (default: true)
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
 * Agent configuration within a mesh
 */
export interface MeshGuardrailOverrides {
  write_gate?: { strict?: boolean; warning?: boolean; kill_threshold?: number | null };
  read_gate?: { strict?: boolean; warning?: boolean; kill_threshold?: number | null };
  identity_gate?: { strict?: boolean; warning?: boolean; kill_threshold?: number | null };
  bash_guard?: { strict?: boolean; warning?: boolean; kill_threshold?: number | null; allowed_paths?: string[] };
  routing_error?: { strict?: boolean; warning?: boolean; max_retries?: number; routing_retry_max?: number | null; routing_fallback?: string | null };
  max_messages?: { strict?: boolean; warning?: boolean; limit?: number | null } | number | null;
  max_turns?: { strict?: boolean; warning?: boolean; limit?: number | null } | number | null;
  postcondition?: { strict?: boolean; warning?: boolean };
  max_invocations?: { strict?: boolean; warning?: boolean; limit?: number | null } | number | null;
}

export interface MeshGuardrailConfig extends MeshGuardrailOverrides {
  agents?: Record<string, MeshGuardrailOverrides>;
  max_mesh_messages?: { strict?: boolean; warning?: boolean; limit?: number | null } | number | null;
  max_instances?: { strict?: boolean; warning?: boolean; limit?: number | null } | number | null;
}

/**
 * Parallel execution block configuration
 */
export interface ParallelBlock {
  agents: string[];       // Agents to run in parallel
  entry: string;          // Fork point (must have checkpoint: true)
  exit: string;           // Sync gate (waits for all parallel agents)
  timeout?: number;       // Optional: max wait time in ms
  on_partial?: 'continue' | 'abort';  // Behavior when some agents fail (default: continue)
}

export interface AgentConfig {
  name: string;
  model: SemanticModel;  // Required (config loader defaults to haiku when load is set)
  prompt?: string;  // Path to prompt file (required unless command is set)
  command?: string;  // Slash command to prepend (e.g., "/know:build")
  workspace?: WorkspaceConfig;  // Optional per-agent workspace config
  mcpServers?: Record<string, McpServerConfig>;  // MCP server configurations
  thinking?: boolean;  // Enable extended thinking (default: true). Set false to disable.
  max_turns?: number;  // API round-trip limit per invocation (runtime guardrail)
  max_messages?: number;  // Outbound message limit per worker invocation (chaos contract)
  load?: string[];  // Files to preload into context (globs supported, validated against manifest reads)
  checkpoint?: boolean | 'start' | 'end';  // Checkpoint type: start (after init), end (after completion)
  fork_from?: string;  // Fork from another agent's checkpoint
  orchestrator?: boolean;  // Restrict to Read + Write(msgs only). For coordinator agents that route, not implement.
  permissions?: AgentPermissions;  // Tool access control (allowedTools, disallowedTools, mode)
  chrome?: boolean;  // Use claude CLI with --chrome for browser access (bypasses SDK runner)
  postconditions?: import('../worker/postcondition-validator.ts').PostconditionConfig;  // Tool call postconditions
  fragments?: Record<string, string> | string;  // Fragment map { name: path } or directory path
}

/**
 * Complete mesh configuration
 */
export interface MeshConfig {
  mesh: string;
  description?: string;
  agents: AgentConfig[];
  entry_point?: string;
  completion_agent?: string;  // DEPRECATED: Use completion_agents
  completion_agents?: string[];  // Agents at mesh boundary (can message core/core)
  boundary_agents?: string[];  // DEPRECATED: Use completion_agents (backward compatibility)
  workspace?: WorkspaceConfig;  // Optional workspace output schema
  worktree?: boolean;  // Shorthand: true = isolated worktree + auto-commit + cleanup
  continuation?: boolean | string[];  // Session reuse within a mesh run (default: true)
  persistence?: boolean | string[];   // Sessions survive across mesh runs (default: false)
  lifecycle?: {
    pre?: string[];   // Pre-hooks executed before worker spawn
    post?: string[];  // Post-hooks executed after worker completion
  };
  routing_mode?: RoutingMode;  // 'agent' (default) or 'dispatcher' (opt-in centralized routing)
  routing?: MeshRouting | DispatcherRoutingConfig;  // Shape depends on routing_mode
  routing_fallback?: string;  // DEPRECATED: Use guardrails.routing_error.routing_fallback
  routing_retry_max?: number; // DEPRECATED: Use guardrails.routing_error.routing_retry_max
  toolRestriction?: ToolRestriction;  // Tool access policy for all agents in mesh
  iteration?: IterationConfig;  // Iteration config for quality gates
  fsm?: FSMConfig;  // FSM config for workflow orchestration
  ensemble?: EnsembleConfig;  // Ensemble execution config
  rearmatter?: RearmatterConfig;  // Transparency metadata config
  manifest?: ManifestEntry[];  // File I/O manifest: declares files, readers/writers, locations
  manifest_enforcement?: ManifestEnforcementConfig;  // Artifact validation settings
  guardrails?: MeshGuardrailConfig;  // Per-mesh guardrail overrides (mesh-local wins over global)
  parallelism?: ParallelBlock[];  // Parallel execution blocks with fork/join semantics
  reliability?: import('../reliability/reliability-manager.ts').ReliabilityConfig;  // Per-mesh reliability overrides (heartbeat thresholds, etc.)
  max_mesh_messages?: number | { strict?: boolean; warning?: boolean; limit?: number | null };  // Mesh-wide message cap
  autoInjectManifestFiles?: boolean;  // Auto-preload manifest reads into agent context (default: true)
  disable?: boolean;  // Disable mesh: hidden from prompts, cannot be started
  dev_mode?: boolean;  // Override all agent models to haiku for cheap workflow testing
  stop_on_first_complete?: boolean;  // Stop mesh on first completion signal (default: true)
  check_queue_on_complete?: boolean;  // Defer shutdown if queue has pending messages (default: true)
  load_claude_md?: boolean;  // Load project CLAUDE.md into agent system prompt (default: true)
  brain?: boolean;  // Inject brain access prompt into agents (message brain/brain for questions)
  _basePath?: string;  // Internal: directory containing this config (for relative prompt paths)
}

/**
 * Events emitted by MeshConfigLoader
 */
export interface MeshConfigLoaderEvents {
  'mesh:loaded': { mesh: string; agents: number };
  'mesh:invalid': { file: string; errors: string[]; warnings: string[] };
  'error': { error: string };
}

/**
 * Configuration options for MeshConfigLoader
 */
export interface MeshConfigLoaderOptions {
  workDir: string;
  meshesDir: string;
}

/**
 * MeshConfigLoader - Handles mesh configuration loading and management
 */
export class MeshConfigLoader extends EventEmitter {
  private workDir: string;
  private meshesDir: string;
  private meshConfigs: Map<string, MeshConfig> = new Map();

  constructor(options: MeshConfigLoaderOptions) {
    super();
    this.workDir = options.workDir;
    this.meshesDir = options.meshesDir;
  }

  /**
   * Load all mesh configs from project and global directories
   * Supports: meshes/{mesh}/config.yaml and meshes/{category}/{mesh}/config.yaml
   * Falls back to TX_ROOT/meshes/ if project doesn't have meshes
   */
  loadAll(): Map<string, MeshConfig> {
    try {
      // TX_SERVE_MESHES: comma-separated allowlist of mesh names to load
      // When set, only meshes in this list are loaded (server publishing filter)
      const serveMeshes = process.env.TX_SERVE_MESHES
        ? new Set(process.env.TX_SERVE_MESHES.split(',').map(s => s.trim()).filter(Boolean))
        : null;

      if (serveMeshes) {
        log.info('config-loader', `TX_SERVE_MESHES filter active: ${[...serveMeshes].join(', ')}`);
      }

      const meshRoots: Array<{ dir: string; isGlobal: boolean }> = [];

      // Project meshes
      if (fs.existsSync(this.meshesDir)) {
        meshRoots.push({ dir: this.meshesDir, isGlobal: false });
      }

      // Global TX_ROOT meshes (fallback)
      const globalMeshDir = process.env.TX_ROOT
        ? path.join(process.env.TX_ROOT, 'meshes')
        : null;
      if (globalMeshDir && fs.existsSync(globalMeshDir) && globalMeshDir !== this.meshesDir) {
        meshRoots.push({ dir: globalMeshDir, isGlobal: true });
      }

      // Legacy: check for meshes/configs/ directory (old structure)
      const legacyConfigDir = path.join(this.meshesDir, 'configs');
      if (fs.existsSync(legacyConfigDir)) {
        this.loadFromLegacyDir(legacyConfigDir, false);
      }

      if (meshRoots.length === 0) {
        log.warn('config-loader', 'No mesh directories found', {
          projectDir: this.meshesDir,
          globalDir: globalMeshDir
        });
        return this.meshConfigs;
      }

      // Scan meshes/*/ and meshes/*/*/ for config files
      for (const { dir: meshRoot, isGlobal } of meshRoots) {
        this.scanDirectory(meshRoot, isGlobal, 0);
      }

      return this.meshConfigs;
    } catch (error) {
      log.error('config-loader', 'Failed to load mesh configs', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      this.emit('error', { error: `Failed to load mesh configs: ${(error as Error).message}` });
      return this.meshConfigs;
    }
  }

  /**
   * Load a single mesh config on demand
   * Returns true if successfully loaded
   */
  loadOnDemand(meshName: string): boolean {
    // Check if already loaded
    if (this.meshConfigs.has(meshName)) {
      return true;
    }

    // TX_SERVE_MESHES filter: block on-demand loading of filtered meshes
    const serveMeshes = process.env.TX_SERVE_MESHES
      ? new Set(process.env.TX_SERVE_MESHES.split(',').map(s => s.trim()).filter(Boolean))
      : null;
    if (serveMeshes && !serveMeshes.has(meshName)) {
      log.debug('config-loader', `Blocked on-demand load (TX_SERVE_MESHES filter): ${meshName}`);
      return false;
    }

    // Try to find and load the config
    const possiblePaths = this.findConfigPaths(meshName);

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        const basePath = path.dirname(configPath);
        const isGlobal = process.env.TX_ROOT ? configPath.startsWith(process.env.TX_ROOT) : false;
        this.loadFromFile(configPath, basePath, isGlobal);
        return this.meshConfigs.has(meshName);
      }
    }

    log.warn('config-loader', 'Mesh config not found for on-demand load', { meshName });
    return false;
  }

  /**
   * Get a loaded mesh config
   */
  get(meshName: string): MeshConfig | undefined {
    return this.meshConfigs.get(meshName);
  }

  /**
   * Get all loaded mesh configs
   */
  getAll(): Map<string, MeshConfig> {
    return this.meshConfigs;
  }

  /**
   * Check if a mesh config is loaded
   */
  has(meshName: string): boolean {
    return this.meshConfigs.has(meshName);
  }

  /**
   * Get list of loaded mesh names
   */
  getMeshNames(): string[] {
    return Array.from(this.meshConfigs.keys());
  }

  /**
   * Clear all loaded configs (useful for testing or reload)
   */
  clear(): void {
    this.meshConfigs.clear();
  }

  /**
   * Reload a single mesh config from disk.
   * Invalidates the cached config and re-reads from the filesystem.
   * Returns true if the mesh was successfully reloaded.
   */
  reload(meshName: string): boolean {
    this.meshConfigs.delete(meshName);
    return this.loadOnDemand(meshName);
  }

  /**
   * Recursively scan mesh directory for config files (max depth 2)
   * Supports: config.yaml, config.yml (preferred) and config.json (legacy)
   */
  private scanDirectory(dir: string, isGlobal: boolean, depth: number): void {
    if (depth > 2) return;  // meshes/category/mesh/ is max depth
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // Check for config files in this directory (priority: YAML > JSON)
      const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
      const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

      if (yamlConfig) {
        this.loadFromFile(path.join(dir, yamlConfig.name), dir, isGlobal);
      } else if (jsonConfig) {
        this.loadFromFile(path.join(dir, 'config.json'), dir, isGlobal);
      }

      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'configs') {
          this.scanDirectory(path.join(dir, entry.name), isGlobal, depth + 1);
        }
      }
    } catch (error) {
      log.error('config-loader', `Failed to scan mesh directory: ${dir}`, {
        error: (error as Error).message
      });
    }
  }

  /**
   * Load a single mesh config from a file
   * Uses MeshValidator for comprehensive validation
   * Supports both YAML (.yaml, .yml) and JSON (.json) formats
   */
  private loadFromFile(configPath: string, basePath: string, isGlobal: boolean): void {
    const filename = path.basename(configPath);
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const isYaml = filename.endsWith('.yaml') || filename.endsWith('.yml');
      const rawConfig = isYaml ? YAML.parse(content) : JSON.parse(content);

      if (!rawConfig || typeof rawConfig !== 'object') {
        log.error('config-loader', `Empty or invalid config file: ${filename}`, { configPath });
        return;
      }

      // Validate using MeshValidator
      const validation = MeshValidator.validate(rawConfig, filename);

      if (!validation.valid) {
        log.error('config-loader', `Invalid mesh config: ${rawConfig.mesh || filename}`, {
          mesh: rawConfig.mesh,
          configPath,
          errors: validation.errors
        });
        this.emit('mesh:invalid', {
          file: filename,
          errors: validation.errors,
          warnings: validation.warnings
        });
        return;
      }

      // Validation passed (warnings are silent unless there are errors)
      const config = validation.config as MeshConfig;

      // Don't override project configs with global ones
      if (this.meshConfigs.has(config.mesh) && isGlobal) {
        return;
      }

      // Transform FSM config if needed (object-style states → array-style)
      if (config.fsm) {
        config.fsm = this.normalizeFSMConfig(config.fsm);
      }

      // Normalize agent configs: default model to haiku when load is specified
      for (const agent of config.agents) {
        if (!agent.model && agent.load && agent.load.length > 0) {
          (agent as any).model = 'haiku';
        } else if (!agent.model) {
          (agent as any).model = 'sonnet';  // Default model when not specified
        }

        // Normalize checkpoint: true → 'start' (backward compat)
        if (agent.checkpoint === true) {
          (agent as any).checkpoint = 'start';
        }

        // Normalize fragments to absolute paths
        if (typeof agent.fragments === 'string') {
          // Directory path — resolved relative to mesh base
          (agent as any).fragments = path.resolve(basePath, agent.fragments);
        } else if (agent.fragments && typeof agent.fragments === 'object') {
          // Map of name → path — resolve each
          const resolved: Record<string, string> = {};
          for (const [name, fragPath] of Object.entries(agent.fragments)) {
            resolved[name] = path.resolve(basePath, fragPath);
          }
          (agent as any).fragments = resolved;
        }
      }

      // Normalize parallel blocks: validate and auto-wire fork_from/checkpoint
      if (config.parallelism && config.parallelism.length > 0) {
        const agentNames = new Set(config.agents.map(a => a.name));

        for (const block of config.parallelism) {
          // Validate agents exist
          for (const agentName of block.agents) {
            if (!agentNames.has(agentName)) {
              log.error('config-loader', `Parallel block references unknown agent: ${agentName}`, {
                mesh: config.mesh,
                blockEntry: block.entry,
              });
            }
          }

          // Validate entry and exit exist
          if (!agentNames.has(block.entry)) {
            log.error('config-loader', `Parallel block entry agent not found: ${block.entry}`, { mesh: config.mesh });
          }
          if (!agentNames.has(block.exit)) {
            log.error('config-loader', `Parallel block exit agent not found: ${block.exit}`, { mesh: config.mesh });
          }

          // Auto-add checkpoint: 'start' to entry agent (captures init state for forking)
          const entryAgent = config.agents.find(a => a.name === block.entry);
          if (entryAgent && !entryAgent.checkpoint) {
            (entryAgent as any).checkpoint = 'start';
            log.debug('config-loader', `Auto-enabled checkpoint for parallel entry: ${block.entry}`, {
              mesh: config.mesh,
            });
          }

          // Auto-add fork_from: entry to parallel agents (if not explicitly set)
          for (const agentName of block.agents) {
            const agent = config.agents.find(a => a.name === agentName);
            if (agent && !agent.fork_from) {
              (agent as any).fork_from = block.entry;
              log.debug('config-loader', `Auto-wired fork_from for parallel agent: ${agentName}`, {
                mesh: config.mesh,
                forkFrom: block.entry,
              });
            }
          }
        }
      }

      // Backward-compat: migrate top-level routing_fallback/routing_retry_max into guardrails.routing_error
      if (config.routing_fallback !== undefined || config.routing_retry_max !== undefined) {
        if (!config.guardrails) config.guardrails = {};
        if (!config.guardrails.routing_error) config.guardrails.routing_error = {};
        if (config.routing_fallback !== undefined && config.guardrails.routing_error.routing_fallback === undefined) {
          config.guardrails.routing_error.routing_fallback = config.routing_fallback;
        }
        if (config.routing_retry_max !== undefined && config.guardrails.routing_error.routing_retry_max === undefined) {
          config.guardrails.routing_error.routing_retry_max = config.routing_retry_max;
        }
        log.warn('config-loader', `Mesh '${config.mesh}' uses deprecated top-level routing_fallback/routing_retry_max — move to guardrails.routing_error`);
      }

      // Store base path for relative prompt resolution
      config._basePath = basePath;

      // TX_SERVE_MESHES filter: skip meshes not in the allowlist
      const serveMeshes = process.env.TX_SERVE_MESHES
        ? new Set(process.env.TX_SERVE_MESHES.split(',').map(s => s.trim()).filter(Boolean))
        : null;
      if (serveMeshes && !serveMeshes.has(config.mesh)) {
        log.debug('config-loader', `Skipping mesh (TX_SERVE_MESHES filter): ${config.mesh}`);
        return;
      }

      // Skip disabled meshes
      if (config.disable) {
        log.debug('config-loader', `Skipping disabled mesh: ${config.mesh}`);
        return;
      }

      this.meshConfigs.set(config.mesh, config);
      this.emit('mesh:loaded', { mesh: config.mesh, agents: config.agents.length });
    } catch (error) {
      log.error('config-loader', `Failed to parse mesh config: ${filename}`, {
        configPath,
        error: (error as Error).message
      });
      this.emit('mesh:invalid', {
        file: filename,
        errors: [(error as Error).message],
        warnings: []
      });
    }
  }

  /**
   * Legacy: Load configs from meshes/configs/ directory (old structure)
   */
  private loadFromLegacyDir(configDir: string, isGlobal: boolean): void {
    const files = fs.readdirSync(configDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const configPath = path.join(configDir, file);
      // Legacy configs use workDir-relative prompt paths, so basePath is workDir
      this.loadFromFile(configPath, this.workDir, isGlobal);
    }
  }

  /**
   * Find possible config file paths for a mesh name
   */
  private findConfigPaths(meshName: string): string[] {
    const paths: string[] = [];

    // Project paths
    paths.push(
      path.join(this.meshesDir, meshName, 'config.yaml'),
      path.join(this.meshesDir, meshName, 'config.yml'),
      path.join(this.meshesDir, meshName, 'config.json')
    );

    // Global TX_ROOT paths
    if (process.env.TX_ROOT) {
      paths.push(
        path.join(process.env.TX_ROOT, 'meshes', meshName, 'config.yaml'),
        path.join(process.env.TX_ROOT, 'meshes', meshName, 'config.yml'),
        path.join(process.env.TX_ROOT, 'meshes', meshName, 'config.json')
      );
    }

    // Legacy path
    paths.push(
      path.join(this.meshesDir, 'configs', `${meshName}.json`)
    );

    return paths;
  }

  /**
   * Normalize FSM config to handle both object-style and array-style states
   *
   * Object-style (preferred for YAML readability):
   * ```yaml
   * fsm:
   *   states:
   *     planning:
   *       coordinator: planner
   *     implementation:
   *       coordinator: implementer
   * ```
   *
   * Array-style (original format):
   * ```yaml
   * fsm:
   *   states:
   *     - name: planning
   *       coordinator: planner
   *     - name: implementation
   *       coordinator: implementer
   * ```
   */
  normalizeFSMConfig(fsmConfig: FSMConfig): FSMConfig {
    // If states is already an array, return as-is
    if (Array.isArray(fsmConfig.states)) {
      return fsmConfig;
    }

    // Convert object-style to array-style
    const statesObj = fsmConfig.states as unknown as Record<string, Omit<FSMStateConfig, 'name'>>;
    const statesArray: FSMStateConfig[] = Object.entries(statesObj).map(([name, stateConf]) => {
      const agents = (stateConf as any).agents as string[] | undefined;
      const normalized: FSMStateConfig = {
        name,
        ...stateConf,
        coordinator: agents?.[0] || (stateConf as any).coordinator,
        participants: agents?.slice(1) || (stateConf as any).participants,
      };
      if (agents) delete (normalized as any).agents;
      return normalized;
    });

    return {
      ...fsmConfig,
      states: statesArray,
    };
  }

  /**
   * Extract routing config for a specific agent from mesh config
   * Returns routing in format: { status: { destination: "reason" } }
   */
  extractAgentRouting(
    meshName: string,
    agentName: string,
    meshConfig?: MeshConfig
  ): Record<string, Record<string, string>> | undefined {
    if (!meshConfig?.routing) return undefined;
    if (meshConfig.routing_mode === 'dispatcher' || meshConfig.routing_mode === 'free') return undefined;

    const agentRouting = (meshConfig.routing as MeshRouting)[agentName];
    if (!agentRouting) return undefined;

    // Return raw routing config (status -> destination -> reason)
    return Object.keys(agentRouting).length > 0 ? agentRouting : undefined;
  }

  /**
   * Extract dispatcher routing config for an entire mesh
   * Returns the flat routing map when routing_mode is 'dispatcher'
   */
  extractDispatcherRouting(meshConfig?: MeshConfig): DispatcherRoutingConfig | undefined {
    if (!meshConfig?.routing || meshConfig.routing_mode !== 'dispatcher') return undefined;
    return meshConfig.routing as DispatcherRoutingConfig;
  }

  /**
   * Check if an agent should have session continuation enabled
   */
  shouldContinueAgent(agentName: string, continuation: boolean | string[] | undefined): boolean {
    if (continuation === undefined) return true;  // default: enabled
    if (continuation === false) return false;
    if (continuation === true) return true;
    if (Array.isArray(continuation)) return continuation.includes(agentName);
    return true;
  }

  /**
   * Check if an agent should have cross-run session persistence enabled
   */
  shouldPersistAgent(agentName: string, persistence: boolean | string[] | undefined): boolean {
    if (!persistence) return false;
    if (persistence === true) return true;
    if (Array.isArray(persistence)) return persistence.includes(agentName);
    return false;
  }
}

/**
 * MeshManager - Mesh Configuration Loading and Management
 *
 * Responsibilities:
 * - Loading mesh configs from YAML/JSON files
 * - JIT (Just-In-Time) mesh loading on demand
 * - FSM initialization for meshes
 * - Caching loaded configurations
 * - Config validation delegation to MeshValidator
 *
 * Extracted from WorkerDispatcher to separate concerns.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { log } from '../shared/logger.ts';
import { MeshValidator } from './mesh-validator.ts';
import { MeshFSM, type FSMTransitionEvent, type FSMGateEvent, type FSMScriptEvent } from '../mesh/index.ts';
import type { FSMConfig } from '../shared/types.ts';
import type { MeshConfig, DispatcherConfig } from './types.ts';
import type { MessageQueue } from '../queue/index.ts';
import type Database from 'better-sqlite3';

/**
 * MeshManager - Handles all mesh configuration loading and management
 */
export class MeshManager extends EventEmitter {
  private config: DispatcherConfig;
  private meshConfigs: Map<string, MeshConfig> = new Map();
  private meshFSMs: Map<string, MeshFSM> = new Map();
  private database: Database.Database;

  constructor(config: DispatcherConfig, database: Database.Database) {
    super();
    this.config = config;
    this.database = database;
  }

  /**
   * Load all mesh configurations from meshes/ directory
   * Called during dispatcher startup
   */
  loadAllMeshes(): void {
    try {
      const meshRoots: Array<{ dir: string; isGlobal: boolean }> = [];

      // Project meshes
      if (fs.existsSync(this.config.meshesDir)) {
        meshRoots.push({ dir: this.config.meshesDir, isGlobal: false });
      }

      // Global TX_ROOT meshes (fallback)
      const globalMeshDir = process.env.TX_ROOT
        ? path.join(process.env.TX_ROOT, 'meshes')
        : null;
      if (globalMeshDir && fs.existsSync(globalMeshDir) && globalMeshDir !== this.config.meshesDir) {
        meshRoots.push({ dir: globalMeshDir, isGlobal: true });
      }

      // Legacy: check for meshes/configs/ directory (old structure)
      const legacyConfigDir = path.join(this.config.meshesDir, 'configs');
      if (fs.existsSync(legacyConfigDir)) {
        this.loadMeshConfigsFromLegacyDir(legacyConfigDir, false);
      }

      if (meshRoots.length === 0) {
        log.warn('mesh-manager', 'No mesh directories found', {
          projectDir: this.config.meshesDir,
          globalDir: globalMeshDir
        });
        return;
      }

      // Scan meshes/*/ and meshes/*/*/ for config files
      for (const { dir: meshRoot, isGlobal } of meshRoots) {
        this.scanMeshDir(meshRoot, isGlobal, 0);
      }

      // Initialize FSMs for meshes that have fsm config
      this.initializeFSMs();
    } catch (error) {
      log.error('mesh-manager', 'Failed to load mesh configs', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      this.emit('error', { error: `Failed to load mesh configs: ${(error as Error).message}` });
    }
  }

  /**
   * Get a mesh configuration by name
   */
  getMeshConfig(meshName: string): MeshConfig | undefined {
    return this.meshConfigs.get(meshName);
  }

  /**
   * Get all loaded mesh names
   */
  getMeshNames(): string[] {
    return Array.from(this.meshConfigs.keys());
  }

  /**
   * Get FSM for a mesh
   */
  getMeshFSM(meshName: string): MeshFSM | undefined {
    return this.meshFSMs.get(meshName);
  }

  /**
   * Try to load a mesh on-demand when a message arrives for an unloaded mesh
   * Searches project meshes/ and global TX_ROOT/meshes/
   * Returns true if mesh was loaded successfully
   */
  loadMeshOnDemand(meshName: string): boolean {
    try {
      const searchDirs: Array<{ dir: string; isGlobal: boolean }> = [];

      // Project meshes
      if (fs.existsSync(this.config.meshesDir)) {
        searchDirs.push({ dir: this.config.meshesDir, isGlobal: false });
      }

      // Global TX_ROOT meshes
      const globalMeshDir = process.env.TX_ROOT
        ? path.join(process.env.TX_ROOT, 'meshes')
        : null;
      if (globalMeshDir && fs.existsSync(globalMeshDir) && globalMeshDir !== this.config.meshesDir) {
        searchDirs.push({ dir: globalMeshDir, isGlobal: true });
      }

      // Search for mesh directory and config file
      for (const { dir: searchRoot, isGlobal } of searchDirs) {
        // Try direct: meshes/{meshName}/config.yaml
        const directPath = path.join(searchRoot, meshName);
        if (fs.existsSync(directPath)) {
          const configPath = this.findConfigInDir(directPath);
          if (configPath) {
            log.info('mesh-manager', 'Found mesh config (JIT)', { meshName, configPath });
            this.loadMeshConfigFromFile(configPath, directPath, isGlobal);

            // Initialize FSM if needed
            const config = this.meshConfigs.get(meshName);
            if (config?.fsm) {
              this.initializeSingleFSM(meshName, config);
            }

            return true;
          }
        }

        // Try nested: meshes/{category}/{meshName}/config.yaml
        const categories = fs.readdirSync(searchRoot, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.'));

        for (const category of categories) {
          const nestedPath = path.join(searchRoot, category.name, meshName);
          if (fs.existsSync(nestedPath)) {
            const configPath = this.findConfigInDir(nestedPath);
            if (configPath) {
              log.info('mesh-manager', 'Found mesh config (JIT, nested)', {
                meshName,
                configPath,
                category: category.name
              });
              this.loadMeshConfigFromFile(configPath, nestedPath, isGlobal);

              // Initialize FSM if needed
              const config = this.meshConfigs.get(meshName);
              if (config?.fsm) {
                this.initializeSingleFSM(meshName, config);
              }

              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      log.error('mesh-manager', 'JIT mesh load failed', {
        meshName,
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Check if an agent should have session continuation enabled
   */
  shouldContinueAgent(agentName: string, continuation: boolean | string[] | undefined): boolean {
    if (!continuation) return false;
    if (continuation === true) return true;
    if (Array.isArray(continuation)) return continuation.includes(agentName);
    return false;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Recursively scan mesh directory for config files (max depth 2)
   * Supports: config.yaml, config.yml (preferred) and config.json (legacy)
   */
  private scanMeshDir(dir: string, isGlobal: boolean, depth: number): void {
    if (depth > 2) return;  // meshes/category/mesh/ is max depth
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // Check for config files in this directory (priority: YAML > JSON)
      const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
      const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

      if (yamlConfig) {
        this.loadMeshConfigFromFile(path.join(dir, yamlConfig.name), dir, isGlobal);
      } else if (jsonConfig) {
        this.loadMeshConfigFromFile(path.join(dir, 'config.json'), dir, isGlobal);
      }

      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'configs') {
          this.scanMeshDir(path.join(dir, entry.name), isGlobal, depth + 1);
        }
      }
    } catch (error) {
      log.error('mesh-manager', `Failed to scan mesh directory: ${dir}`, {
        error: (error as Error).message
      });
    }
  }

  /**
   * Load a single mesh config from a file
   * Uses MeshValidator for comprehensive validation
   * Supports both YAML (.yaml, .yml) and JSON (.json) formats
   */
  private loadMeshConfigFromFile(configPath: string, basePath: string, isGlobal: boolean): void {
    const filename = path.basename(configPath);
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const isYaml = filename.endsWith('.yaml') || filename.endsWith('.yml');
      const rawConfig = isYaml ? YAML.parse(content) : JSON.parse(content);

      // Validate using MeshValidator
      const validation = MeshValidator.validate(rawConfig, filename);

      if (!validation.valid) {
        log.error('mesh-manager', `Invalid mesh config: ${rawConfig.mesh || filename}`, {
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

      // Store base path for relative prompt resolution
      config._basePath = basePath;

      this.meshConfigs.set(config.mesh, config);
      this.emit('mesh:loaded', { mesh: config.mesh, agents: config.agents.length });
    } catch (error) {
      log.error('mesh-manager', `Failed to parse mesh config: ${filename}`, {
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
  private loadMeshConfigsFromLegacyDir(configDir: string, isGlobal: boolean): void {
    const files = fs.readdirSync(configDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const configPath = path.join(configDir, file);
      // Legacy configs use workDir-relative prompt paths, so basePath is workDir
      this.loadMeshConfigFromFile(configPath, this.config.workDir, isGlobal);
    }
  }

  /**
   * Find config file in directory (prioritize YAML over JSON)
   * Returns absolute path to config file, or null if not found
   */
  private findConfigInDir(dir: string): string | null {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
      const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

      if (yamlConfig) {
        return path.join(dir, yamlConfig.name);
      } else if (jsonConfig) {
        return path.join(dir, jsonConfig.name);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Normalize FSM config to support both array and object-style states
   * Transforms object-style states: { state_name: {...} } → array: [{ name: state_name, ...}]
   */
  private normalizeFSMConfig(fsm: any): FSMConfig {
    // If states is already an array, return as-is
    if (Array.isArray(fsm.states)) {
      return fsm as FSMConfig;
    }

    // Transform object-style states to array-style
    const states: any[] = [];
    for (const [stateName, stateConfig] of Object.entries(fsm.states || {})) {
      const normalized: any = { name: stateName, ...(stateConfig as any) };

      // Transform 'agents' array → coordinator + participants
      if (normalized.agents) {
        const agentList = normalized.agents as string[];
        normalized.coordinator = agentList[0];
        if (agentList.length > 1) {
          normalized.participants = agentList.slice(1);
        }
        delete normalized.agents;
      }

      states.push(normalized);
    }

    return {
      initialState: fsm.initial || fsm.initialState,
      states,
      transitions: fsm.transitions || [],
      context: fsm.context,
    } as FSMConfig;
  }

  /**
   * Initialize FSM instances for all meshes with fsm config
   */
  private initializeFSMs(): void {
    for (const [meshName, config] of this.meshConfigs) {
      if (!config.fsm) continue;
      this.initializeSingleFSM(meshName, config);
    }
  }

  /**
   * Initialize FSM for a single mesh
   */
  private initializeSingleFSM(meshName: string, config: MeshConfig): void {
    try {
      const fsm = new MeshFSM(
        meshName,
        config.fsm!,
        this.database,
        config._basePath || this.config.workDir,
        this.config.workDir
      );

      // Wire FSM events for observability
      fsm.on('fsm:transition', (event: FSMTransitionEvent) => {
        log.debug('mesh-fsm', 'State transition', {
          meshName: event.meshName,
          from: event.from,
          to: event.to,
          trigger: event.trigger,
          triggerAgent: event.triggerAgent,
        });
        this.emit('fsm:transition', event);
      });

      fsm.on('fsm:gate-check', (event: FSMGateEvent) => {
        log.debug('mesh-fsm', 'Gate check', {
          meshName: event.meshName,
          state: event.state,
          passed: event.passed,
          retryCount: event.retryCount,
        });
        this.emit('fsm:gate-check', event);
      });

      fsm.on('fsm:script-run', (event: FSMScriptEvent) => {
        if (!event.success) {
          log.error('mesh-fsm', 'Script failed', {
            meshName: event.meshName,
            scriptType: event.scriptType,
            scriptPath: event.scriptPath,
            error: event.error,
          });
        }
        this.emit('fsm:script-run', event);
      });

      // Initialize the FSM (loads or creates state)
      fsm.initialize().catch(error => {
        log.error('mesh-fsm', 'Failed to initialize FSM', {
          meshName,
          error: (error as Error).message,
        });
      });

      this.meshFSMs.set(meshName, fsm);
    } catch (error) {
      log.error('mesh-manager', `Failed to create FSM for mesh: ${meshName}`, {
        error: (error as Error).message,
      });
    }
  }
}

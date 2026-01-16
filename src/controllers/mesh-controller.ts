/**
 * Mesh Controller
 *
 * Handles CRUD operations for mesh configurations.
 * Provides APIs for listing, reading, updating, and validating mesh configs.
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../shared/logger.ts';
import { YAMLHandler } from '../utils/yaml-handler.ts';
import { MeshValidator } from '../worker/mesh-validator.ts';
import type { MeshConfigSchema, ValidationResult } from '../worker/mesh-validator.ts';

/**
 * Mesh metadata returned by listMeshes
 */
export interface MeshMetadata {
  name: string;
  path: string;
  description: string;
  agents: number;
  configType: 'yaml' | 'json';
}

/**
 * Full mesh data returned by getMesh
 */
export interface MeshData {
  name: string;
  config: MeshConfigSchema;
  raw: string;
  configType: 'yaml' | 'json';
}

/**
 * Update mesh request data
 */
export interface UpdateMeshRequest {
  config: MeshConfigSchema;
  format: 'yaml' | 'json';
}

/**
 * Update mesh response
 */
export interface UpdateMeshResponse {
  success: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Validation response
 */
export interface ValidateMeshResponse {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Error thrown when a mesh is not found
 */
export class MeshNotFoundError extends Error {
  constructor(name: string) {
    super(`Mesh not found: ${name}`);
    this.name = 'MeshNotFoundError';
  }
}

/**
 * Error thrown when mesh validation fails
 */
export class MeshValidationError extends Error {
  public field?: string;
  public severity: 'error' | 'warning';

  constructor(
    message: string,
    field?: string,
    severity: 'error' | 'warning' = 'error'
  ) {
    super(message);
    this.name = 'MeshValidationError';
    this.field = field;
    this.severity = severity;
  }
}

/**
 * Mesh Controller class
 *
 * Provides methods for managing mesh configurations:
 * - listMeshes: Get all available meshes
 * - getMesh: Get a specific mesh config
 * - updateMesh: Update a mesh config
 * - validateMesh: Validate a mesh config without saving
 */
export class MeshController {
  constructor(private meshesDir: string) {}

  /**
   * List all meshes
   *
   * Scans the meshes directory and returns metadata for each mesh.
   *
   * @returns Array of mesh metadata
   */
  async listMeshes(): Promise<{ meshes: MeshMetadata[] }> {
    const meshes: MeshMetadata[] = [];

    try {
      const entries = await fs.readdir(this.meshesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const meshName = entry.name;
        const meshPath = path.join(this.meshesDir, meshName);

        // Check for config.yaml or config.json
        const yamlPath = path.join(meshPath, 'config.yaml');
        const jsonPath = path.join(meshPath, 'config.json');

        let configPath: string;
        let configType: 'yaml' | 'json';

        if (await YAMLHandler.exists(yamlPath)) {
          configPath = yamlPath;
          configType = 'yaml';
        } else if (await YAMLHandler.exists(jsonPath)) {
          configPath = jsonPath;
          configType = 'json';
        } else {
          // No config file found, skip this directory
          log.debug('mesh-controller', `Skipping ${meshName}: no config file found`);
          continue;
        }

        try {
          // Parse the config file
          let config: MeshConfigSchema;
          if (configType === 'yaml') {
            config = await YAMLHandler.readYAML<MeshConfigSchema>(configPath);
          } else {
            const content = await fs.readFile(configPath, 'utf-8');
            config = JSON.parse(content) as MeshConfigSchema;
          }

          meshes.push({
            name: meshName,
            path: `meshes/${meshName}`,
            description: config.description || '',
            agents: Array.isArray(config.agents) ? config.agents.length : 0,
            configType,
          });
        } catch (error) {
          // Log parse error but continue with other meshes
          const errMsg = error instanceof Error ? error.message : String(error);
          log.warn('mesh-controller', `Failed to parse config for mesh ${meshName}`, { error: errMsg });
        }
      }

      // Sort by name
      meshes.sort((a, b) => a.name.localeCompare(b.name));

      return { meshes };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('mesh-controller', 'Failed to list meshes', { error: errMsg });
      throw new Error(`Failed to list meshes: ${errMsg}`);
    }
  }

  /**
   * Get a specific mesh config
   *
   * @param name - Mesh name
   * @returns Mesh data including config, raw content, and config type
   */
  async getMesh(name: string): Promise<MeshData> {
    const meshPath = path.join(this.meshesDir, name);

    // Check for config.yaml or config.json
    const yamlPath = path.join(meshPath, 'config.yaml');
    const jsonPath = path.join(meshPath, 'config.json');

    let configPath: string;
    let configType: 'yaml' | 'json';

    if (await YAMLHandler.exists(yamlPath)) {
      configPath = yamlPath;
      configType = 'yaml';
    } else if (await YAMLHandler.exists(jsonPath)) {
      configPath = jsonPath;
      configType = 'json';
    } else {
      throw new MeshNotFoundError(name);
    }

    try {
      // Read raw content
      const raw = await YAMLHandler.readRaw(configPath);

      // Parse config
      let config: MeshConfigSchema;
      if (configType === 'yaml') {
        config = YAMLHandler.parseYAML<MeshConfigSchema>(raw);
      } else {
        config = JSON.parse(raw) as MeshConfigSchema;
      }

      // Validate the config
      const validation = MeshValidator.validate(config, `${name}/config.${configType}`);
      if (validation.warnings.length > 0) {
        log.debug('mesh-controller', `Mesh ${name} has validation warnings`, { warnings: validation.warnings });
      }

      return {
        name,
        config,
        raw,
        configType,
      };
    } catch (error) {
      if (error instanceof MeshNotFoundError) throw error;
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('mesh-controller', `Failed to get mesh ${name}`, { error: errMsg });
      throw new Error(`Failed to get mesh: ${errMsg}`);
    }
  }

  /**
   * Update a mesh config
   *
   * Validates the config before writing. Uses atomic writes to prevent corruption.
   *
   * @param name - Mesh name
   * @param data - Update request with config and format
   * @returns Update response with success status and any errors/warnings
   */
  async updateMesh(name: string, data: UpdateMeshRequest): Promise<UpdateMeshResponse> {
    const meshPath = path.join(this.meshesDir, name);

    // Check mesh directory exists
    try {
      await fs.access(meshPath);
    } catch {
      throw new MeshNotFoundError(name);
    }

    // Validate the config first
    const validation = MeshValidator.validate(data.config, `${name}/config.${data.format}`);

    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }

    // Determine config file path
    const configPath = path.join(meshPath, `config.${data.format}`);

    try {
      // Write the config (atomic write)
      if (data.format === 'yaml') {
        await YAMLHandler.writeYAML(configPath, data.config);
      } else {
        // For JSON, also use atomic write
        const jsonContent = JSON.stringify(data.config, null, 2);
        const tmpPath = `${configPath}.tmp`;
        await fs.writeFile(tmpPath, jsonContent, 'utf-8');
        await fs.rename(tmpPath, configPath);
      }

      log.info('mesh-controller', `Updated mesh ${name}`, { format: data.format });

      return {
        success: true,
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('mesh-controller', `Failed to update mesh ${name}`, { error: errMsg });
      throw new Error(`Failed to update mesh: ${errMsg}`);
    }
  }

  /**
   * Validate a mesh config without saving
   *
   * @param name - Mesh name (for context in error messages)
   * @param config - Mesh config to validate
   * @returns Validation response
   */
  async validateMesh(name: string, config: MeshConfigSchema): Promise<ValidateMeshResponse> {
    try {
      const validation = MeshValidator.validate(config, name);

      return {
        valid: validation.valid,
        errors: validation.errors.length > 0 ? validation.errors : undefined,
        warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('mesh-controller', `Validation error for mesh ${name}`, { error: errMsg });
      return {
        valid: false,
        errors: [errMsg],
      };
    }
  }
}

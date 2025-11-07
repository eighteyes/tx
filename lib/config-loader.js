const fs = require('fs-extra');
const path = require('path');
const { TX_ROOT } = require('./paths');
const { Logger } = require('./logger');
const { AgentPath } = require('./utils/agent-path');

/**
 * ConfigLoader
 *
 * Centralized configuration loading with caching and validation.
 * Eliminates duplicate disk reads and provides consistent error handling.
 */
class ConfigLoader {
  static meshCache = new Map();
  static agentCache = new Map();
  static mainConfig = null;

  /**
   * Load mesh configuration
   * @param {string} meshName - Mesh name (e.g., "core", "brain")
   * @param {object} options - Options
   * @param {boolean} options.skipCache - Skip cache and reload from disk
   * @returns {object} Mesh configuration object
   * @throws {Error} If config doesn't exist or is invalid JSON
   */
  static loadMeshConfig(meshName, options = {}) {
    const cacheKey = meshName;

    // Check cache unless skipCache is true
    if (!options.skipCache && ConfigLoader.meshCache.has(cacheKey)) {
      return ConfigLoader.meshCache.get(cacheKey);
    }

    const configPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${meshName}.json`);

    if (!fs.existsSync(configPath)) {
      throw new Error(`Mesh config not found: ${configPath}`);
    }

    try {
      const config = fs.readJsonSync(configPath);

      // Cache the config
      ConfigLoader.meshCache.set(cacheKey, config);

      return config;
    } catch (error) {
      throw new Error(`Failed to load mesh config '${meshName}': ${error.message}`);
    }
  }

  /**
   * Load agent configuration
   * @param {string} agentSpec - Agent spec (e.g., "core" or "category/agent")
   * @param {object} options - Options
   * @param {boolean} options.skipCache - Skip cache and reload from disk
   * @returns {object} Agent configuration object
   * @throws {Error} If config doesn't exist or is invalid JSON
   */
  static loadAgentConfig(agentSpec, options = {}) {
    const cacheKey = agentSpec;

    // Check cache unless skipCache is true
    if (!options.skipCache && ConfigLoader.agentCache.has(cacheKey)) {
      return ConfigLoader.agentCache.get(cacheKey);
    }

    const configPath = path.join(TX_ROOT, 'meshes/agents', agentSpec, 'config.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(`Agent config not found: ${configPath}`);
    }

    try {
      const config = fs.readJsonSync(configPath);

      // Cache the config
      ConfigLoader.agentCache.set(cacheKey, config);

      return config;
    } catch (error) {
      throw new Error(`Failed to load agent config '${agentSpec}': ${error.message}`);
    }
  }

  /**
   * Check if mesh is persistent
   * @param {string} meshName - Mesh name
   * @returns {boolean} True if persistent, false otherwise
   */
  static isPersistent(meshName) {
    try {
      const config = ConfigLoader.loadMeshConfig(meshName);
      return config.type === 'persistent';
    } catch (error) {
      Logger.warn('config-loader', `Failed to check persistence for mesh '${meshName}': ${error.message}`);
      return false;
    }
  }

  /**
   * Get list of agents from mesh config
   * @param {string} meshName - Mesh name
   * @returns {string[]} Array of agent specs (e.g., ["core"] or ["category/agent"])
   */
  static getMeshAgents(meshName) {
    const config = ConfigLoader.loadMeshConfig(meshName);
    return config.agents || [];
  }

  /**
   * Find full agent path from mesh config given agent name
   * @param {string} meshName - Mesh name
   * @param {string} agentName - Agent name (without category)
   * @returns {string|null} Full agent path or null if not found
   *
   * @example
   * // mesh config has agents: ["editorial/reviewer"]
   * ConfigLoader.findAgentPath('prompt-editor', 'reviewer') // => 'editorial/reviewer'
   */
  static findAgentPath(meshName, agentName) {
    const config = ConfigLoader.loadMeshConfig(meshName);

    if (!config.agents) {
      return null;
    }

    const fullAgentPath = config.agents.find(a => {
      const agentPart = AgentPath.extractName(a);
      return agentPart === agentName;
    });

    return fullAgentPath || null;
  }

  /**
   * Get agent names from mesh config (extracted from full paths)
   * @param {string} meshName - Mesh name
   * @returns {string[]} Array of agent names
   *
   * @example
   * // mesh config has agents: ["editorial/reviewer", "core"]
   * ConfigLoader.getMeshAgentNames('prompt-editor') // => ['reviewer', 'core']
   */
  static getMeshAgentNames(meshName) {
    const agents = ConfigLoader.getMeshAgents(meshName);
    return agents.map(a => AgentPath.extractName(a));
  }

  /**
   * Get mesh description
   * @param {string} meshName - Mesh name
   * @returns {string} Description or empty string
   */
  static getMeshDescription(meshName) {
    try {
      const config = ConfigLoader.loadMeshConfig(meshName);
      return config.description || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Get mesh routing configuration
   * @param {string} meshName - Mesh name
   * @returns {object} Routing config or empty object
   */
  static getMeshRouting(meshName) {
    try {
      const config = ConfigLoader.loadMeshConfig(meshName);
      return config.routing || {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Clear all caches (useful for testing or hot reload)
   */
  static clearCache() {
    ConfigLoader.meshCache.clear();
    ConfigLoader.agentCache.clear();
    ConfigLoader.mainConfig = null;
  }

  /**
   * Clear specific mesh config from cache
   * @param {string} meshName - Mesh name
   */
  static clearMeshCache(meshName) {
    ConfigLoader.meshCache.delete(meshName);
  }

  /**
   * Clear specific agent config from cache
   * @param {string} agentSpec - Agent spec
   */
  static clearAgentCache(agentSpec) {
    ConfigLoader.agentCache.delete(agentSpec);
  }

  /**
   * Load main configuration file (config.json in project root)
   * @param {object} options - Options
   * @param {boolean} options.skipCache - Skip cache and reload from disk
   * @returns {object} Main configuration object
   */
  static loadMainConfig(options = {}) {
    // Check cache unless skipCache is true
    if (!options.skipCache && ConfigLoader.mainConfig !== null) {
      return ConfigLoader.mainConfig;
    }

    const configPath = path.join(TX_ROOT, 'config.json');

    // Return default config if file doesn't exist
    if (!fs.existsSync(configPath)) {
      const defaultConfig = { beta: { retry_queue: true } };
      ConfigLoader.mainConfig = defaultConfig;
      return defaultConfig;
    }

    try {
      const config = fs.readJsonSync(configPath);
      ConfigLoader.mainConfig = config;
      return config;
    } catch (error) {
      Logger.warn('config-loader', `Failed to load config.json: ${error.message}, using defaults`);
      const defaultConfig = { beta: { retry_queue: true } };
      ConfigLoader.mainConfig = defaultConfig;
      return defaultConfig;
    }
  }

  /**
   * Check if a feature flag is enabled
   * @param {string} flagPath - Dot-separated path to flag (e.g., "beta.retry_queue")
   * @returns {boolean} True if enabled, false otherwise
   */
  static isFeatureEnabled(flagPath) {
    const config = ConfigLoader.loadMainConfig();
    const parts = flagPath.split('.');

    let current = config;
    for (const part of parts) {
      if (current[part] === undefined) {
        return false;
      }
      current = current[part];
    }

    return current === true;
  }

  /**
   * Clear main config cache
   */
  static clearMainConfigCache() {
    ConfigLoader.mainConfig = null;
  }
}

module.exports = { ConfigLoader };

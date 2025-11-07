const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { PATHS, TX_ROOT } = require('./paths');
const { RearmatterSchema } = require('./rearmatter-schema');
const { AgentPath } = require('./utils/agent-path');

/**
 * System Validator
 *
 * Validates mesh configs, agent configs, and system state before startup.
 * Records evidence of validation failures for forensic analysis.
 */
class Validator {
  /**
   * Validate a single agent configuration
   *
   * @param {string} agentSpec - Agent spec (e.g., "core" or "category/agent")
   * @param {string} configPath - Path to agent config file
   * @returns {object} Validation result with errors and warnings arrays
   */
  static validateAgentConfig(agentSpec, configPath) {
    const errors = [];
    const warnings = [];

    // Known fields based on actual code usage
    const KNOWN_AGENT_FIELDS = {
      name: { type: 'string', required: true },
      description: { type: 'string' },
      orchestrator: { type: 'boolean' },
      capabilities: { type: 'array' },
      options: { type: 'object' },
      rearmatter: { type: 'object' } // Per-agent rearmatter override
    };

    const KNOWN_OPTION_FIELDS = {
      model: { type: 'string', enum: ['sonnet', 'opus', 'haiku'] }
    };

    try {
      // Parse config
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (parseError) {
        errors.push(`Failed to parse config: ${parseError.message}`);
        return { valid: false, errors, warnings };
      }

      // Extract expected agent name
      const expectedName = AgentPath.extractName(agentSpec);

      // Validate required fields
      if (!config.name) {
        errors.push('Missing required field: name');
      } else if (config.name !== expectedName) {
        warnings.push(`Name mismatch: config says '${config.name}' but should be '${expectedName}'`);
      }

      // Check for unknown fields
      Object.keys(config).forEach(field => {
        if (!KNOWN_AGENT_FIELDS[field]) {
          warnings.push(`Unknown field '${field}' (may be typo or unused)`);
        }
      });

      // Validate field types
      Object.entries(KNOWN_AGENT_FIELDS).forEach(([field, spec]) => {
        if (config[field] === undefined) {
          return; // Skip undefined optional fields
        }

        const value = config[field];
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (spec.type !== actualType) {
          warnings.push(`Field '${field}' should be ${spec.type}, got ${actualType}`);
        }
      });

      // Validate options if present
      if (config.options) {
        Object.keys(config.options).forEach(field => {
          if (!KNOWN_OPTION_FIELDS[field]) {
            warnings.push(`Unknown options field '${field}' (may be typo or unused)`);
          }
        });

        Object.entries(KNOWN_OPTION_FIELDS).forEach(([field, spec]) => {
          if (config.options[field] === undefined) {
            return;
          }

          const value = config.options[field];
          const actualType = Array.isArray(value) ? 'array' : typeof value;

          if (spec.type !== actualType) {
            warnings.push(`options.${field} should be ${spec.type}, got ${actualType}`);
          }

          // Check enum values
          if (spec.enum && !spec.enum.includes(value)) {
            warnings.push(`options.${field} must be one of [${spec.enum.join(', ')}], got '${value}'`);
          }
        });
      }

      // Validate rearmatter configuration if present (per-agent override)
      if (config.rearmatter) {
        const rearmatterResult = Validator.validateRearmatterConfig(config.rearmatter);
        rearmatterResult.errors.forEach(err => errors.push(`rearmatter: ${err}`));
        rearmatterResult.warnings.forEach(warn => warnings.push(`rearmatter: ${warn}`));
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      errors.push(`Unexpected error: ${error.message}`);
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Validate rearmatter configuration
   *
   * @param {object} rearmatterConfig - Rearmatter configuration object
   * @returns {object} Validation result with errors and warnings arrays
   */
  static validateRearmatterConfig(rearmatterConfig) {
    const errors = [];
    const warnings = [];

    const VALID_FIELDS = ['grade', 'confidence', 'speculation', 'gaps', 'assumptions'];
    const KNOWN_CONFIG_FIELDS = {
      enabled: { type: 'boolean' },
      fields: { type: 'array' },
      thresholds: { type: 'object' }
    };

    // Check for unknown fields
    Object.keys(rearmatterConfig).forEach(field => {
      if (!KNOWN_CONFIG_FIELDS[field]) {
        warnings.push(`Unknown rearmatter config field '${field}'`);
      }
    });

    // Validate enabled field
    if (rearmatterConfig.enabled !== undefined) {
      if (typeof rearmatterConfig.enabled !== 'boolean') {
        errors.push('rearmatter.enabled must be a boolean');
      }
    }

    // Validate fields array
    if (rearmatterConfig.fields !== undefined) {
      if (!Array.isArray(rearmatterConfig.fields)) {
        errors.push('rearmatter.fields must be an array');
      } else {
        rearmatterConfig.fields.forEach(field => {
          if (typeof field !== 'string') {
            errors.push(`rearmatter.fields contains non-string value: ${field}`);
          } else if (!VALID_FIELDS.includes(field)) {
            warnings.push(`Unknown rearmatter field '${field}' (valid: ${VALID_FIELDS.join(', ')})`);
          }
        });
      }
    }

    // Validate thresholds
    if (rearmatterConfig.thresholds !== undefined) {
      if (typeof rearmatterConfig.thresholds !== 'object' || rearmatterConfig.thresholds === null) {
        errors.push('rearmatter.thresholds must be an object');
      } else {
        // Validate confidence threshold
        if (rearmatterConfig.thresholds.confidence !== undefined) {
          const conf = rearmatterConfig.thresholds.confidence;
          if (typeof conf !== 'number') {
            errors.push('rearmatter.thresholds.confidence must be a number');
          } else if (conf < 0 || conf > 1) {
            errors.push('rearmatter.thresholds.confidence must be between 0.0 and 1.0');
          }
        }

        // Validate grade threshold
        if (rearmatterConfig.thresholds.grade !== undefined) {
          const grade = rearmatterConfig.thresholds.grade;
          if (typeof grade !== 'string') {
            errors.push('rearmatter.thresholds.grade must be a string');
          } else if (!RearmatterSchema.GRADES.includes(grade.toUpperCase())) {
            errors.push(`rearmatter.thresholds.grade must be one of [${RearmatterSchema.GRADES.join(', ')}]`);
          }
        }

        // Check for unknown threshold fields
        Object.keys(rearmatterConfig.thresholds).forEach(field => {
          if (field !== 'confidence' && field !== 'grade') {
            warnings.push(`Unknown rearmatter threshold field '${field}'`);
          }
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate a single mesh configuration
   *
   * @param {string} meshName - Name of the mesh to validate
   * @returns {object} Validation result with errors array
   */
  static validateMeshConfig(meshName) {
    const errors = [];
    const warnings = [];

    // Known fields based on actual code usage
    const KNOWN_FIELDS = {
      // Required fields
      mesh: { type: 'string', required: true },
      agents: { type: 'array', required: true },

      // Optional fields (actually used by code)
      type: { type: 'string', enum: ['persistent', 'ephemeral'] },
      description: { type: 'string' },
      entry_point: { type: 'string' },
      routing: { type: 'object' },
      frontmatter: { type: 'object' },
      brain: { type: 'boolean' },
      capabilities: { type: 'array' }, // Copied to agent configs
      rearmatter: { type: 'object' }, // Transparency metadata configuration
      completion_agent: { type: 'string' }, // Agent that should send task-complete message
      'clear-before': { type: 'boolean' }, // Reset session before each task delivery

      // Informational only (not used by code but allowed)
      workflow_topology: { type: 'string', informational: true }
    };

    const KNOWN_FRONTMATTER_FIELDS = {
      'self-modify': { type: 'boolean' },
      'max-iterations': { type: 'number' },
      lens: { type: 'array' }
    };

    try {
      const configPath = path.join(TX_ROOT, 'meshes/mesh-configs', `${meshName}.json`);

      // Check if config exists
      if (!fs.existsSync(configPath)) {
        const error = `Mesh config not found: ${configPath}`;
        errors.push(error);

        return { valid: false, errors, warnings };
      }

      // Parse config
      let config;
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (parseError) {
        const error = `Failed to parse mesh config: ${parseError.message}`;
        errors.push(error);

        return { valid: false, errors, warnings };
      }

      // Validate required fields
      if (!config.mesh) {
        errors.push('Missing required field: mesh');
      } else if (config.mesh !== meshName) {
        errors.push(`Mesh name mismatch: config says '${config.mesh}' but file is '${meshName}.json'`);
      }

      if (!config.agents || !Array.isArray(config.agents)) {
        errors.push('Missing or invalid field: agents (must be array)');
      } else if (config.agents.length === 0) {
        errors.push('Agents array is empty');
      }

      // Schema validation: check for unknown fields
      Object.keys(config).forEach(field => {
        if (!KNOWN_FIELDS[field]) {
          warnings.push(`Unknown field '${field}' (may be typo or unused)`);
        }
      });

      // Validate field types and values (warnings only - don't block start)
      Object.entries(KNOWN_FIELDS).forEach(([field, spec]) => {
        if (config[field] === undefined) {
          return; // Skip undefined optional fields
        }

        const value = config[field];
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (spec.type !== actualType) {
          warnings.push(`Field '${field}' should be ${spec.type}, got ${actualType}`);
        }

        // Check enum values
        if (spec.enum && !spec.enum.includes(value)) {
          warnings.push(`Field '${field}' must be one of [${spec.enum.join(', ')}], got '${value}'`);
        }

        // Warn about informational fields
        if (spec.informational) {
          warnings.push(`Field '${field}' is informational only (not used by code)`);
        }
      });

      // Validate frontmatter if present
      if (config.frontmatter) {
        Object.keys(config.frontmatter).forEach(field => {
          if (!KNOWN_FRONTMATTER_FIELDS[field]) {
            warnings.push(`Unknown frontmatter field '${field}' (may be typo or unused)`);
          }
        });

        Object.entries(KNOWN_FRONTMATTER_FIELDS).forEach(([field, spec]) => {
          if (config.frontmatter[field] === undefined) {
            return;
          }

          const value = config.frontmatter[field];
          const actualType = Array.isArray(value) ? 'array' : typeof value;

          if (spec.type !== actualType) {
            warnings.push(`frontmatter.${field} should be ${spec.type}, got ${actualType}`);
          }
        });
      }

      // Validate rearmatter configuration if present
      if (config.rearmatter) {
        const rearmatterResult = Validator.validateRearmatterConfig(config.rearmatter);
        errors.push(...rearmatterResult.errors);
        warnings.push(...rearmatterResult.warnings);
      }

      // Validate entry_point if present
      if (config.entry_point) {
        const hasEntryPoint = config.agents.some(agent => {
          if (agent.includes('/')) {
            return agent.split('/')[1] === config.entry_point;
          }
          return agent === config.entry_point;
        });

        if (!hasEntryPoint) {
          warnings.push(`entry_point '${config.entry_point}' not found in agents array`);
        }
      } else {
        // No entry_point - will use first agent
        warnings.push('No entry_point specified, will use first agent in array');
      }

      // Validate agent configs exist and are valid
      if (config.agents) {
        config.agents.forEach(agentSpec => {
          // Construct path: both "agent" and "category/agent" formats use same pattern
          const agentConfigPath = path.join(TX_ROOT, 'meshes/agents', agentSpec, 'config.json');

          // Extract agent name for evidence (get last part after slash if present)
          const agentName = AgentPath.extractName(agentSpec);

          if (!fs.existsSync(agentConfigPath)) {
            errors.push(`Agent config not found: ${agentConfigPath}`);
          } else {
            // Validate agent config schema
            const agentValidation = Validator.validateAgentConfig(agentSpec, agentConfigPath);
            agentValidation.errors.forEach(err => errors.push(`${agentSpec}: ${err}`));
            agentValidation.warnings.forEach(warn => warnings.push(`${agentSpec}: ${warn}`));
          }
        });
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        config
      };
    } catch (error) {
      const errorMsg = `Unexpected error validating mesh '${meshName}': ${error.message}`;
      errors.push(errorMsg);

      return { valid: false, errors, warnings };
    }
  }

  /**
   * Validate all mesh configs
   *
   * @returns {object} Validation results for all meshes
   */
  static validateAllMeshConfigs() {
    const results = {
      valid: true,
      meshes: {},
      totalErrors: 0,
      totalWarnings: 0
    };

    try {
      const meshConfigsDir = path.join(TX_ROOT, 'meshes/mesh-configs');

      if (!fs.existsSync(meshConfigsDir)) {
        Logger.error('validator', 'Mesh configs directory not found', { meshConfigsDir });
        results.valid = false;
        return results;
      }

      const configFiles = fs.readdirSync(meshConfigsDir).filter(f => f.endsWith('.json'));

      configFiles.forEach(configFile => {
        const meshName = configFile.replace('.json', '');
        const result = Validator.validateMeshConfig(meshName);

        results.meshes[meshName] = result;
        results.totalErrors += result.errors.length;
        results.totalWarnings += result.warnings.length;

        if (!result.valid) {
          results.valid = false;
        }
      });

      return results;
    } catch (error) {
      Logger.error('validator', `Failed to validate mesh configs: ${error.message}`, {
        error: error.stack
      });

      results.valid = false;
      return results;
    }
  }

  /**
   * Validate system directories
   *
   * @returns {object} Validation result
   */
  static validateDirectories() {
    const errors = [];
    const warnings = [];

    const requiredDirs = [
      '.ai/tx/logs',
      '.ai/tx/mesh',
      path.join(TX_ROOT, 'meshes/mesh-configs'),
      path.join(TX_ROOT, 'meshes/agents')
    ];

    requiredDirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        warnings.push(`Directory missing (will be created): ${dir}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Check for orphaned messages in the system
   *
   * @returns {object} Orphaned messages found
   */
  static checkOrphanedMessages() {
    const orphans = [];

    try {
      const meshesDir = '.ai/tx/mesh';

      if (!fs.existsSync(meshesDir)) {
        return { orphans };
      }

      const meshes = fs.readdirSync(meshesDir);

      meshes.forEach(mesh => {
        const activeDir = path.join(meshesDir, mesh, 'msgs', 'active');

        if (fs.existsSync(activeDir)) {
          const activeFiles = fs.readdirSync(activeDir).filter(f => f.endsWith('.md'));

          activeFiles.forEach(file => {
            orphans.push({
              mesh,
              file,
              path: path.join(activeDir, file),
              queue: 'active'
            });
          });
        }

        // Check agent active queues
        const agentsDir = path.join(meshesDir, mesh, 'agents');

        if (fs.existsSync(agentsDir)) {
          const agents = fs.readdirSync(agentsDir);

          agents.forEach(agent => {
            const agentActiveDir = path.join(agentsDir, agent, 'msgs', 'active');

            if (fs.existsSync(agentActiveDir)) {
              const activeFiles = fs.readdirSync(agentActiveDir).filter(f => f.endsWith('.md'));

              activeFiles.forEach(file => {
                orphans.push({
                  mesh,
                  agent,
                  file,
                  path: path.join(agentActiveDir, file),
                  queue: 'agent-active'
                });
              });
            }
          });
        }
      });

      if (orphans.length > 0) {
        Logger.warn('validator', `Found ${orphans.length} orphaned messages in active queues`, {
          count: orphans.length,
          orphans
        });
      }

      return { orphans };
    } catch (error) {
      Logger.error('validator', `Failed to check orphaned messages: ${error.message}`, {
        error: error.stack
      });

      return { orphans };
    }
  }

  /**
   * Run full system validation
   *
   * @returns {object} Complete validation results
   */
  static validateSystem() {
    console.log('🔍 Validating system...\n');

    const results = {
      valid: true,
      directories: Validator.validateDirectories(),
      meshConfigs: Validator.validateAllMeshConfigs(),
      orphanedMessages: Validator.checkOrphanedMessages()
    };

    // Print results
    console.log('📁 Directory validation:');
    if (results.directories.warnings.length > 0) {
      results.directories.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
    }
    if (results.directories.errors.length > 0) {
      results.directories.errors.forEach(e => console.log(`  ❌ ${e}`));
      results.valid = false;
    }
    if (results.directories.valid && results.directories.warnings.length === 0) {
      console.log('  ✅ All required directories exist');
    }

    console.log('\n📋 Mesh config validation:');
    Object.entries(results.meshConfigs.meshes).forEach(([mesh, result]) => {
      if (result.valid) {
        console.log(`  ✅ ${mesh}`);
        if (result.warnings.length > 0) {
          result.warnings.forEach(w => console.log(`     ⚠️  ${w}`));
        }
      } else {
        console.log(`  ❌ ${mesh}`);
        result.errors.forEach(e => console.log(`     • ${e}`));
        results.valid = false;
      }
    });

    if (results.meshConfigs.totalWarnings > 0) {
      console.log(`\n⚠️  Total warnings: ${results.meshConfigs.totalWarnings}`);
    }

    if (results.orphanedMessages.orphans.length > 0) {
      console.log(`\n⚠️  Found ${results.orphanedMessages.orphans.length} orphaned messages in active queues`);
      console.log('   These messages may be from previous sessions that crashed');
    }

    console.log('');

    return results;
  }
}

module.exports = { Validator };

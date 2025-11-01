const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { PATHS, TX_ROOT } = require('./paths');

/**
 * System Validator
 *
 * Validates mesh configs, agent configs, and system state before startup.
 * Records evidence of validation failures for forensic analysis.
 */
class Validator {
  /**
   * Validate a single mesh configuration
   *
   * @param {string} meshName - Name of the mesh to validate
   * @returns {object} Validation result with errors array
   */
  static validateMeshConfig(meshName) {
    const errors = [];
    const warnings = [];

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

      // Validate agent configs exist
      if (config.agents) {
        config.agents.forEach(agentSpec => {
          // Construct path: both "agent" and "category/agent" formats use same pattern
          const agentConfigPath = path.join(TX_ROOT, 'meshes/agents', agentSpec, 'config.json');

          // Extract agent name for evidence (get last part after slash if present)
          const agentName = agentSpec.includes('/') ? agentSpec.split('/').pop() : agentSpec;

          if (!fs.existsSync(agentConfigPath)) {
            errors.push(`Agent config not found: ${agentConfigPath}`);
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

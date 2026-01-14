/**
 * validate-mesh - Validate mesh configuration files
 *
 * Responsibilities:
 * - Load mesh config from file or directory
 * - Run MeshValidator against config
 * - Report errors and warnings with clear formatting
 * - Exit with appropriate code for CI/automation
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { MeshValidator } from '../worker/mesh-validator.ts';
import { colors } from '../shared/colors.ts';

interface ValidateOptions {
  strict?: boolean;  // Treat warnings as errors
}

export async function validateMesh(meshNameOrPath: string, options: ValidateOptions = {}): Promise<void> {
  const workDir = process.env.TX_CWD || process.cwd();

  // Resolve mesh path
  let configPath: string;
  if (meshNameOrPath.endsWith('.yaml') || meshNameOrPath.endsWith('.yml')) {
    // Direct path to config file
    configPath = path.resolve(workDir, meshNameOrPath);
  } else {
    // Mesh name - look in meshes directory
    configPath = path.join(workDir, 'meshes', meshNameOrPath, 'config.yaml');
    if (!fs.existsSync(configPath)) {
      configPath = path.join(workDir, 'meshes', meshNameOrPath, 'config.yml');
    }
  }

  // Check if file exists
  if (!fs.existsSync(configPath)) {
    console.error(`${colors.red}✗${colors.reset} Config file not found: ${configPath}`);
    console.error(`${colors.dim}Usage: tx validate-mesh <mesh-name> or tx validate-mesh <path/to/config.yaml>${colors.reset}`);
    process.exit(1);
  }

  // Load and parse config
  let config: unknown;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const isYaml = configPath.endsWith('.yaml') || configPath.endsWith('.yml');
    config = isYaml ? YAML.parse(content) : JSON.parse(content);
  } catch (error) {
    console.error(`${colors.red}✗${colors.reset} Failed to parse config file`);
    console.error(`${colors.dim}${(error as Error).message}${colors.reset}`);
    process.exit(1);
  }

  // Validate
  const filename = path.basename(configPath);
  const result = MeshValidator.validate(config, filename);

  // Display results
  console.log(`\n${colors.bright}Mesh Validation: ${(config as any).mesh || 'unknown'}${colors.reset}`);
  console.log(`${colors.dim}Config: ${configPath}${colors.reset}\n`);

  if (result.valid && result.warnings.length === 0) {
    console.log(`${colors.green}✓${colors.reset} ${colors.bright}Valid${colors.reset} - No errors or warnings\n`);
    process.exit(0);
  }

  // Show errors
  if (result.errors.length > 0) {
    console.log(`${colors.red}✗ Errors (${result.errors.length})${colors.reset}`);
    for (const error of result.errors) {
      console.log(`  ${colors.red}•${colors.reset} ${error}`);
    }
    console.log();
  }

  // Show warnings
  if (result.warnings.length > 0) {
    const warningColor = options.strict ? colors.red : colors.yellow;
    const warningLabel = options.strict ? 'Errors (strict mode)' : 'Warnings';
    console.log(`${warningColor}⚠ ${warningLabel} (${result.warnings.length})${colors.reset}`);
    for (const warning of result.warnings) {
      console.log(`  ${warningColor}•${colors.reset} ${warning}`);
    }
    console.log();
  }

  // Summary
  if (!result.valid) {
    console.log(`${colors.red}✗ Validation failed${colors.reset}`);
    console.log(`${colors.dim}Fix the errors above before using this mesh${colors.reset}\n`);
    process.exit(1);
  } else if (options.strict && result.warnings.length > 0) {
    console.log(`${colors.red}✗ Validation failed (strict mode)${colors.reset}`);
    console.log(`${colors.dim}Warnings are treated as errors in strict mode${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}✓ Valid${colors.reset} ${colors.dim}(with warnings)${colors.reset}\n`);
    process.exit(0);
  }
}

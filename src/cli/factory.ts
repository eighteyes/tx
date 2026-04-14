/**
 * factory - CLI command for capability-driven mesh generation
 *
 * Reads a capabilities YAML file, routes against the mesh catalog for an
 * existing match, and falls back to the factory compiler when none is found.
 *
 * Responsibilities:
 * - Parse capability YAML input with flexible key support
 * - Validate capability declarations against schema enums
 * - Load mesh catalog from existing meshes directory
 * - Route against catalog, fall back to MeshFactory compile
 * - Provide testable core logic (runFactory) and CLI entry point (factory)
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { log } from '../shared/logger.ts';
import { isValidCapability, hashCapability, type CapabilityNeeded } from '../mesh/capability/schema.ts';
import { findBestMesh, type CatalogEntry } from '../mesh/capability/router.ts';
import { MeshFactory } from '../mesh/capability/factory.ts';
import { isPlanDirectory, deriveCapabilitiesFromPlan, getCachedCapabilities } from '../mesh/capability/plan-deriver.ts';

/** Base directory for factory-generated meshes. */
const GENERATED_MESHES_DIR = '.ai/tx/generated-meshes';

/** Archive directory — preserves compiled meshes with provenance. */
const ARCHIVED_MESHES_DIR = '.ai/tx/archived-meshes';

export interface FactoryOptions {
  inputFile?: string;
  planDir?: string;
  outputDir?: string;
  fragmentsDir: string;
  catalogDir?: string;
  run?: string;
}

export interface FactoryResult {
  success: boolean;
  matched?: string;
  generated?: string;
  reused?: boolean;
  meshName?: string;
  errors: string[];
}

/**
 * Load catalog entries from a meshes directory.
 *
 * Scans subdirectories for config.yaml files with valid capability blocks.
 */
export function loadCatalog(catalogDir: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  if (!fs.existsSync(catalogDir)) return entries;

  const dirs = fs.readdirSync(catalogDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const configPath = path.join(catalogDir, dir.name, 'config.yaml');
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = YAML.parse(raw);
      if (parsed?.capability && isValidCapability(parsed.capability)) {
        entries.push({
          name: dir.name,
          capability: parsed.capability,
        });
      }
    } catch {
      // Skip unparseable configs
    }
  }

  return entries;
}

/**
 * Extract capability block from parsed YAML.
 *
 * Supports keys: `capability`, `capabilities_needed`, or root-level fields.
 */
function extractCapability(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.capability) return obj.capability;
  if (obj.capabilities_needed) return obj.capabilities_needed;

  // Check if root level has domain/input/output (root-level capability)
  if (obj.domain && obj.input && obj.output) return obj;

  return null;
}

/**
 * Parse a capabilities YAML file into a CapabilityNeeded object.
 */
function parseCapabilityFile(inputFile: string): { success: boolean; needed?: CapabilityNeeded; errors: string[] } {
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(inputFile, 'utf-8');
  } catch (err) {
    const msg = `Failed to read input file: ${inputFile}`;
    log.error('factory', msg, { error: String(err) });
    return { success: false, errors: [msg] };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(rawYaml);
  } catch (err) {
    const msg = `Failed to parse YAML: ${String(err)}`;
    log.error('factory', msg);
    return { success: false, errors: [msg] };
  }

  const capBlock = extractCapability(parsed);
  if (!capBlock) {
    return { success: false, errors: ['No capability block found in input file'] };
  }

  if (!isValidCapability(capBlock)) {
    return { success: false, errors: ['Capability block failed validation — check enum values'] };
  }

  const capObj = capBlock as Record<string, unknown>;
  return {
    success: true,
    needed: {
      domain: capObj.domain as CapabilityNeeded['domain'],
      input: capObj.input as CapabilityNeeded['input'],
      output: capObj.output as CapabilityNeeded['output'],
      tools: (capObj.tools as CapabilityNeeded['tools']) ?? [],
      interaction: capObj.interaction as CapabilityNeeded['interaction'],
      topology: (capObj.topology as CapabilityNeeded['topology']) ?? 'static',
    },
    errors: [],
  };
}

/**
 * Core factory pipeline — testable without CLI concerns.
 * Accepts either a capabilities YAML file or a plan directory.
 */
export async function runFactory(options: FactoryOptions): Promise<FactoryResult> {
  const { inputFile, planDir, fragmentsDir, catalogDir } = options;

  let needed: CapabilityNeeded;

  // Two input modes: capabilities file or plan directory
  if (planDir) {
    const derived = await deriveCapabilitiesFromPlan(planDir);
    if (!derived) {
      return { success: false, errors: ['Failed to derive capabilities from plan — check plan.md/tasks.md exist and LLM is available'] };
    }
    needed = derived;
  } else if (inputFile) {
    const result = parseCapabilityFile(inputFile);
    if (!result.success) return { success: false, errors: result.errors };
    needed = result.needed!;
  } else {
    return { success: false, errors: ['Either inputFile or planDir is required'] };
  }

  // Catalog match attempt
  if (catalogDir) {
    const catalog = loadCatalog(catalogDir);
    if (catalog.length > 0) {
      const match = findBestMesh(catalog, needed);
      if (match) {
        log.info('factory', `Matched existing mesh: ${match.name}`);
        return { success: true, matched: match.name, meshName: match.name, errors: [] };
      }
    }
  }

  // No match — resolve output directory (hash-based default enables reuse)
  const capHash = hashCapability(needed);
  const meshName = needed.domain.join('-') + '-mesh';
  const outputDir = options.outputDir ?? path.resolve(GENERATED_MESHES_DIR, capHash);

  // Check for hash-based reuse
  if (fs.existsSync(path.join(outputDir, 'config.yaml'))) {
    log.info('factory', `Reusing generated mesh: ${capHash}`, { meshName, outputDir });
    return { success: true, generated: outputDir, reused: true, meshName, errors: [] };
  }

  // Compile via factory
  fs.mkdirSync(outputDir, { recursive: true });
  const meshFactory = new MeshFactory(fragmentsDir);
  const result = meshFactory.compile(needed, outputDir);

  if (!result.success) {
    const compileErrors = [...result.errors, ...result.validation.errors];
    log.error('factory', 'Factory compilation failed', { errors: compileErrors });
    return { success: false, errors: compileErrors };
  }

  // Symlink: mesh-name → hash-dir so consumer can find by name
  createMeshNameSymlink(meshName, outputDir);

  // Archive: preserve compiled mesh + source capabilities as provenance
  archiveCompiledMesh(capHash, meshName, outputDir, inputFile, needed);

  log.info('factory', `Generated mesh at ${outputDir}`, { agents: result.agents });
  return { success: true, generated: outputDir, meshName, errors: [] };
}

/**
 * Create a symlink from mesh name to hash directory in generated-meshes.
 *
 * The consumer's tryLoadMeshOnDemand looks up by mesh name, but factory
 * stores by capability hash. The symlink bridges the gap.
 */
function createMeshNameSymlink(meshName: string, outputDir: string): void {
  try {
    const parentDir = path.dirname(outputDir);
    const symlinkPath = path.join(parentDir, meshName);

    // Skip if symlink already exists and points to the right place
    if (fs.existsSync(symlinkPath)) {
      const existing = fs.readlinkSync(symlinkPath);
      if (path.resolve(parentDir, existing) === path.resolve(outputDir)) return;
      // Wrong target — remove and recreate
      fs.unlinkSync(symlinkPath);
    }

    fs.symlinkSync(path.basename(outputDir), symlinkPath);
    log.info('factory', `Symlinked ${meshName} → ${path.basename(outputDir)}`);
  } catch (err) {
    // Non-fatal — consumer won't find the mesh by name, but it still works by hash
    log.warn('factory', `Failed to create mesh name symlink: ${String(err)}`);
  }
}

/**
 * Archive a compiled mesh with its source capabilities for provenance.
 *
 * Copies the compiled output to archived-meshes/{hash}-{meshName}/ and
 * writes the source capability declaration alongside it. This preserves
 * the full fork context (input + output) so nothing gets lost.
 */
function archiveCompiledMesh(
  capHash: string,
  meshName: string,
  outputDir: string,
  inputFile: string | undefined,
  needed: CapabilityNeeded,
): void {
  try {
    const archiveName = `${capHash}-${meshName}`;
    const archiveDir = path.resolve(ARCHIVED_MESHES_DIR, archiveName);

    // Skip if already archived (idempotent)
    if (fs.existsSync(archiveDir)) {
      log.debug('factory', `Archive already exists: ${archiveName}`);
      return;
    }

    // Copy compiled mesh to archive
    fs.cpSync(outputDir, archiveDir, { recursive: true });

    // Preserve source capabilities YAML (the fork context)
    if (inputFile && fs.existsSync(inputFile)) {
      fs.copyFileSync(inputFile, path.join(archiveDir, 'source-capabilities.yaml'));
    } else {
      // No input file (plan-derived or inline) — write the resolved capabilities
      fs.writeFileSync(
        path.join(archiveDir, 'source-capabilities.yaml'),
        YAML.stringify({ capability: needed }),
        'utf-8',
      );
    }

    log.info('factory', `Archived mesh: ${archiveName}`, { archiveDir });
  } catch (err) {
    // Archive failure is non-fatal — log and continue
    log.warn('factory', `Failed to archive mesh: ${String(err)}`);
  }
}

/**
 * CLI entry point for `tx factory`.
 */
export async function factory(args: string[]): Promise<void> {
  // Extract positional arg (skip flags and their values)
  const flagValues = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '--run') flagValues.add(i + 1);
  }
  const input = args.find((a, i) => !a.startsWith('-') && !flagValues.has(i));
  if (!input) {
    console.log('Usage: tx factory <capabilities.yaml|plan-dir> [options]');
    console.log('');
    console.log('Input modes:');
    console.log('  capabilities.yaml   Direct capability declaration');
    console.log('  plan-dir/           Plan directory (derives capabilities from plan.md + tasks.md)');
    console.log('');
    console.log('Options:');
    console.log('  --output <dir>   Output directory (default: hash-based under .ai/tx/generated-meshes/)');
    console.log('  --run <prompt>   Generate mesh and write initial message to start it');
    process.exitCode = 1;
    return;
  }

  // Parse flags
  let outputDir: string | undefined;
  const outputIdx = args.indexOf('--output');
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    outputDir = path.resolve(args[outputIdx + 1]);
  }

  let runPrompt: string | undefined;
  const runIdx = args.indexOf('--run');
  if (runIdx !== -1 && args[runIdx + 1]) {
    runPrompt = args[runIdx + 1];
  }

  const fragmentsDir = path.resolve('src/mesh/fragments');
  const catalogDir = path.resolve('meshes');
  const resolvedInput = path.resolve(input);
  const planMode = isPlanDirectory(resolvedInput);

  const result = await runFactory({
    inputFile: planMode ? undefined : resolvedInput,
    planDir: planMode ? resolvedInput : undefined,
    outputDir,
    fragmentsDir,
    catalogDir,
    run: runPrompt,
  });

  if (result.matched) {
    console.log(`Matched existing mesh: ${result.matched}`);
  } else if (result.generated) {
    const tag = result.reused ? '(reused)' : '(compiled)';
    console.log(`Generated mesh: ${result.generated} ${tag}`);
  } else {
    console.error(`Factory failed:`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  // Resolve entry point for routing info and --run dispatch
  const meshName = result.meshName!;
  const entryAgent = await resolveEntryPoint(meshName, result.matched, result.generated);
  if (entryAgent) {
    console.log(`Route to: ${meshName}/${entryAgent}`);
  }

  // --run: write initial message to start the mesh
  if (runPrompt && entryAgent) {
    const msgsDir = path.resolve('.ai/tx/msgs');
    fs.mkdirSync(msgsDir, { recursive: true });

    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `factory-${timestamp}`;
    const fileName = `${timestamp}-core-core-${meshName.replace(/\//g, '-')}-${entryAgent.replace(/\//g, '-')}-task-${msgId}.md`;
    const msgContent = [
      '---',
      `to: ${meshName}/${entryAgent}`,
      'from: core/core',
      `msg-id: ${msgId}`,
      `headline: Factory-dispatched task`,
      `timestamp: ${new Date().toISOString()}`,
      '---',
      '',
      runPrompt,
      '',
    ].join('\n');

    fs.writeFileSync(path.join(msgsDir, fileName), msgContent, 'utf-8');
    console.log(`Dispatched to ${meshName}/${entryAgent}`);
  }
}

/**
 * Resolve the entry point agent for a mesh.
 * Reads config.yaml to find entry_point or first agent.
 */
async function resolveEntryPoint(meshName: string, matchedMesh?: string, generatedDir?: string): Promise<string | null> {
  const configPaths = [];

  if (matchedMesh) {
    configPaths.push(path.resolve('meshes', matchedMesh, 'config.yaml'));
  }
  if (generatedDir) {
    configPaths.push(path.join(generatedDir, 'config.yaml'));
  }

  for (const configPath of configPaths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = YAML.parse(raw);

      // entry_point field takes precedence
      if (config.entry_point) return config.entry_point;

      // Static routing: first agent in routing array
      if (Array.isArray(config.routing)) return config.routing[0];

      // Fall back to first agent name
      if (Array.isArray(config.agents) && config.agents.length > 0) {
        return config.agents[0].name;
      }
    } catch {
      continue;
    }
  }

  return null;
}

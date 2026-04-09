/**
 * Capability Module
 *
 * Bidirectional capability matching for meshes and plans.
 *
 * Responsibilities:
 * - Re-export schema types, enums, and validation
 * - Serve as entry point for router, factory, and validator
 */

export {
  DOMAIN_VALUES,
  INPUT_VALUES,
  OUTPUT_VALUES,
  TOOL_VALUES,
  INTERACTION_VALUES,
  TOPOLOGY_VALUES,
  type Domain,
  type Input,
  type Output,
  type Tool,
  type Interaction,
  type Topology,
  type CapabilityDeclaration,
  type CapabilityNeeded,
  isValidCapability,
} from './schema.ts';

export {
  scoreMesh,
  findBestMesh,
  type CatalogEntry,
  type MatchResult,
} from './router.ts';

export {
  validateGeneratedMesh,
  type ValidationResult,
} from './validator.ts';

export { FragmentLoader, type PromptFragment } from './fragment-loader.ts';

export { MeshFactory, type CompileResult } from './factory.ts';

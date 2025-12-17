/**
 * LLM Provider Interface
 *
 * Abstracts LLM providers so mesh configs use semantic model names
 * (sonnet, opus, haiku) that get resolved to actual model IDs.
 */

import type { SemanticModel, AgentConfig } from '../shared/types.ts';

export interface LLMProvider {
  name: string;

  /** Map semantic model name to actual model ID */
  resolve(semantic: SemanticModel): string;

  /** Get path to executable (for Claude Code) */
  getExecutablePath(): string;

  /** Validate provider is available */
  isAvailable(): Promise<boolean>;
}

export interface ProviderRegistry {
  get(name: string): LLMProvider | undefined;
  getDefault(): LLMProvider;
  register(provider: LLMProvider): void;
}

/**
 * Provider Registry
 */

import type { LLMProvider, ProviderRegistry } from './interface.ts';
import { ClaudeProvider } from './claude.ts';

export { ClaudeProvider } from './claude.ts';
export type { LLMProvider, ProviderRegistry } from './interface.ts';

class Registry implements ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultProvider: LLMProvider;

  constructor() {
    this.defaultProvider = new ClaudeProvider();
    this.register(this.defaultProvider);
  }

  get(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  getDefault(): LLMProvider {
    return this.defaultProvider;
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }
}

// Singleton registry
export const providers = new Registry();

export function getProvider(name?: string): LLMProvider {
  if (name) {
    const provider = providers.get(name);
    if (provider) return provider;
  }
  return providers.getDefault();
}

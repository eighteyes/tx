/**
 * FakeToolHost — scriptable ToolHost for tests.
 *
 * Register tools with their spec + impl. Captures every call for assertions.
 */

import type { ToolExecutionResult, ToolHost } from './tool-host.ts';
import type { ProviderToolSpec } from './provider.ts';

export interface ToolInvocation {
  name: string;
  input: Record<string, unknown>;
}

export class FakeToolHost implements ToolHost {
  private readonly specs: ProviderToolSpec[] = [];
  private readonly impls = new Map<string, (input: Record<string, unknown>) => string | ToolExecutionResult | Promise<string | ToolExecutionResult>>();
  readonly calls: ToolInvocation[] = [];

  add(
    spec: ProviderToolSpec,
    impl: (input: Record<string, unknown>) => string | ToolExecutionResult | Promise<string | ToolExecutionResult>,
  ): this {
    this.specs.push(spec);
    this.impls.set(spec.name, impl);
    return this;
  }

  list(): ProviderToolSpec[] {
    return [...this.specs];
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.calls.push({ name, input });
    const impl = this.impls.get(name);
    if (!impl) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    try {
      const out = await impl(input);
      return typeof out === 'string' ? { content: out } : out;
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }
}

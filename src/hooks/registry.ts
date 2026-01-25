/**
 * Hook Registry
 *
 * Central registry for hook registration and execution with priority support.
 */

import { log } from '../shared/logger.ts';
import type {
  HookContext,
  HookUtils,
  HookDefinition,
  HookMetadata,
  QualityHookConfig,
  LegacyHookHandler,
} from './types.ts';
import { isQualityError, PreHookFailedError } from './errors.ts';
import { parseHookName } from './utils/quality-utils.ts';

/**
 * Default priority for hooks without explicit priority
 */
const DEFAULT_PRIORITY = 100;

/**
 * Hook Registry - manages hook registration and execution
 */
export class HookRegistry {
  private preHooks = new Map<string, HookDefinition>();
  private postHooks = new Map<string, HookDefinition>();
  private initialized = new Set<string>();

  /**
   * Register a hook definition
   */
  register(definition: HookDefinition): void {
    const map = definition.phase === 'pre' ? this.preHooks : this.postHooks;

    if (map.has(definition.name)) {
      log.warn('hooks', `Hook "${definition.name}" already registered, overwriting`);
    }

    map.set(definition.name, {
      ...definition,
      priority: definition.priority ?? DEFAULT_PRIORITY,
    });

    log.debug('hooks', `Registered ${definition.phase}-hook: ${definition.name}`, {
      priority: definition.priority ?? DEFAULT_PRIORITY,
    });
  }

  /**
   * Register a legacy hook handler (backward compatibility)
   */
  registerLegacy(
    name: string,
    phase: 'pre' | 'post',
    handler: LegacyHookHandler,
    priority?: number
  ): void {
    // Wrap legacy handler to match new signature
    const wrappedHandler = async (context: HookContext, _utils: HookUtils): Promise<void> => {
      await handler(context);
    };

    this.register({
      name,
      phase,
      priority: priority ?? DEFAULT_PRIORITY,
      handler: wrappedHandler,
    });
  }

  /**
   * Initialize all registered hooks that have an initialize method
   */
  async initialize(utils: HookUtils): Promise<void> {
    const allHooks = [...this.preHooks.values(), ...this.postHooks.values()];

    for (const hook of allHooks) {
      if (hook.initialize && !this.initialized.has(hook.name)) {
        try {
          await hook.initialize(utils);
          this.initialized.add(hook.name);
          log.debug('hooks', `Initialized hook: ${hook.name}`);
        } catch (error) {
          log.error('hooks', `Failed to initialize hook: ${hook.name}`, {
            error: (error as Error).message,
          });
          throw error;
        }
      }
    }
  }

  /**
   * Get a hook by name and phase
   */
  get(name: string, phase: 'pre' | 'post'): HookDefinition | undefined {
    return (phase === 'pre' ? this.preHooks : this.postHooks).get(name);
  }

  /**
   * Check if a hook exists
   */
  has(name: string, phase: 'pre' | 'post'): boolean {
    return (phase === 'pre' ? this.preHooks : this.postHooks).has(name);
  }

  /**
   * List all hooks for a phase, sorted by priority
   */
  list(phase: 'pre' | 'post'): HookDefinition[] {
    const map = phase === 'pre' ? this.preHooks : this.postHooks;
    return Array.from(map.values()).sort((a, b) =>
      (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY)
    );
  }

  /**
   * List hook names for a phase
   */
  listNames(phase: 'pre' | 'post'): string[] {
    const map = phase === 'pre' ? this.preHooks : this.postHooks;
    return Array.from(map.keys());
  }

  /**
   * Get hook metadata for introspection
   */
  getMetadata(phase: 'pre' | 'post'): HookMetadata[] {
    return this.list(phase).map(hook => ({
      name: hook.name,
      description: hook.description,
      phase: hook.phase,
      priority: hook.priority ?? DEFAULT_PRIORITY,
    }));
  }

  /**
   * Get execution order for a list of hook names
   * Returns hooks sorted by priority
   */
  getExecutionOrder(hookNames: string[], phase: 'pre' | 'post'): HookDefinition[] {
    return hookNames
      .map(name => {
        const { baseName } = parseHookName(name);
        return this.get(baseName, phase);
      })
      .filter((h): h is HookDefinition => h !== undefined)
      .sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
  }

  /**
   * Execute hooks sequentially with priority ordering
   */
  async executeHooks(
    hookNames: string[],
    context: HookContext,
    phase: 'pre' | 'post',
    utils: HookUtils
  ): Promise<void> {
    log.info('hooks', `Starting ${phase}-hook execution`, {
      hookNames,
      meshInstance: context.meshInstance,
      agentId: context.agentId,
    });

    for (const hookName of hookNames) {
      // Parse parameterized hooks: "quality:preflight:gates=checklist,rubric"
      const { baseName, config } = parseHookName(hookName);

      // Apply config to context for quality hooks
      if (baseName.startsWith('quality:') && config) {
        this.applyQualityConfig(context, config);
      }

      const hook = this.get(baseName, phase);

      if (!hook) {
        log.warn('hooks', `Unknown ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
        });
        continue;
      }

      try {
        log.debug('hooks', `Executing ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
          config,
          priority: hook.priority,
        });

        await hook.handler(context, utils);

        log.debug('hooks', `Completed ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
        });
      } catch (error) {
        // Propagate quality errors for the dispatcher to handle
        if (isQualityError(error)) {
          throw error;
        }

        const errorMsg = (error as Error).message;
        log.error('hooks', `Failed to execute ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
          error: errorMsg,
        });

        // For pre-hooks, propagate error to prevent worker spawn
        // For post-hooks, log but continue (don't kill worker retroactively)
        if (phase === 'pre') {
          throw new PreHookFailedError(baseName, error as Error);
        }
      }
    }
  }

  /**
   * Apply quality hook config to context
   */
  private applyQualityConfig(context: HookContext, config: QualityHookConfig): void {
    if (config.gates) {
      context.qualityGates = config.gates;
    }
    if (config.onFail) {
      context.qualityOnFail = config.onFail;
    }
    if (config.maxIterations) {
      context.qualityMaxIterations = config.maxIterations;
    }
  }

  /**
   * Clear all hooks (for testing)
   */
  clear(): void {
    this.preHooks.clear();
    this.postHooks.clear();
    this.initialized.clear();
  }
}

/**
 * Global hook registry singleton
 */
export const hookRegistry = new HookRegistry();

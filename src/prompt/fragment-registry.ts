/**
 * FragmentRegistry - Manages prompt fragment catalog for agents
 *
 * Responsibilities:
 * - Load fragment markdown files from disk (mesh/agent directories)
 * - Register runtime-authored fragments
 * - Resolve fragments by name with priority ordering
 * - List available fragment names for catalog injection
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';

export class FragmentRegistry {
  private fragments: Map<string, string> = new Map();

  /**
   * Load all .md files from a directory as fragments.
   * Fragment name = filename without extension.
   * Later loads overwrite earlier ones (for priority ordering).
   */
  loadFromDir(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    for (const file of files) {
      const name = path.basename(file, '.md');
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      this.fragments.set(name, content);
    }

    log.debug('fragment-registry', 'Loaded fragments', { dir, count: files.length });
  }

  /**
   * Register a runtime fragment (agent-authored).
   */
  register(name: string, content: string): void {
    this.fragments.set(name, content);
    log.debug('fragment-registry', 'Registered runtime fragment', { name });
  }

  /**
   * Get fragment content by name. Returns null if not found.
   */
  get(name: string): string | null {
    return this.fragments.get(name) ?? null;
  }

  /**
   * List all available fragment names (sorted).
   */
  list(): string[] {
    return Array.from(this.fragments.keys()).sort();
  }

  /**
   * Check if a fragment exists.
   */
  has(name: string): boolean {
    return this.fragments.has(name);
  }
}

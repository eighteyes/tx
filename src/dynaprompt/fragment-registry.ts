/**
 * FragmentRegistry - In-memory catalog of prompt fragments
 *
 * Loads fragments from multiple sources with priority-based resolution:
 * Priority (highest to lowest): agent config > agent dir > mesh config > mesh dir > runtime
 *
 * Fragments can be registered at runtime and have YAML frontmatter for descriptions.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { log } from '../shared/logger.ts';
import type { Fragment, FragmentSource } from './types.ts';

const COMPONENT = 'fragment-registry';
const MAX_FRAGMENT_SIZE = 50 * 1024; // 50KB

interface FragmentFrontmatter {
  description?: string;
}

export class FragmentRegistry {
  private fragments: Map<string, Fragment> = new Map();

  /**
   * Load fragments from mesh and agent configurations
   */
  load(meshConfig: { fragments?: Record<string, string> }, agentConfig: { fragments?: Record<string, string> }, meshDir?: string, agentDir?: string): void {
    // Priority order (lowest to highest):
    // 1. Mesh dir
    if (meshDir) {
      this.loadFromDir(meshDir, 'mesh-dir');
    }

    // 2. Mesh config
    if (meshConfig.fragments) {
      this.loadFromConfig(meshConfig.fragments, 'mesh-config');
    }

    // 3. Agent dir
    if (agentDir) {
      this.loadFromDir(agentDir, 'agent-dir');
    }

    // 4. Agent config (highest priority from static sources)
    if (agentConfig.fragments) {
      this.loadFromConfig(agentConfig.fragments, 'agent-config');
    }

    log.debug(COMPONENT, 'Fragments loaded', { count: this.fragments.size, sources: this.getSources() });
  }

  /**
   * Load fragments from a directory
   * Scans for *.md files, treats filename (without .md) as fragment name
   */
  private loadFromDir(dirPath: string, source: FragmentSource): void {
    if (!fs.existsSync(dirPath)) {
      log.debug(COMPONENT, 'Fragment directory not found', { dirPath, source });
      return;
    }

    try {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const name = path.basename(file, '.md');

        try {
          const rawContent = fs.readFileSync(filePath, 'utf-8');

          // Check size limit
          if (rawContent.length > MAX_FRAGMENT_SIZE) {
            log.warn(COMPONENT, 'Fragment exceeds size limit, skipping', {
              name,
              source,
              sizeBytes: rawContent.length,
              limitBytes: MAX_FRAGMENT_SIZE
            });
            continue;
          }

          const { content, description } = this.parseFrontmatter(rawContent);

          // Register (will override if higher priority)
          this.registerInternal(name, content, source, description);
        } catch (err) {
          log.warn(COMPONENT, 'Failed to load fragment file', {
            file,
            source,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    } catch (err) {
      log.warn(COMPONENT, 'Failed to read fragment directory', {
        dirPath,
        source,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Load fragments from config object
   */
  private loadFromConfig(fragmentsConfig: Record<string, string>, source: FragmentSource): void {
    for (const [name, content] of Object.entries(fragmentsConfig)) {
      if (content.length > MAX_FRAGMENT_SIZE) {
        log.warn(COMPONENT, 'Fragment exceeds size limit, skipping', {
          name,
          source,
          sizeBytes: content.length,
          limitBytes: MAX_FRAGMENT_SIZE
        });
        continue;
      }

      const { content: parsedContent, description } = this.parseFrontmatter(content);
      this.registerInternal(name, parsedContent, source, description);
    }
  }

  /**
   * Parse YAML frontmatter from fragment content
   */
  private parseFrontmatter(raw: string): { content: string; description: string | null } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = raw.match(frontmatterRegex);

    if (!match) {
      return { content: raw, description: null };
    }

    try {
      const frontmatter = YAML.parse(match[1]) as FragmentFrontmatter;
      return {
        content: match[2],
        description: frontmatter.description || null
      };
    } catch (err) {
      log.warn(COMPONENT, 'Failed to parse frontmatter, using raw content', {
        error: err instanceof Error ? err.message : String(err)
      });
      return { content: raw, description: null };
    }
  }

  /**
   * Register a fragment (internal, handles priority)
   */
  private registerInternal(name: string, content: string, source: FragmentSource, description: string | null = null): void {
    const existing = this.fragments.get(name);

    // Check if new source has higher priority
    if (existing && !this.isHigherPriority(source, existing.source)) {
      log.debug(COMPONENT, 'Fragment not registered (lower priority)', {
        name,
        existingSource: existing.source,
        newSource: source
      });
      return;
    }

    this.fragments.set(name, { name, content, description, source });

    log.debug(COMPONENT, 'Fragment registered', {
      name,
      source,
      contentLength: content.length,
      hasDescription: Boolean(description),
      overrode: Boolean(existing)
    });
  }

  /**
   * Check if source A has higher priority than source B
   */
  private isHigherPriority(sourceA: FragmentSource, sourceB: FragmentSource): boolean {
    const priorities: Record<FragmentSource, number> = {
      'runtime': 5,
      'agent-config': 4,
      'agent-dir': 3,
      'mesh-config': 2,
      'mesh-dir': 1
    };
    return priorities[sourceA] > priorities[sourceB];
  }

  /**
   * Get unique sources currently in registry
   */
  private getSources(): FragmentSource[] {
    const sources = new Set<FragmentSource>();
    for (const fragment of this.fragments.values()) {
      sources.add(fragment.source);
    }
    return Array.from(sources);
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Resolve a fragment by name
   */
  resolve(name: string): Fragment | null {
    return this.fragments.get(name) || null;
  }

  /**
   * Register a fragment at runtime (highest priority)
   */
  register(name: string, content: string, description: string | null = null): void {
    if (content.length > MAX_FRAGMENT_SIZE) {
      throw new Error(
        `Fragment exceeds size limit: ${content.length} bytes (max: ${MAX_FRAGMENT_SIZE} bytes)`
      );
    }

    this.registerInternal(name, content, 'runtime', description);
    log.info(COMPONENT, 'Runtime fragment registered', { name, contentLength: content.length });
  }

  /**
   * List all registered fragments
   */
  list(): Fragment[] {
    return Array.from(this.fragments.values());
  }

  /**
   * Check if a fragment exists
   */
  has(name: string): boolean {
    return this.fragments.has(name);
  }

  /**
   * Get count of registered fragments
   */
  count(): number {
    return this.fragments.size;
  }

  /**
   * Clear all fragments (for testing)
   */
  clear(): void {
    this.fragments.clear();
    log.debug(COMPONENT, 'Registry cleared');
  }
}

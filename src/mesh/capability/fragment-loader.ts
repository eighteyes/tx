/**
 * FragmentLoader - Loads YAML prompt fragments from disk
 *
 * Reads structured prompt fragment files organized by category subdirectory.
 * Each fragment maps to a capability enum value and provides prompt sections
 * (identity, anti-patterns, error-architecture, workflow-phases, etc.).
 *
 * Responsibilities:
 * - Scan category subdirectories for .yaml/.yml files
 * - Parse YAML into PromptFragment objects keyed by category/name
 * - Provide lookup by fragment ID
 * - Select fragments matching given capability arrays
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface PromptFragment {
  id: string;
  sections: Record<string, string | string[] | Record<string, string>[]>;
}

const CATEGORIES = ['domain', 'input', 'output', 'tools', 'interaction', 'topology'];

export class FragmentLoader {
  private fragments: Map<string, PromptFragment> = new Map();

  constructor(baseDir: string) {
    this.loadAll(baseDir);
  }

  /**
   * Scan category subdirectories, read and parse all .yaml/.yml files.
   */
  private loadAll(baseDir: string): void {
    for (const category of CATEGORIES) {
      const categoryDir = path.join(baseDir, category);
      if (!fs.existsSync(categoryDir)) continue;

      const entries = fs.readdirSync(categoryDir);
      for (const entry of entries) {
        if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

        const filePath = path.join(categoryDir, entry);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = YAML.parse(raw);

        if (!parsed || !parsed.id || !parsed.sections) continue;

        const fragment: PromptFragment = {
          id: parsed.id,
          sections: parsed.sections,
        };

        this.fragments.set(fragment.id, fragment);
      }
    }
  }

  /**
   * Get a fragment by its ID (e.g., "domain/dev").
   */
  get(id: string): PromptFragment | null {
    return this.fragments.get(id) ?? null;
  }

  /**
   * List all loaded fragment IDs.
   */
  listAll(): string[] {
    return Array.from(this.fragments.keys());
  }

  /**
   * Select fragments matching the given capability arrays.
   * Checks domain/, tools/, and interaction/ categories.
   */
  selectForCapability(
    domains: string[],
    tools: string[],
    interaction: string[],
  ): PromptFragment[] {
    const selected: PromptFragment[] = [];

    for (const d of domains) {
      const frag = this.fragments.get(`domain/${d}`);
      if (frag) selected.push(frag);
    }

    for (const t of tools) {
      const frag = this.fragments.get(`tools/${t}`);
      if (frag) selected.push(frag);
    }

    for (const i of interaction) {
      const frag = this.fragments.get(`interaction/${i}`);
      if (frag) selected.push(frag);
    }

    return selected;
  }
}

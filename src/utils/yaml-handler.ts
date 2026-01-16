/**
 * YAML Handler Utility
 *
 * Provides utilities for reading, writing, and parsing YAML files.
 * Uses atomic writes to prevent file corruption.
 */

import YAML from 'yaml';
import fs from 'fs/promises';
import path from 'path';
import { log } from '../shared/logger.ts';

/**
 * Options for YAML serialization
 */
export interface YAMLSerializeOptions {
  indent?: number;
  lineWidth?: number;
}

/**
 * YAML handler for reading and writing YAML files
 */
export class YAMLHandler {
  private static DEFAULT_OPTIONS: YAMLSerializeOptions = {
    indent: 2,
    lineWidth: 120,
  };

  /**
   * Read and parse a YAML file
   *
   * @param filepath - Path to the YAML file
   * @returns Parsed YAML content
   */
  static async readYAML<T = unknown>(filepath: string): Promise<T> {
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return YAML.parse(content) as T;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('yaml-handler', `Failed to read YAML file: ${filepath}`, { error: errMsg });
      throw new Error(`Failed to read YAML file: ${errMsg}`);
    }
  }

  /**
   * Write data to a YAML file atomically
   *
   * Uses temp file + rename to prevent corruption on crash.
   *
   * @param filepath - Path to write the YAML file
   * @param data - Data to serialize to YAML
   * @param options - Serialization options
   */
  static async writeYAML(
    filepath: string,
    data: unknown,
    options?: YAMLSerializeOptions
  ): Promise<void> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const yamlContent = this.serializeYAML(data, opts);

    // Ensure directory exists
    const dir = path.dirname(filepath);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: temp file + rename
    const tmpPath = `${filepath}.tmp`;
    try {
      await fs.writeFile(tmpPath, yamlContent, 'utf-8');
      await fs.rename(tmpPath, filepath);
      log.debug('yaml-handler', `Wrote YAML file: ${filepath}`);
    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('yaml-handler', `Failed to write YAML file: ${filepath}`, { error: errMsg });
      throw new Error(`Failed to write YAML file: ${errMsg}`);
    }
  }

  /**
   * Serialize data to a YAML string
   *
   * @param data - Data to serialize
   * @param options - Serialization options
   * @returns YAML string
   */
  static serializeYAML(data: unknown, options?: YAMLSerializeOptions): string {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    return YAML.stringify(data, {
      indent: opts.indent,
      lineWidth: opts.lineWidth,
    });
  }

  /**
   * Parse a YAML string
   *
   * @param content - YAML string to parse
   * @returns Parsed data
   */
  static parseYAML<T = unknown>(content: string): T {
    try {
      return YAML.parse(content) as T;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('yaml-handler', 'Failed to parse YAML content', { error: errMsg });
      throw new Error(`Failed to parse YAML: ${errMsg}`);
    }
  }

  /**
   * Check if a file exists
   *
   * @param filepath - Path to check
   * @returns true if file exists
   */
  static async exists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read a file as raw string
   *
   * @param filepath - Path to the file
   * @returns File content as string
   */
  static async readRaw(filepath: string): Promise<string> {
    return fs.readFile(filepath, 'utf-8');
  }
}

/**
 * Claude Provider
 *
 * Maps semantic model names to Claude model IDs.
 * Uses Claude Code executable for agent sessions.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { SemanticModel } from '../shared/types.ts';
import type { LLMProvider } from './interface.ts';

const execAsync = promisify(exec);

const MODEL_MAP: Record<SemanticModel, string> = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
};

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private executablePath: string;

  constructor(executablePath?: string) {
    this.executablePath = executablePath || this.findExecutable();
  }

  private findExecutable(): string {
    // Common locations for Claude Code
    const paths = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      process.env.CLAUDE_PATH,
    ].filter(Boolean) as string[];

    return paths[0] || 'claude';
  }

  resolve(semantic: SemanticModel): string {
    return MODEL_MAP[semantic] || MODEL_MAP.sonnet;
  }

  getExecutablePath(): string {
    return this.executablePath;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`${this.executablePath} --version`);
      return true;
    } catch {
      return false;
    }
  }
}

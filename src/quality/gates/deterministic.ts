/**
 * Deterministic Gate
 *
 * Runs tests, lint, type checks via shell commands.
 * Uses exit codes to determine pass/fail.
 */

import { spawn } from 'node:child_process';
import { BaseEvaluator } from '../registry.ts';
import type { GateType, EvalResult, PreflightOutput, RearmatterData } from '../types.ts';
import { log } from '../../shared/logger.ts';

/**
 * Command execution result
 */
interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

/**
 * Configuration for deterministic gate
 */
export interface DeterministicGateConfig {
  commands: string[];          // Commands to run
  workDir: string;             // Working directory
  timeout?: number;            // Timeout in milliseconds (default: 60000)
  failFast?: boolean;          // Stop on first failure (default: true)
}

/**
 * DeterministicGate evaluator
 *
 * Runs shell commands (tests, lint, type checks).
 * Passes if all commands exit with code 0.
 */
export class DeterministicGate extends BaseEvaluator {
  readonly gate: GateType = 'deterministic';

  private config: DeterministicGateConfig;

  constructor(config: DeterministicGateConfig) {
    super();
    this.config = {
      timeout: 60000,
      failFast: true,
      ...config,
    };
  }

  async evaluate(
    _solution: string,
    _rearmatter: RearmatterData,
    _criteria: PreflightOutput,
    _priorEvals?: EvalResult[]
  ): Promise<EvalResult> {
    const startTime = Date.now();

    // If no commands, pass automatically
    if (!this.config.commands || this.config.commands.length === 0) {
      log.debug('deterministic-gate', 'No commands configured, passing');
      return {
        ...this.pass({ reason: 'No commands configured' }),
        duration: Date.now() - startTime,
      };
    }

    log.info('deterministic-gate', `Running ${this.config.commands.length} commands`);

    const results: CommandResult[] = [];
    let allPassed = true;

    for (const command of this.config.commands) {
      const result = await this.runCommand(command);
      results.push(result);

      if (result.exitCode !== 0) {
        allPassed = false;
        log.warn('deterministic-gate', `Command failed: ${command}`, {
          exitCode: result.exitCode,
          stderr: result.stderr.slice(0, 200),
        });

        if (this.config.failFast) {
          break;
        }
      }
    }

    const details = {
      commands: this.config.commands.length,
      executed: results.length,
      passed: results.filter(r => r.exitCode === 0).length,
      failed: results.filter(r => r.exitCode !== 0).length,
      results,
    };

    const totalDuration = Date.now() - startTime;

    if (allPassed) {
      return {
        ...this.pass(details),
        duration: totalDuration,
      };
    }

    // Build feedback from failed commands
    const failedResults = results.filter(r => r.exitCode !== 0);
    const feedback = failedResults
      .map(r => {
        const stderr = r.stderr.trim();
        return `Command '${r.command}' failed (exit ${r.exitCode}):\n${stderr.slice(0, 500)}`;
      })
      .join('\n\n');

    return {
      ...this.fail(feedback, details),
      duration: totalDuration,
    };
  }

  /**
   * Run a shell command and capture output
   */
  private async runCommand(command: string): Promise<CommandResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const parts = command.split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      const proc = spawn(cmd, args, {
        cwd: this.config.workDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        stderr += '\n[Command timed out]';
      }, this.config.timeout!);

      proc.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        resolve({
          command,
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        resolve({
          command,
          exitCode: 1,
          stdout,
          stderr: error.message,
          duration: Date.now() - startTime,
        });
      });
    });
  }
}

/**
 * Create a deterministic gate for running npm scripts
 */
export function createNpmScriptGate(
  scripts: string[],
  workDir: string
): DeterministicGate {
  return new DeterministicGate({
    commands: scripts.map(s => `npm run ${s}`),
    workDir,
  });
}

/**
 * Create a deterministic gate for TypeScript type checking
 */
export function createTypeCheckGate(workDir: string): DeterministicGate {
  return new DeterministicGate({
    commands: ['npx tsc --noEmit'],
    workDir,
  });
}

/**
 * Create a deterministic gate for running tests
 */
export function createTestGate(workDir: string, testCommand?: string): DeterministicGate {
  return new DeterministicGate({
    commands: [testCommand || 'npm test'],
    workDir,
    timeout: 120000, // 2 minutes for tests
  });
}

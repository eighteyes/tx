/**
 * ScriptExecutor - Runs FSM gate and transition scripts with timeout and env injection
 *
 * Provides:
 * - Bash script execution with 30s timeout
 * - Environment variable injection for FSM context
 * - Output parsing for key=value results
 * - Process group killing on timeout
 *
 * Follows existing LifecycleHooks patterns for child_process handling.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { log } from '../shared/logger.ts';

/**
 * Script execution result
 */
export interface ScriptResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  outputs: Record<string, string>;  // Parsed key=value pairs from stdout
}

/**
 * Script execution context (passed as env vars)
 */
export interface ScriptContext {
  // FSM state variables
  fsmState: string;
  fsmPreviousState?: string;
  fsmMeshName: string;
  fsmTransition?: string;

  // Message frontmatter (from triggering message)
  msgFrom?: string;
  msgTo?: string;
  msgType?: string;
  msgId?: string;
  msgHeadline?: string;

  // Custom context variables from FSM state
  [key: string]: unknown;
}

/**
 * Script executor configuration
 */
export interface ScriptExecutorConfig {
  timeoutMs?: number;  // Default: 30000 (30 seconds)
  workDir?: string;    // Working directory for script execution
  shell?: string;      // Shell to use (default: /bin/bash)
}

const DEFAULT_TIMEOUT_MS = 30000;  // 30 seconds per architecture spec

export class ScriptExecutor {
  private config: Required<ScriptExecutorConfig>;

  constructor(config: ScriptExecutorConfig = {}) {
    this.config = {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      workDir: config.workDir ?? process.cwd(),
      shell: config.shell ?? '/bin/bash',
    };
  }

  /**
   * Execute a script with the given context
   *
   * @param scriptPath - Path to the script file (relative to workDir or absolute)
   * @param context - Context variables to inject as environment
   * @returns Script execution result
   */
  async execute(scriptPath: string, context: ScriptContext): Promise<ScriptResult> {
    const startTime = Date.now();

    // Resolve script path
    const resolvedPath = path.isAbsolute(scriptPath)
      ? scriptPath
      : path.join(this.config.workDir, scriptPath);

    // Validate script exists
    if (!fs.existsSync(resolvedPath)) {
      log.error('fsm-scripts', 'Script not found', { scriptPath: resolvedPath });
      return {
        success: false,
        exitCode: 127,  // Command not found
        stdout: '',
        stderr: `Script not found: ${resolvedPath}`,
        timedOut: false,
        durationMs: Date.now() - startTime,
        outputs: {},
      };
    }

    // Build environment variables
    const env = this.buildEnv(context);

    log.debug('fsm-scripts', 'Executing script', {
      scriptPath: resolvedPath,
      timeoutMs: this.config.timeoutMs,
      envKeys: Object.keys(env).filter(k => k.startsWith('FSM_') || k.startsWith('MSG_')),
    });

    return new Promise<ScriptResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let child: ChildProcess | null = null;

      // Set up timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (child) {
          log.warn('fsm-scripts', 'Script timed out, killing process group', {
            scriptPath: resolvedPath,
            timeoutMs: this.config.timeoutMs,
          });
          this.killProcessGroup(child);
        }
      }, this.config.timeoutMs);

      const spawnOptions: SpawnOptions = {
        cwd: this.config.workDir,
        env: { ...process.env, ...env },
        shell: this.config.shell,
        // Create new process group for clean killing
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      };

      try {
        child = spawn(resolvedPath, [], spawnOptions);

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        child.on('error', (error: Error) => {
          clearTimeout(timeoutId);
          log.error('fsm-scripts', 'Script spawn error', {
            scriptPath: resolvedPath,
            error: error.message,
          });
          resolve({
            success: false,
            exitCode: 1,
            stdout,
            stderr: stderr + `\nSpawn error: ${error.message}`,
            timedOut: false,
            durationMs: Date.now() - startTime,
            outputs: {},
          });
        });

        child.on('close', (code: number | null, signal: string | null) => {
          clearTimeout(timeoutId);
          const durationMs = Date.now() - startTime;
          const exitCode = code ?? (signal ? 128 : 1);
          const success = !timedOut && exitCode === 0;

          // Parse key=value outputs from stdout
          const outputs = this.parseOutputs(stdout);

          log.debug('fsm-scripts', 'Script completed', {
            scriptPath: resolvedPath,
            success,
            exitCode,
            timedOut,
            durationMs,
            outputKeys: Object.keys(outputs),
          });

          resolve({
            success,
            exitCode,
            stdout,
            stderr,
            timedOut,
            durationMs,
            outputs,
          });
        });
      } catch (error) {
        clearTimeout(timeoutId);
        log.error('fsm-scripts', 'Script execution failed', {
          scriptPath: resolvedPath,
          error: (error as Error).message,
        });
        resolve({
          success: false,
          exitCode: 1,
          stdout,
          stderr: stderr + `\nExecution error: ${(error as Error).message}`,
          timedOut: false,
          durationMs: Date.now() - startTime,
          outputs: {},
        });
      }
    });
  }

  /**
   * Execute an inline script (not from file)
   *
   * @param script - Script content to execute
   * @param context - Context variables to inject as environment
   * @returns Script execution result
   */
  async executeInline(script: string, context: ScriptContext): Promise<ScriptResult> {
    const startTime = Date.now();
    const env = this.buildEnv(context);

    log.debug('fsm-scripts', 'Executing inline script', {
      scriptLength: script.length,
      timeoutMs: this.config.timeoutMs,
    });

    return new Promise<ScriptResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let child: ChildProcess | null = null;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (child) {
          log.warn('fsm-scripts', 'Inline script timed out', {
            timeoutMs: this.config.timeoutMs,
          });
          this.killProcessGroup(child);
        }
      }, this.config.timeoutMs);

      try {
        child = spawn(this.config.shell, ['-c', script], {
          cwd: this.config.workDir,
          env: { ...process.env, ...env },
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        child.on('error', (error: Error) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            exitCode: 1,
            stdout,
            stderr: stderr + `\nSpawn error: ${error.message}`,
            timedOut: false,
            durationMs: Date.now() - startTime,
            outputs: {},
          });
        });

        child.on('close', (code: number | null, signal: string | null) => {
          clearTimeout(timeoutId);
          const exitCode = code ?? (signal ? 128 : 1);
          const success = !timedOut && exitCode === 0;
          const outputs = this.parseOutputs(stdout);

          resolve({
            success,
            exitCode,
            stdout,
            stderr,
            timedOut,
            durationMs: Date.now() - startTime,
            outputs,
          });
        });
      } catch (error) {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          exitCode: 1,
          stdout,
          stderr: stderr + `\nExecution error: ${(error as Error).message}`,
          timedOut: false,
          durationMs: Date.now() - startTime,
          outputs: {},
        });
      }
    });
  }

  /**
   * Build environment variables from context
   * Converts context to uppercase keys with FSM_ or MSG_ prefixes
   */
  private buildEnv(context: ScriptContext): Record<string, string> {
    const env: Record<string, string> = {};

    // Core FSM variables
    env['FSM_STATE'] = context.fsmState;
    env['FSM_MESH_NAME'] = context.fsmMeshName;
    if (context.fsmPreviousState) {
      env['FSM_PREVIOUS_STATE'] = context.fsmPreviousState;
    }
    if (context.fsmTransition) {
      env['FSM_TRANSITION'] = context.fsmTransition;
    }

    // Message frontmatter
    if (context.msgFrom) env['MSG_FROM'] = context.msgFrom;
    if (context.msgTo) env['MSG_TO'] = context.msgTo;
    if (context.msgType) env['MSG_TYPE'] = context.msgType;
    if (context.msgId) env['MSG_ID'] = context.msgId;
    if (context.msgHeadline) env['MSG_HEADLINE'] = context.msgHeadline;

    // Custom context variables (only primitives)
    for (const [key, value] of Object.entries(context)) {
      // Skip already-handled keys
      if (key.startsWith('fsm') || key.startsWith('msg')) continue;

      // Only include string/number/boolean values
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        // Use simple variable name (lowercase with underscores)
        env[key] = String(value);
      }
    }

    return env;
  }

  /**
   * Parse key=value pairs from script output
   * Looks for lines matching: KEY=value
   */
  private parseOutputs(stdout: string): Record<string, string> {
    const outputs: Record<string, string> = {};
    const lines = stdout.split('\n');

    for (const line of lines) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) {
        outputs[match[1]] = match[2];
      }
    }

    return outputs;
  }

  /**
   * Kill a process and its entire process group
   */
  private killProcessGroup(child: ChildProcess): void {
    try {
      if (child.pid) {
        // Kill the entire process group (negative pid)
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch (error) {
      // Process might already be dead
      log.debug('fsm-scripts', 'Failed to kill process group (may already be dead)', {
        pid: child.pid,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Update executor configuration
   */
  setConfig(config: Partial<ScriptExecutorConfig>): void {
    if (config.timeoutMs !== undefined) {
      this.config.timeoutMs = config.timeoutMs;
    }
    if (config.workDir !== undefined) {
      this.config.workDir = config.workDir;
    }
    if (config.shell !== undefined) {
      this.config.shell = config.shell;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<ScriptExecutorConfig>> {
    return { ...this.config };
  }
}

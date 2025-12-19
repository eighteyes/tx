/**
 * WorkspaceManager - Manages task-scoped output workspaces
 *
 * Each task gets its own workspace directory at .ai/tx/output/{task-id}/
 * where agents can write structured outputs defined in mesh config.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';

export interface WorkspaceConfig {
  path?: string;  // Path template for workspace (can include {topic}, {task-id}, etc.)
  output?: Record<string, string>;  // filename -> description
  create_on_init?: boolean;  // Create directory on initialization (default: true)
  cleanup_on_complete?: boolean;  // Clean up on task completion (default: false)
}

/**
 * Normalize workspace config from legacy string format to object format
 */
export function normalizeWorkspaceConfig(config: string | WorkspaceConfig): WorkspaceConfig {
  if (typeof config === 'string') {
    return { path: config };
  }
  return config;
}

export interface WorkspaceInfo {
  taskId: string;
  dir: string;
  outputFiles: Map<string, string>;  // filename -> description
}

export class WorkspaceManager {
  private workDir: string;
  private outputBaseDir: string;
  private workspaces: Map<string, WorkspaceInfo> = new Map();

  constructor(workDir: string) {
    this.workDir = workDir;
    this.outputBaseDir = path.join(workDir, '.ai', 'tx', 'output');
  }

  /**
   * Create a workspace for a task
   */
  createWorkspace(taskId: string, config: WorkspaceConfig | string): WorkspaceInfo {
    // Normalize string format to object format
    const normalizedConfig = normalizeWorkspaceConfig(config);

    // Determine workspace directory
    let workspaceDir: string;
    if (normalizedConfig.path) {
      // Use custom path (substitute {task-id} and other variables)
      const pathTemplate = normalizedConfig.path.replace('{task-id}', taskId);
      workspaceDir = path.isAbsolute(pathTemplate)
        ? pathTemplate
        : path.join(this.workDir, pathTemplate);
    } else {
      // Default: .ai/tx/output/{task-id}/
      workspaceDir = path.join(this.outputBaseDir, taskId);
    }

    // Create directory (unless explicitly disabled)
    if (normalizedConfig.create_on_init !== false && !fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }

    // Build output file map
    const outputFiles = new Map<string, string>();
    if (normalizedConfig.output) {
      for (const [filename, description] of Object.entries(normalizedConfig.output)) {
        outputFiles.set(filename, description);
      }
    }

    const workspace: WorkspaceInfo = {
      taskId,
      dir: workspaceDir,
      outputFiles,
    };

    this.workspaces.set(taskId, workspace);

    log.info('workspace', `Created workspace`, {
      taskId,
      dir: workspaceDir,
      outputFiles: Array.from(outputFiles.keys()),
    });

    return workspace;
  }

  /**
   * Get workspace info for a task
   */
  getWorkspace(taskId: string): WorkspaceInfo | undefined {
    return this.workspaces.get(taskId);
  }

  /**
   * Check if workspace exists
   */
  hasWorkspace(taskId: string): boolean {
    return this.workspaces.has(taskId);
  }

  /**
   * List all files in a workspace
   */
  listWorkspaceFiles(taskId: string): string[] {
    const workspace = this.workspaces.get(taskId);
    if (!workspace) return [];

    if (!fs.existsSync(workspace.dir)) return [];

    try {
      return fs.readdirSync(workspace.dir);
    } catch {
      return [];
    }
  }

  /**
   * Read a file from workspace
   */
  readWorkspaceFile(taskId: string, filename: string): string | null {
    const workspace = this.workspaces.get(taskId);
    if (!workspace) return null;

    const filepath = path.join(workspace.dir, filename);
    if (!fs.existsSync(filepath)) return null;

    try {
      return fs.readFileSync(filepath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Clear workspace (delete all files but keep directory)
   */
  clearWorkspace(taskId: string): void {
    const workspace = this.workspaces.get(taskId);
    if (!workspace) return;

    if (!fs.existsSync(workspace.dir)) return;

    try {
      const files = fs.readdirSync(workspace.dir);
      for (const file of files) {
        const filepath = path.join(workspace.dir, file);
        fs.unlinkSync(filepath);
      }
      log.info('workspace', `Cleared workspace`, { taskId, filesDeleted: files.length });
    } catch (err) {
      log.error('workspace', `Failed to clear workspace`, {
        taskId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Remove workspace (delete directory)
   */
  removeWorkspace(taskId: string): void {
    const workspace = this.workspaces.get(taskId);
    if (!workspace) return;

    try {
      if (fs.existsSync(workspace.dir)) {
        fs.rmSync(workspace.dir, { recursive: true, force: true });
      }
      this.workspaces.delete(taskId);
      log.info('workspace', `Removed workspace`, { taskId });
    } catch (err) {
      log.error('workspace', `Failed to remove workspace`, {
        taskId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Get base output directory
   */
  getOutputBaseDir(): string {
    return this.outputBaseDir;
  }
}

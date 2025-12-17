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
  output?: Record<string, string>;  // filename -> description
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
  createWorkspace(taskId: string, config: WorkspaceConfig): WorkspaceInfo {
    const workspaceDir = path.join(this.outputBaseDir, taskId);

    // Create directory
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }

    // Build output file map
    const outputFiles = new Map<string, string>();
    if (config.output) {
      for (const [filename, description] of Object.entries(config.output)) {
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

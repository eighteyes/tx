/**
 * WorkspaceSnapshotter - Tarball operations for workspace snapshots
 *
 * Creates and restores workspace snapshots as tarballs for checkpoint restoration.
 * Optional per-checkpoint, controlled by enable_workspace_snapshots config.
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../shared/logger.ts';

const execAsync = promisify(exec);
const COMPONENT = 'workspace-snapshotter';

export class WorkspaceSnapshotter {
  private snapshotsDir: string;

  constructor(snapshotsDir: string = '.ai/tx/data/checkpoint-snapshots') {
    this.snapshotsDir = snapshotsDir;

    // Ensure snapshots directory exists
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    log.debug(COMPONENT, 'WorkspaceSnapshotter initialized', { snapshotsDir: this.snapshotsDir });
  }

  /**
   * Create a tarball snapshot of workspace
   * Returns path to the created tarball
   */
  async snapshot(workspacePath: string, checkpointId: string): Promise<string> {
    try {
      // Validate workspace exists
      if (!fs.existsSync(workspacePath)) {
        throw new Error(`Workspace path does not exist: ${workspacePath}`);
      }

      const tarballPath = path.join(this.snapshotsDir, `${checkpointId}.tar.gz`);

      // Create tarball (preserves permissions and directory structure)
      // -czf: create gzip tarball
      // -C: change to parent directory so tarball has relative paths
      const parentDir = path.dirname(workspacePath);
      const workspaceName = path.basename(workspacePath);

      await execAsync(
        `tar -czf "${tarballPath}" -C "${parentDir}" "${workspaceName}"`,
        { maxBuffer: 100 * 1024 * 1024 } // 100MB buffer for large workspaces
      );

      log.info(COMPONENT, 'Workspace snapshot created', {
        checkpointId,
        workspacePath,
        tarballPath,
        sizeBytes: fs.statSync(tarballPath).size
      });

      return tarballPath;
    } catch (err) {
      log.error(COMPONENT, 'Failed to create workspace snapshot', {
        checkpointId,
        workspacePath,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  /**
   * Restore workspace from a tarball
   */
  async restore(checkpointId: string, targetPath: string): Promise<void> {
    try {
      const tarballPath = path.join(this.snapshotsDir, `${checkpointId}.tar.gz`);

      // Validate tarball exists
      if (!fs.existsSync(tarballPath)) {
        throw new Error(`Snapshot tarball not found: ${tarballPath}`);
      }

      // Ensure target parent directory exists
      const targetParent = path.dirname(targetPath);
      if (!fs.existsSync(targetParent)) {
        fs.mkdirSync(targetParent, { recursive: true });
      }

      // Extract tarball
      // -xzf: extract gzip tarball
      // -C: change to target parent directory
      await execAsync(
        `tar -xzf "${tarballPath}" -C "${targetParent}"`,
        { maxBuffer: 100 * 1024 * 1024 }
      );

      log.info(COMPONENT, 'Workspace restored from snapshot', {
        checkpointId,
        tarballPath,
        targetPath
      });
    } catch (err) {
      log.error(COMPONENT, 'Failed to restore workspace snapshot', {
        checkpointId,
        targetPath,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  /**
   * Check if a snapshot exists for a checkpoint
   */
  hasSnapshot(checkpointId: string): boolean {
    const tarballPath = path.join(this.snapshotsDir, `${checkpointId}.tar.gz`);
    return fs.existsSync(tarballPath);
  }

  /**
   * Get snapshot file path for a checkpoint
   */
  getSnapshotPath(checkpointId: string): string {
    return path.join(this.snapshotsDir, `${checkpointId}.tar.gz`);
  }

  /**
   * Delete a snapshot tarball
   */
  deleteSnapshot(checkpointId: string): void {
    const tarballPath = path.join(this.snapshotsDir, `${checkpointId}.tar.gz`);
    if (fs.existsSync(tarballPath)) {
      fs.unlinkSync(tarballPath);
      log.debug(COMPONENT, 'Snapshot deleted', { checkpointId, tarballPath });
    }
  }
}

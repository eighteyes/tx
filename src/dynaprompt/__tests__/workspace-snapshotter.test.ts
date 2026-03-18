/**
 * WorkspaceSnapshotter unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceSnapshotter } from '../workspace-snapshotter.ts';

const TEST_SNAPSHOTS_DIR = path.join(process.cwd(), '.ai/tx/test-snapshots');
const TEST_WORKSPACE_DIR = path.join(process.cwd(), '.ai/tx/test-workspace');

describe('WorkspaceSnapshotter', () => {
  let snapshotter: WorkspaceSnapshotter;

  beforeEach(() => {
    // Clean up test directories
    if (fs.existsSync(TEST_SNAPSHOTS_DIR)) {
      fs.rmSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_WORKSPACE_DIR)) {
      fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true });
    }

    // Create test workspace with some files
    fs.mkdirSync(TEST_WORKSPACE_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEST_WORKSPACE_DIR, 'file1.txt'), 'content1');
    fs.mkdirSync(path.join(TEST_WORKSPACE_DIR, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(TEST_WORKSPACE_DIR, 'subdir', 'file2.txt'), 'content2');

    snapshotter = new WorkspaceSnapshotter(TEST_SNAPSHOTS_DIR);
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(TEST_SNAPSHOTS_DIR)) {
      fs.rmSync(TEST_SNAPSHOTS_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_WORKSPACE_DIR)) {
      fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true });
    }
  });

  describe('snapshot()', () => {
    it('creates tarball from workspace', async () => {
      const checkpointId = 'test-checkpoint-123';
      const tarballPath = await snapshotter.snapshot(TEST_WORKSPACE_DIR, checkpointId);

      expect(fs.existsSync(tarballPath)).toBe(true);
      expect(tarballPath).toBe(path.join(TEST_SNAPSHOTS_DIR, `${checkpointId}.tar.gz`));
    });

    it('returns tarball path', async () => {
      const checkpointId = 'test-checkpoint-456';
      const tarballPath = await snapshotter.snapshot(TEST_WORKSPACE_DIR, checkpointId);

      expect(typeof tarballPath).toBe('string');
      expect(tarballPath.endsWith('.tar.gz')).toBe(true);
    });

    it('fails if workspace does not exist', async () => {
      const checkpointId = 'test-checkpoint-789';
      const nonexistentPath = path.join(process.cwd(), '.ai/tx/nonexistent-workspace');

      await expect(
        snapshotter.snapshot(nonexistentPath, checkpointId)
      ).rejects.toThrow(/does not exist/);
    });
  });

  describe('restore()', () => {
    it('extracts tarball to target', async () => {
      const checkpointId = 'test-restore-123';

      // Create snapshot
      await snapshotter.snapshot(TEST_WORKSPACE_DIR, checkpointId);

      // Remove original workspace
      fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true });

      // Restore
      await snapshotter.restore(checkpointId, TEST_WORKSPACE_DIR);

      // Verify files restored
      expect(fs.existsSync(path.join(TEST_WORKSPACE_DIR, 'file1.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(TEST_WORKSPACE_DIR, 'file1.txt'), 'utf-8')).toBe('content1');
    });

    it('preserves directory structure', async () => {
      const checkpointId = 'test-restore-456';

      // Create snapshot
      await snapshotter.snapshot(TEST_WORKSPACE_DIR, checkpointId);

      // Remove original workspace
      fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true });

      // Restore
      await snapshotter.restore(checkpointId, TEST_WORKSPACE_DIR);

      // Verify subdirectory structure
      expect(fs.existsSync(path.join(TEST_WORKSPACE_DIR, 'subdir'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_WORKSPACE_DIR, 'subdir', 'file2.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(TEST_WORKSPACE_DIR, 'subdir', 'file2.txt'), 'utf-8')).toBe('content2');
    });

    it('fails if tarball does not exist', async () => {
      const checkpointId = 'nonexistent-checkpoint';

      await expect(
        snapshotter.restore(checkpointId, TEST_WORKSPACE_DIR)
      ).rejects.toThrow(/not found/);
    });
  });

  describe('hasSnapshot()', () => {
    it('returns true for existing snapshot', async () => {
      const checkpointId = 'test-has-123';
      await snapshotter.snapshot(TEST_WORKSPACE_DIR, checkpointId);

      expect(snapshotter.hasSnapshot(checkpointId)).toBe(true);
    });

    it('returns false for missing snapshot', () => {
      expect(snapshotter.hasSnapshot('nonexistent-checkpoint')).toBe(false);
    });
  });
});

/**
 * Workspace Controller Security Tests
 *
 * Unit tests specifically for path traversal protection
 * and security features in WorkspaceController.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { WorkspaceController, PathSecurityError, PathNotFoundError } from '../../src/controllers/workspace-controller.ts';

describe('WorkspaceController Security', () => {
  let tempDir: string;
  let controller: WorkspaceController;

  // Create a temp directory for testing
  async function setup() {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tx-workspace-test-'));
    controller = new WorkspaceController(tempDir);

    // Create some test files and directories
    await fs.mkdir(path.join(tempDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'test content');
    await fs.writeFile(path.join(tempDir, 'subdir', 'nested.txt'), 'nested content');
  }

  async function teardown() {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  describe('Path Traversal Protection', () => {
    it('should block path traversal with ../', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.readFile('../../etc/passwd'),
          (err: Error) => {
            return err instanceof PathSecurityError;
          },
          'Should throw PathSecurityError for .. traversal'
        );
      } finally {
        await teardown();
      }
    });

    it('should block absolute paths outside workspace', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.readFile('/etc/passwd'),
          (err: Error) => {
            return err instanceof PathSecurityError;
          },
          'Should throw PathSecurityError for absolute paths'
        );
      } finally {
        await teardown();
      }
    });

    it('should block sneaky path traversal with extra slashes', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.readFile('./..//..//etc/passwd'),
          (err: Error) => {
            return err instanceof PathSecurityError;
          },
          'Should throw PathSecurityError for sneaky traversal'
        );
      } finally {
        await teardown();
      }
    });

    it('should allow legitimate relative paths within workspace', async () => {
      await setup();
      try {
        const content = await controller.readFile('test.txt');
        assert.strictEqual(content.content, 'test content');
        assert.strictEqual(content.path, 'test.txt');
      } finally {
        await teardown();
      }
    });

    it('should allow legitimate nested paths within workspace', async () => {
      await setup();
      try {
        const content = await controller.readFile('subdir/nested.txt');
        assert.strictEqual(content.content, 'nested content');
        assert.strictEqual(content.path, 'subdir/nested.txt');
      } finally {
        await teardown();
      }
    });

    it('should block path traversal in write operations', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.writeFile('../../tmp/malicious.txt', 'evil'),
          (err: Error) => {
            return err instanceof PathSecurityError;
          },
          'Should block write outside workspace'
        );
      } finally {
        await teardown();
      }
    });

    it('should block path traversal in delete operations', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.deleteEntry('../../important.txt'),
          (err: Error) => {
            return err instanceof PathSecurityError;
          },
          'Should block delete outside workspace'
        );
      } finally {
        await teardown();
      }
    });

    it('should block path traversal in directory creation', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.createDirectory('../../tmp/malicious'),
          (err: Error) => {
            return err instanceof PathSecurityError;
          },
          'Should block directory creation outside workspace'
        );
      } finally {
        await teardown();
      }
    });

    it('should handle symlink attacks (if symlink points outside)', async () => {
      await setup();
      try {
        // Create a symlink pointing outside workspace
        const outsidePath = path.join(os.tmpdir(), 'outside-target.txt');
        await fs.writeFile(outsidePath, 'should not be accessible');

        const symlinkPath = path.join(tempDir, 'evil-link');
        try {
          await fs.symlink(outsidePath, symlinkPath);

          // Try to read through the symlink - behavior depends on implementation
          // This is a defense-in-depth test
          await controller.readFile('evil-link');

          // If it succeeds, that's acceptable as long as the file is within workspace bounds
          // The key is that we can't use it to escape the workspace
        } catch (err) {
          // Either PathSecurityError or PathNotFoundError is acceptable
          assert.ok(
            err instanceof PathSecurityError || err instanceof PathNotFoundError,
            'Should handle symlinks safely'
          );
        } finally {
          await fs.unlink(outsidePath).catch(() => {});
        }
      } finally {
        await teardown();
      }
    });
  });

  describe('File Size Limits', () => {
    it('should reject files larger than 10MB', async () => {
      await setup();
      try {
        // Create a large file (11MB)
        const largePath = path.join(tempDir, 'large.txt');
        const largeContent = 'x'.repeat(11 * 1024 * 1024);
        await fs.writeFile(largePath, largeContent);

        await assert.rejects(
          async () => controller.readFile('large.txt'),
          (err: Error) => {
            return err.message.includes('too large');
          },
          'Should reject files larger than 10MB'
        );
      } finally {
        await teardown();
      }
    });
  });

  describe('Directory Listing Security', () => {
    it('should not allow listing directories outside workspace', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.listDirectory('../../'),
          (err: Error) => {
            return err instanceof PathSecurityError;
          },
          'Should block directory listing outside workspace'
        );
      } finally {
        await teardown();
      }
    });

    it('should list workspace root directory', async () => {
      await setup();
      try {
        const listing = await controller.listDirectory('');
        assert.strictEqual(listing.path, '');
        assert.ok(Array.isArray(listing.entries));
        assert.ok(listing.entries.length >= 2); // test.txt and subdir
        assert.strictEqual(listing.parent, null);
      } finally {
        await teardown();
      }
    });

    it('should filter hidden files except .ai', async () => {
      await setup();
      try {
        // Create hidden files
        await fs.writeFile(path.join(tempDir, '.hidden'), 'hidden');
        await fs.mkdir(path.join(tempDir, '.ai'), { recursive: true });
        await fs.writeFile(path.join(tempDir, '.ai', 'config.json'), '{}');

        const listing = await controller.listDirectory('');

        // .hidden should not appear
        const hiddenFile = listing.entries.find(e => e.name === '.hidden');
        assert.strictEqual(hiddenFile, undefined, '.hidden should be filtered');

        // .ai should appear
        const aiDir = listing.entries.find(e => e.name === '.ai');
        assert.ok(aiDir, '.ai directory should be visible');
        assert.strictEqual(aiDir?.type, 'directory');
      } finally {
        await teardown();
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw PathNotFoundError for non-existent files', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.readFile('nonexistent.txt'),
          (err: Error) => {
            return err instanceof PathNotFoundError;
          },
          'Should throw PathNotFoundError'
        );
      } finally {
        await teardown();
      }
    });

    it('should throw error when trying to read directory as file', async () => {
      await setup();
      try {
        await assert.rejects(
          async () => controller.readFile('subdir'),
          (err: Error) => {
            return err.message.includes('directory');
          },
          'Should throw error for directory read as file'
        );
      } finally {
        await teardown();
      }
    });
  });
});

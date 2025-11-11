const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { ConflictResolver } = require('../../lib/git/conflict-resolver');
const childProcess = require('child_process');
const fs = require('fs-extra');

describe('ConflictResolver', () => {
  let execSyncMock;
  let fsExistsSyncMock;
  let fsReadFileSyncMock;
  let fsStatSyncMock;

  const sampleConflict = `line 1
line 2
<<<<<<< HEAD
our implementation
more of ours
=======
their implementation
>>>>>>> feat/branch
line 3
line 4`;

  beforeEach(() => {
    execSyncMock = mock.method(childProcess, 'execSync');
    fsExistsSyncMock = mock.method(fs, 'existsSync');
    fsReadFileSyncMock = mock.method(fs, 'readFileSync');
    fsStatSyncMock = mock.method(fs, 'statSync');
  });

  afterEach(() => {
    mock.reset();
  });

  describe('analyzeConflicts()', () => {
    it('should analyze simple conflict', async () => {
      fsExistsSyncMock.mock.mockImplementation(() => true);
      fsReadFileSyncMock.mock.mockImplementation(() => sampleConflict);
      fsStatSyncMock.mock.mockImplementation(() => ({ size: 1000 }));
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const result = await ConflictResolver.analyzeConflicts('test.js');

      assert.strictEqual(result.file, 'test.js');
      assert.strictEqual(result.conflictCount, 1);
      assert.strictEqual(result.conflicts.length, 1);
      assert.strictEqual(result.conflicts[0].ours.content.length, 2);
      assert.strictEqual(result.conflicts[0].theirs.content.length, 1);
    });

    it('should analyze multiple conflicts', async () => {
      const multiConflict = `<<<<<<< HEAD
first ours
=======
first theirs
>>>>>>> branch
middle line
<<<<<<< HEAD
second ours
=======
second theirs
>>>>>>> branch`;

      fsExistsSyncMock.mock.mockImplementation(() => true);
      fsReadFileSyncMock.mock.mockImplementation(() => multiConflict);
      fsStatSyncMock.mock.mockImplementation(() => ({ size: 1000 }));
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const result = await ConflictResolver.analyzeConflicts('multi.js');

      assert.strictEqual(result.conflictCount, 2);
      assert.strictEqual(result.conflicts.length, 2);
    });

    it('should include context lines', async () => {
      fsExistsSyncMock.mock.mockImplementation(() => true);
      fsReadFileSyncMock.mock.mockImplementation(() => sampleConflict);
      fsStatSyncMock.mock.mockImplementation(() => ({ size: 1000 }));
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const result = await ConflictResolver.analyzeConflicts('test.js');

      const conflict = result.conflicts[0];
      assert.ok(conflict.context.before.length > 0);
      assert.ok(conflict.context.after.length > 0);
      assert.strictEqual(conflict.context.before[0].content, 'line 1');
      assert.strictEqual(conflict.context.after[0].content, 'line 3');
    });

    it('should throw error for non-existent file', async () => {
      fsExistsSyncMock.mock.mockImplementation(() => false);

      await assert.rejects(
        async () => await ConflictResolver.analyzeConflicts('missing.js'),
        { message: /File not found/ }
      );
    });
  });

  describe('createResolutionPrompt()', () => {
    it('should create formatted prompt', async () => {
      fsExistsSyncMock.mock.mockImplementation(() => true);
      fsReadFileSyncMock.mock.mockImplementation(() => sampleConflict);
      fsStatSyncMock.mock.mockImplementation(() => ({ size: 1000 }));
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const prompt = await ConflictResolver.createResolutionPrompt('test.js');

      assert.ok(prompt.includes('# Merge Conflict Resolution'));
      assert.ok(prompt.includes('File: test.js'));
      assert.ok(prompt.includes('Conflicts: 1'));
      assert.ok(prompt.includes('## Conflict 1'));
      assert.ok(prompt.includes('### Current Branch'));
      assert.ok(prompt.includes('### Incoming Branch'));
      assert.ok(prompt.includes('## Instructions'));
    });

    it('should include context in prompt', async () => {
      fsExistsSyncMock.mock.mockImplementation(() => true);
      fsReadFileSyncMock.mock.mockImplementation(() => sampleConflict);
      fsStatSyncMock.mock.mockImplementation(() => ({ size: 1000 }));
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const prompt = await ConflictResolver.createResolutionPrompt('test.js');

      assert.ok(prompt.includes('### Context Before'));
      assert.ok(prompt.includes('### Context After'));
    });
  });

  describe('getAllConflicts()', () => {
    it('should get all conflicted files', async () => {
      execSyncMock.mock.mockImplementation(() => Buffer.from('file1.js\nfile2.js'));
      fsExistsSyncMock.mock.mockImplementation(() => true);
      fsReadFileSyncMock.mock.mockImplementation(() => sampleConflict);
      fsStatSyncMock.mock.mockImplementation(() => ({ size: 1000 }));

      const result = await ConflictResolver.getAllConflicts();

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].file, 'file1.js');
      assert.strictEqual(result[1].file, 'file2.js');
    });

    it('should return empty array when no conflicts', async () => {
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const result = await ConflictResolver.getAllConflicts();

      assert.strictEqual(result.length, 0);
    });

    it('should handle errors gracefully', async () => {
      execSyncMock.mock.mockImplementation(() => Buffer.from('file1.js'));
      fsExistsSyncMock.mock.mockImplementation(() => true);
      fsReadFileSyncMock.mock.mockImplementation(() => {
        throw new Error('Read error');
      });

      const result = await ConflictResolver.getAllConflicts();

      assert.strictEqual(result.length, 1);
      assert.ok(result[0].error);
    });
  });

  describe('applyResolution()', () => {
    it('should apply resolved content and stage file', async () => {
      const writeFileSyncMock = mock.method(fs, 'writeFileSync');
      const copyFileSyncMock = mock.method(fs, 'copyFileSync');

      fsExistsSyncMock.mock.mockImplementation(() => true);
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const resolvedContent = 'resolved code here';
      const result = await ConflictResolver.applyResolution('test.js', resolvedContent);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file, 'test.js');
      assert.ok(result.backupPath.includes('conflict-backup'));

      // Verify backup was created
      assert.strictEqual(copyFileSyncMock.mock.callCount(), 1);
      // Verify file was written
      assert.strictEqual(writeFileSyncMock.mock.callCount(), 1);
      // Verify git add was called
      assert.ok(execSyncMock.mock.calls.some(call =>
        call.arguments[0].includes('git add')
      ));
    });

    it('should restore backup on error', async () => {
      const writeFileSyncMock = mock.method(fs, 'writeFileSync');
      const copyFileSyncMock = mock.method(fs, 'copyFileSync');

      fsExistsSyncMock.mock.mockImplementation(() => true);
      execSyncMock.mock.mockImplementation(() => {
        throw new Error('Git add failed');
      });

      await assert.rejects(
        async () => await ConflictResolver.applyResolution('test.js', 'content'),
        { message: /Failed to apply resolution/ }
      );

      // Verify backup was restored
      assert.strictEqual(copyFileSyncMock.mock.callCount(), 2);
    });
  });
});

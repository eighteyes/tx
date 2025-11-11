const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { Merge } = require('../../lib/git/merge');
const childProcess = require('child_process');
const fs = require('fs-extra');

describe('Merge', () => {
  let execSyncMock;
  let fsExistsSyncMock;
  let fsReadFileSyncMock;

  beforeEach(() => {
    execSyncMock = mock.method(childProcess, 'execSync');
    fsExistsSyncMock = mock.method(fs, 'existsSync');
    fsReadFileSyncMock = mock.method(fs, 'readFileSync');
  });

  afterEach(() => {
    mock.reset();
  });

  describe('start()', () => {
    it('should start successful merge', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') return Buffer.from('.git');
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return Buffer.from('main');
        if (cmd.startsWith('git merge')) return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => false);

      const result = await Merge.start(['feat/new']);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.mergedBranch, 'feat/new');
    });

    it('should detect conflicts during merge', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') return Buffer.from('.git');
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return Buffer.from('main');
        if (cmd.startsWith('git merge')) throw new Error('Merge conflict');
        if (cmd === 'git diff --name-only --diff-filter=U') return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => false);

      const result = await Merge.start(['feat/conflict']);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.status, 'conflicts');
    });

    it('should throw error if already in merge state', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') return Buffer.from('.git');
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => true);

      await assert.rejects(
        async () => await Merge.start(['feat/new']),
        { message: /Already in merge state/ }
      );
    });
  });

  describe('status()', () => {
    it('should return no merge status when not merging', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => false);

      const result = await Merge.status();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'none');
    });

    it('should return merge status with conflicts', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return Buffer.from('main');
        if (cmd === 'git diff --name-only --diff-filter=U') return Buffer.from('file1.js\nfile2.js');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation((path) => {
        return path.includes('MERGE_HEAD');
      });

      fsReadFileSyncMock.mock.mockImplementation(() => 'abc123def456');

      const result = await Merge.status();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, 'conflicts');
      assert.strictEqual(result.conflictCount, 2);
    });
  });

  describe('conflicts()', () => {
    it('should list conflicted files', async () => {
      const conflictContent = `line 1
<<<<<<< HEAD
our change
=======
their change
>>>>>>> feat/branch
line 2`;

      execSyncMock.mock.mockImplementation(() => Buffer.from('conflict.js'));

      fsReadFileSyncMock.mock.mockImplementation(() => conflictContent);
      fsExistsSyncMock.mock.mockImplementation(() => true);

      const result = await Merge.conflicts();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.conflicts[0].file, 'conflict.js');
      assert.strictEqual(result.conflicts[0].markerCount, 1);
    });

    it('should handle no conflicts', async () => {
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const result = await Merge.conflicts();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.count, 0);
    });
  });

  describe('resolve()', () => {
    it('should resolve using ours strategy', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd.includes('--ours')) return Buffer.from('');
        if (cmd.startsWith('git add')) return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => true);

      const result = await Merge.resolve(['conflict.js', '--strategy=ours']);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.strategy, 'ours');
    });

    it('should resolve using theirs strategy', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd.includes('--theirs')) return Buffer.from('');
        if (cmd.startsWith('git add')) return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => true);

      const result = await Merge.resolve(['conflict.js', '--strategy=theirs']);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.strategy, 'theirs');
    });

    it('should provide AI resolution data', async () => {
      const conflictContent = `line 1
<<<<<<< HEAD
our change
=======
their change
>>>>>>> feat/branch
line 2`;

      fsReadFileSyncMock.mock.mockImplementation(() => conflictContent);
      fsExistsSyncMock.mock.mockImplementation(() => true);
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const result = await Merge.resolve(['conflict.js', '--strategy=ai']);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.strategy, 'ai');
      assert.ok(result.prompt);
      assert.ok(result.analysis);
    });

    it('should throw error for invalid strategy', async () => {
      fsExistsSyncMock.mock.mockImplementation(() => true);

      await assert.rejects(
        async () => await Merge.resolve(['file.js', '--strategy=invalid']),
        { message: /Invalid strategy/ }
      );
    });
  });

  describe('abort()', () => {
    it('should abort merge', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd === 'git merge --abort') return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => true);

      const result = await Merge.abort();

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('aborted'));
    });

    it('should handle no merge to abort', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => false);

      const result = await Merge.abort();

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('No merge'));
    });
  });
});

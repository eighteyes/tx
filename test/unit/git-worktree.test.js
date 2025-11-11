const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { Worktree } = require('../../lib/git/worktree');
const childProcess = require('child_process');
const fs = require('fs-extra');

describe('Worktree', () => {
  let execSyncMock;
  let fsExistsSyncMock;

  beforeEach(() => {
    execSyncMock = mock.method(childProcess, 'execSync');
    fsExistsSyncMock = mock.method(fs, 'existsSync');
  });

  afterEach(() => {
    mock.reset();
  });

  describe('add()', () => {
    it('should create new worktree with branch', async () => {
      // Mock git commands
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') return Buffer.from('.git');
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd.startsWith('git worktree add')) return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => false);

      const result = await Worktree.add(['feat/new-feature']);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.branch, 'feat/new-feature');
      assert.ok(result.path.includes('repo-feat/new-feature'));
    });

    it('should create worktree with base branch', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') return Buffer.from('.git');
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd.includes('--base=')) return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => false);

      const result = await Worktree.add(['feat/new', '--base=main']);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.baseBranch, 'main');
    });

    it('should throw error if not in git repo', async () => {
      execSyncMock.mock.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      await assert.rejects(
        async () => await Worktree.add(['feat/new']),
        { message: 'Not in a git repository' }
      );
    });

    it('should throw error if worktree already exists', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') return Buffer.from('.git');
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => true);

      await assert.rejects(
        async () => await Worktree.add(['existing']),
        { message: /Worktree already exists/ }
      );
    });
  });

  describe('list()', () => {
    it('should list worktrees', async () => {
      const porcelainOutput = `worktree /test/repo
HEAD abc123
branch refs/heads/main

worktree /test/repo-feat
HEAD def456
branch refs/heads/feat/new

`;

      execSyncMock.mock.mockImplementation(() => porcelainOutput);

      const result = await Worktree.list();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.worktrees.length, 2);
      assert.strictEqual(result.worktrees[0].branch, 'main');
      assert.strictEqual(result.worktrees[1].branch, 'feat/new');
    });

    it('should handle empty worktree list', async () => {
      execSyncMock.mock.mockImplementation(() => '');

      const result = await Worktree.list();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.worktrees.length, 0);
    });
  });

  describe('remove()', () => {
    it('should remove worktree', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd.startsWith('git worktree remove')) return Buffer.from('');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => true);

      const result = await Worktree.remove(['feat/old']);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.branch, 'feat/old');
    });

    it('should force remove if regular removal fails', async () => {
      let callCount = 0;
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        if (cmd.startsWith('git worktree remove')) {
          callCount++;
          if (callCount === 1) throw new Error('Has modifications');
          return Buffer.from('');
        }
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => true);

      const result = await Worktree.remove(['feat/modified']);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.forced, true);
    });

    it('should throw error if worktree not found', async () => {
      execSyncMock.mock.mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/test/repo');
        throw new Error(`Unexpected command: ${cmd}`);
      });

      fsExistsSyncMock.mock.mockImplementation(() => false);

      await assert.rejects(
        async () => await Worktree.remove(['nonexistent']),
        { message: /Worktree not found/ }
      );
    });
  });

  describe('prune()', () => {
    it('should prune stale worktrees', async () => {
      execSyncMock.mock.mockImplementation(() => Buffer.from(''));

      const result = await Worktree.prune();

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('Pruned'));
    });
  });
});

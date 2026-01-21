/**
 * SDK Runner File Tracking Tests
 *
 * Tests for file change tracking in SdkRunner
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SdkRunner, type SdkRunnerConfig } from '../../src/worker/sdk-runner.ts';
import { MessageQueue } from '../../src/queue/index.ts';

const TEST_DIR = '/tmp/sdk-runner-file-test';
const TEST_QUEUE_PATH = path.join(TEST_DIR, 'test-queue.db');

describe('SDK Runner File Tracking', () => {
  let queue: MessageQueue;

  before(() => {
    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    queue = new MessageQueue(TEST_QUEUE_PATH);
  });

  after(() => {
    queue.close();
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should initialize with empty file changes', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);
    const filesChanged = runner.getFilesChanged();

    assert.ok(filesChanged, 'filesChanged should exist');
    assert.deepEqual(filesChanged.created, []);
    assert.deepEqual(filesChanged.modified, []);
    assert.deepEqual(filesChanged.deleted, []);
    assert.deepEqual(filesChanged.gitCommits, []);
  });

  test('should track file operations through getFilesChanged', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker-2',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);

    // Access private tracking methods via any to test internal functionality
    const runnerAny = runner as any;

    // Test addCreated
    runnerAny.addCreated('/test/new-file.ts');
    runnerAny.addCreated('/test/another-file.ts');

    let files = runner.getFilesChanged();
    assert.equal(files.created.length, 2);
    assert.ok(files.created.includes('/test/new-file.ts'));
    assert.ok(files.created.includes('/test/another-file.ts'));

    // Test addModified
    runnerAny.addModified('/test/existing-file.ts');

    files = runner.getFilesChanged();
    assert.equal(files.modified.length, 1);
    assert.ok(files.modified.includes('/test/existing-file.ts'));

    // Test that modifying a created file doesn't add it to modified
    runnerAny.addModified('/test/new-file.ts');
    files = runner.getFilesChanged();
    assert.equal(files.modified.length, 1); // Still just existing-file.ts
    assert.equal(files.created.length, 2); // Still has new-file.ts

    // Test addDeleted
    runnerAny.addDeleted('/test/removed-file.ts');
    files = runner.getFilesChanged();
    assert.equal(files.deleted.length, 1);
    assert.ok(files.deleted.includes('/test/removed-file.ts'));

    // Test that deleting a created file removes it from created
    runnerAny.addDeleted('/test/new-file.ts');
    files = runner.getFilesChanged();
    assert.equal(files.deleted.length, 2);
    assert.equal(files.created.length, 1); // new-file.ts removed from created
    assert.ok(!files.created.includes('/test/new-file.ts'));

    // Test addGitCommit
    runnerAny.addGitCommit('abc1234');
    runnerAny.addGitCommit('def5678');
    files = runner.getFilesChanged();
    assert.equal(files.gitCommits?.length, 2);
    assert.ok(files.gitCommits?.includes('abc1234'));
    assert.ok(files.gitCommits?.includes('def5678'));
  });

  test('should deduplicate file paths', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker-3',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);
    const runnerAny = runner as any;

    // Add same file multiple times to created
    runnerAny.addCreated('/test/dup-file.ts');
    runnerAny.addCreated('/test/dup-file.ts');
    runnerAny.addCreated('/test/dup-file.ts');

    const files = runner.getFilesChanged();
    assert.equal(files.created.length, 1, 'Should deduplicate created files');

    // Add same commit multiple times
    runnerAny.addGitCommit('same-hash');
    runnerAny.addGitCommit('same-hash');
    assert.equal(files.gitCommits?.length, 1, 'Should deduplicate git commits');
  });

  test('should parse bash rm commands', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker-4',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);
    const runnerAny = runner as any;

    // Test rm command parsing
    runnerAny.parseBashForFileOps('rm /test/file.txt');
    let files = runner.getFilesChanged();
    assert.ok(files.deleted.includes('/test/file.txt'), 'Should parse simple rm command');

    // Test rm -rf command parsing
    runnerAny.parseBashForFileOps('rm -rf /test/dir/');
    files = runner.getFilesChanged();
    assert.ok(files.deleted.includes('/test/dir/'), 'Should parse rm -rf command');

    // Test rm with multiple files
    runnerAny.parseBashForFileOps('rm file1.txt && rm file2.txt');
    files = runner.getFilesChanged();
    assert.ok(files.deleted.includes('file1.txt'), 'Should parse first rm');
    assert.ok(files.deleted.includes('file2.txt'), 'Should parse second rm');
  });

  test('should parse git commit output for commit hash', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker-5',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);
    const runnerAny = runner as any;

    // Test git commit output parsing
    const gitOutput = '[main abc1234] Add new feature';
    runnerAny.parseToolResultForCommit('Bash', gitOutput);

    const files = runner.getFilesChanged();
    assert.ok(files.gitCommits?.includes('abc1234'), 'Should extract commit hash from git output');
  });

  test('should track Write tool operations', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker-6',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);
    const runnerAny = runner as any;

    // Create a test file to simulate existing file
    const testFile = path.join(TEST_DIR, 'existing.txt');
    fs.writeFileSync(testFile, 'content');

    // Test Write on existing file (should be modified)
    runnerAny.trackFileOperation('Write', { file_path: testFile });
    let files = runner.getFilesChanged();
    assert.ok(files.modified.includes(testFile), 'Write on existing file should track as modified');

    // Test Write on new file (should be created)
    const newFile = path.join(TEST_DIR, 'new-file.txt');
    runnerAny.trackFileOperation('Write', { file_path: newFile });
    files = runner.getFilesChanged();
    assert.ok(files.created.includes(newFile), 'Write on non-existing file should track as created');

    // Clean up
    fs.unlinkSync(testFile);
  });

  test('should track Edit tool operations', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker-7',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);
    const runnerAny = runner as any;

    // Test Edit operation
    runnerAny.trackFileOperation('Edit', { file_path: '/test/edit-file.ts' });

    const files = runner.getFilesChanged();
    assert.ok(files.modified.includes('/test/edit-file.ts'), 'Edit should track as modified');
  });

  test('should track NotebookEdit operations', () => {
    const config: SdkRunnerConfig = {
      id: 'test-worker-8',
      model: 'haiku',
      systemPrompt: 'Test prompt',
      workDir: TEST_DIR,
      msgsDir: path.join(TEST_DIR, 'msgs')
    };

    const runner = new SdkRunner(config, queue);
    const runnerAny = runner as any;

    // Test NotebookEdit operation
    runnerAny.trackFileOperation('NotebookEdit', { notebook_path: '/test/notebook.ipynb' });

    const files = runner.getFilesChanged();
    assert.ok(files.modified.includes('/test/notebook.ipynb'), 'NotebookEdit should track as modified');
  });
});

/**
 * Test 9: Workspace System
 *
 * Tests the workspace system that creates task-scoped output directories
 * and injects workspace context into agent prompts.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceManager, PromptInjector } from '../../src/workspace/index.ts';

describe('V4 Workspace System Test', () => {
  let testDir: string;
  let workspaceManager: WorkspaceManager;
  let promptInjector: PromptInjector;

  beforeEach(() => {
    // Create temp test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-workspace-'));
    workspaceManager = new WorkspaceManager(testDir);
    promptInjector = new PromptInjector();
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('should create workspace directory', () => {
    const taskId = 'task-123';
    const config = {
      output: {
        'plan.md': 'Implementation plan',
        'progress.json': 'Task progress tracking'
      }
    };

    const workspace = workspaceManager.createWorkspace(taskId, config);

    assert.strictEqual(workspace.taskId, taskId);
    assert.ok(fs.existsSync(workspace.dir), 'Workspace directory should exist');
    assert.strictEqual(workspace.outputFiles.size, 2, 'Should have 2 output files configured');
    assert.strictEqual(workspace.outputFiles.get('plan.md'), 'Implementation plan');
    assert.strictEqual(workspace.outputFiles.get('progress.json'), 'Task progress tracking');
  });

  test('should create workspace with no output files', () => {
    const taskId = 'task-456';
    const config = {};

    const workspace = workspaceManager.createWorkspace(taskId, config);

    assert.strictEqual(workspace.taskId, taskId);
    assert.ok(fs.existsSync(workspace.dir), 'Workspace directory should exist');
    assert.strictEqual(workspace.outputFiles.size, 0, 'Should have no output files configured');
  });

  test('should retrieve workspace by task ID', () => {
    const taskId = 'task-789';
    const config = { output: { 'result.txt': 'Task result' } };

    workspaceManager.createWorkspace(taskId, config);
    const retrieved = workspaceManager.getWorkspace(taskId);

    assert.ok(retrieved, 'Should retrieve workspace');
    assert.strictEqual(retrieved?.taskId, taskId);
  });

  test('should check if workspace exists', () => {
    const taskId = 'task-abc';
    const config = {};

    assert.strictEqual(workspaceManager.hasWorkspace(taskId), false, 'Should not have workspace initially');

    workspaceManager.createWorkspace(taskId, config);

    assert.strictEqual(workspaceManager.hasWorkspace(taskId), true, 'Should have workspace after creation');
  });

  test('should list workspace files', () => {
    const taskId = 'task-def';
    const config = {};
    const workspace = workspaceManager.createWorkspace(taskId, config);

    // Write some test files
    fs.writeFileSync(path.join(workspace.dir, 'file1.md'), 'content 1');
    fs.writeFileSync(path.join(workspace.dir, 'file2.json'), 'content 2');

    const files = workspaceManager.listWorkspaceFiles(taskId);

    assert.strictEqual(files.length, 2, 'Should list 2 files');
    assert.ok(files.includes('file1.md'), 'Should include file1.md');
    assert.ok(files.includes('file2.json'), 'Should include file2.json');
  });

  test('should read workspace file', () => {
    const taskId = 'task-ghi';
    const config = {};
    const workspace = workspaceManager.createWorkspace(taskId, config);

    const testContent = 'test file content';
    fs.writeFileSync(path.join(workspace.dir, 'test.md'), testContent);

    const content = workspaceManager.readWorkspaceFile(taskId, 'test.md');

    assert.strictEqual(content, testContent, 'Should read file content correctly');
  });

  test('should return null for non-existent file', () => {
    const taskId = 'task-jkl';
    const config = {};
    workspaceManager.createWorkspace(taskId, config);

    const content = workspaceManager.readWorkspaceFile(taskId, 'non-existent.md');

    assert.strictEqual(content, null, 'Should return null for non-existent file');
  });

  test('should clear workspace files', () => {
    const taskId = 'task-mno';
    const config = {};
    const workspace = workspaceManager.createWorkspace(taskId, config);

    // Create some files
    fs.writeFileSync(path.join(workspace.dir, 'file1.md'), 'content');
    fs.writeFileSync(path.join(workspace.dir, 'file2.md'), 'content');

    assert.strictEqual(workspaceManager.listWorkspaceFiles(taskId).length, 2);

    workspaceManager.clearWorkspace(taskId);

    assert.strictEqual(workspaceManager.listWorkspaceFiles(taskId).length, 0, 'Should clear all files');
    assert.ok(fs.existsSync(workspace.dir), 'Directory should still exist');
  });

  test('should remove workspace completely', () => {
    const taskId = 'task-pqr';
    const config = {};
    const workspace = workspaceManager.createWorkspace(taskId, config);

    assert.ok(fs.existsSync(workspace.dir));

    workspaceManager.removeWorkspace(taskId);

    assert.ok(!fs.existsSync(workspace.dir), 'Directory should be removed');
    assert.strictEqual(workspaceManager.hasWorkspace(taskId), false, 'Should not have workspace after removal');
  });

  test('should inject workspace context into prompt', () => {
    const taskId = 'task-stu';
    const config = {
      output: {
        'plan.md': 'Implementation plan',
        'code.ts': 'Implementation code'
      }
    };

    const workspace = workspaceManager.createWorkspace(taskId, config);
    const basePrompt = 'You are a helpful coding assistant.';

    const injectedPrompt = promptInjector.injectWorkspace(basePrompt, { workspace, taskId });

    assert.ok(injectedPrompt.includes(basePrompt), 'Should include base prompt');
    assert.ok(injectedPrompt.includes('Task Workspace'), 'Should include workspace header');
    assert.ok(injectedPrompt.includes('plan.md'), 'Should mention plan.md');
    assert.ok(injectedPrompt.includes('Implementation plan'), 'Should include file description');
    assert.ok(injectedPrompt.includes('code.ts'), 'Should mention code.ts');
    assert.ok(injectedPrompt.includes(workspace.dir), 'Should include workspace directory path');
  });

  test('should inject workspace context with no output files', () => {
    const taskId = 'task-vwx';
    const config = {};

    const workspace = workspaceManager.createWorkspace(taskId, config);
    const basePrompt = 'You are a helpful assistant.';

    const injectedPrompt = promptInjector.injectWorkspace(basePrompt, { workspace, taskId });

    assert.ok(injectedPrompt.includes(basePrompt), 'Should include base prompt');
    assert.ok(injectedPrompt.includes('Task Workspace'), 'Should include workspace header');
    assert.ok(injectedPrompt.includes(workspace.dir), 'Should include workspace directory path');
  });

  test('should build output summary', () => {
    const taskId = 'task-yz1';
    const config = {
      output: {
        'result.md': 'Task results',
        'data.json': 'Output data'
      }
    };

    const workspace = workspaceManager.createWorkspace(taskId, config);

    // Create expected file + additional file
    fs.writeFileSync(path.join(workspace.dir, 'result.md'), 'results');
    fs.writeFileSync(path.join(workspace.dir, 'extra.txt'), 'extra');

    const actualFiles = workspaceManager.listWorkspaceFiles(taskId);
    const summary = promptInjector.buildOutputSummary(workspace, actualFiles);

    assert.ok(summary.includes('Workspace Output Summary'), 'Should include summary header');
    assert.ok(summary.includes(taskId), 'Should include task ID');
    assert.ok(summary.includes('✓'), 'Should show checkmark for created file');
    assert.ok(summary.includes('✗'), 'Should show X for missing file');
    assert.ok(summary.includes('result.md'), 'Should list expected file');
    assert.ok(summary.includes('data.json'), 'Should list expected file');
    assert.ok(summary.includes('extra.txt'), 'Should list additional file');
  });

  test('should get output base directory', () => {
    const baseDir = workspaceManager.getOutputBaseDir();
    assert.strictEqual(baseDir, path.join(testDir, '.ai', 'tx', 'output'));
  });
});

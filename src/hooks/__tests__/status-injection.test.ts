/**
 * Status Injection Hook Test
 *
 * Verifies the status:injection pre-hook properly injects TX system state
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { statusInjectionHook } from '../pre/status-injection.ts';
import { MessageQueue } from '../../queue/index.ts';
import { WorktreeManager } from '../../core/worktree.ts';
import { createHookUtils } from '../utils/hook-utils.ts';
import type { HookContext } from '../types.ts';

test('status:injection hook', async (t) => {
  let tmpDir: string;
  let queue: MessageQueue;

  t.before(() => {
    // Create temp directory for test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-status-injection-test-'));

    // Create necessary directories
    const txDir = path.join(tmpDir, '.ai', 'tx');
    const dataDir = path.join(txDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(txDir, 'msgs'), { recursive: true });

    // Initialize queue with proper database path
    const dbPath = path.join(dataDir, 'queue.db');
    queue = new MessageQueue(dbPath);
  });

  t.after(() => {
    // Cleanup
    queue?.close();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('should have correct metadata', () => {
    assert.strictEqual(statusInjectionHook.name, 'status:injection');
    assert.strictEqual(statusInjectionHook.phase, 'pre');
    assert.strictEqual(statusInjectionHook.priority, 10);
    assert.strictEqual(typeof statusInjectionHook.handler, 'function');
  });

  await t.test('should inject status in passive mode (default)', async () => {
    // Setup workers.json
    const workersPath = path.join(tmpDir, '.ai', 'tx', 'data', 'workers.json');
    fs.writeFileSync(
      workersPath,
      JSON.stringify({
        workers: [
          {
            id: 'w1',
            agentId: 'dev/implementer',
            status: 'running',
            startedAt: Date.now() - 45000, // 45s ago
            messagesProcessed: 1,
            duration: 45000,
          },
        ],
        updatedAt: Date.now(),
      })
    );

    const context: HookContext = {
      meshInstance: 'dev-001',
      workDir: tmpDir,
      agentId: 'dev/tester',
      meshName: 'dev',
      agentName: 'tester',
      msgsDir: path.join(tmpDir, '.ai', 'tx', 'msgs'),
    };

    const worktreeManager = new WorktreeManager(tmpDir);
    const utils = createHookUtils(queue, worktreeManager, tmpDir);

    // Execute hook
    await statusInjectionHook.handler(context, utils);

    // Verify status injection was set
    assert.ok(context.statusInjection, 'Status injection should be set');
    assert.ok(typeof context.statusInjection === 'string', 'Should be a string');

    // Verify content
    assert.ok(context.statusInjection.includes('[TX System State]'));
    assert.ok(context.statusInjection.includes('Meshes: dev(1)'));
    assert.ok(context.statusInjection.includes('Locked: dev/implementer'));
    assert.ok(context.statusInjection.includes('Write response messages to:'));
  });

  await t.test('should inject status in active mode', async () => {
    // Set active mode
    process.env.TX_STATUS_INJECTION_MODE = 'active';

    // Setup workers.json
    const workersPath = path.join(tmpDir, '.ai', 'tx', 'data', 'workers.json');
    fs.writeFileSync(
      workersPath,
      JSON.stringify({
        workers: [
          {
            id: 'w1',
            agentId: 'brain/brain',
            status: 'running',
            startedAt: Date.now() - 10000,
            messagesProcessed: 2,
            duration: 10000,
          },
        ],
        updatedAt: Date.now(),
      })
    );

    // Create a message file
    const msgsDir = path.join(tmpDir, '.ai', 'tx', 'msgs');
    const msgPath = path.join(msgsDir, '1234-task-brain--dev-test.md');
    const msgContent = `---
to: dev/test
from: brain/brain
type: task
---
Test task from brain`;
    fs.writeFileSync(msgPath, msgContent);

    // Queue the message
    queue.insert({
      from_agent: 'brain/brain',
      to_agent: 'dev/test',
      type: 'task',
      payload: { filepath: msgPath },
    });

    const context: HookContext = {
      meshInstance: 'dev-002',
      workDir: tmpDir,
      agentId: 'dev/test',
      meshName: 'dev',
      agentName: 'test',
      msgsDir,
    };

    const worktreeManager = new WorktreeManager(tmpDir);
    const utils = createHookUtils(queue, worktreeManager, tmpDir);

    // Execute hook
    await statusInjectionHook.handler(context, utils);

    // Verify active mode includes message content
    assert.ok(context.statusInjection, 'Status injection should be set');
    assert.ok(context.statusInjection.includes('[Message from brain/brain]'));
    assert.ok(context.statusInjection.includes('Test task from brain'));

    // Cleanup
    delete process.env.TX_STATUS_INJECTION_MODE;
  });

  await t.test('should fail silently when workers.json missing', async () => {
    // Remove workers.json
    const workersPath = path.join(tmpDir, '.ai', 'tx', 'data', 'workers.json');
    if (fs.existsSync(workersPath)) {
      fs.unlinkSync(workersPath);
    }

    const context: HookContext = {
      meshInstance: 'dev-003',
      workDir: tmpDir,
      agentId: 'dev/tester',
      meshName: 'dev',
      agentName: 'tester',
      msgsDir: path.join(tmpDir, '.ai', 'tx', 'msgs'),
    };

    const worktreeManager = new WorktreeManager(tmpDir);
    const utils = createHookUtils(queue, worktreeManager, tmpDir);

    // Execute hook - should not throw
    await statusInjectionHook.handler(context, utils);

    // Verify basic state was still injected (with empty worker list)
    assert.ok(context.statusInjection, 'Status injection should be set even without workers');
    assert.ok(context.statusInjection.includes('[TX System State]'));
    assert.ok(context.statusInjection.includes('Meshes: none'));
  });

  await t.test('should show pending asks count', async () => {
    // Create an ask-human message and get its ID
    const msgId = queue.insert({
      from_agent: 'dev/implementer',
      to_agent: 'core/core',
      type: 'ask-human',
      payload: { question: 'Test question' },
    });

    // Mark it as pending ask
    queue.trackPendingAsk('dev/implementer', 'core/core', String(msgId));

    const context: HookContext = {
      meshInstance: 'dev-004',
      workDir: tmpDir,
      agentId: 'dev/tester',
      meshName: 'dev',
      agentName: 'tester',
      msgsDir: path.join(tmpDir, '.ai', 'tx', 'msgs'),
    };

    const worktreeManager = new WorktreeManager(tmpDir);
    const utils = createHookUtils(queue, worktreeManager, tmpDir);

    // Execute hook
    await statusInjectionHook.handler(context, utils);

    // Verify pending asks count
    assert.ok(context.statusInjection, 'Status injection should be set');
    assert.ok(context.statusInjection.includes('Pending asks: 1'));
  });
});

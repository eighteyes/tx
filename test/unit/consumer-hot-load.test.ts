/**
 * Consumer Unit Tests - Hot-Loading (Mesh Hot-Registration)
 *
 * Tests that new meshes added after TX starts are detected and loaded
 * on first message (lazy/on-demand loading).
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MessageQueue } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('Consumer Hot-Loading', () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-hot-load');
    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue, env.meshesDir);
    await consumer.start();
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    await consumer.stop();
    queue.close();
    env.cleanup();
  });

  test('Hot-loads mesh config when message sent to new mesh', async () => {
    // Create a new mesh AFTER consumer has started
    const newMeshDir = path.join(env.meshesDir, 'bug-sleuth');
    fs.mkdirSync(newMeshDir, { recursive: true });
    fs.writeFileSync(
      path.join(newMeshDir, 'config.yaml'),
      `mesh: bug-sleuth
entry_point: detective
agents:
  - name: detective
    model: sonnet
    prompt: "You are a bug detective."
`
    );

    // Send a message to the new mesh
    const msgFile = path.join(
      env.msgsDir,
      `${Date.now()}-core-core--bug-sleuth-detective-test.md`
    );
    fs.writeFileSync(
      msgFile,
      `---
to: bug-sleuth/detective
from: core/core
msg-id: hot-load-test
headline: Find the bug
timestamp: ${new Date().toISOString()}
---

Please investigate the memory leak.
`
    );

    await new Promise(resolve => setTimeout(resolve, 600));

    // Message should be queued for the newly hot-loaded mesh
    const messages = queue.poll('bug-sleuth/detective');
    assert.strictEqual(messages.length, 1, 'Message should be delivered to hot-loaded mesh');
    assert.strictEqual(messages[0].from_agent, 'core/core');
    assert.ok(
      (messages[0].payload.body as string)?.includes('memory leak'),
      'Body should be preserved'
    );
  });

  test('Hot-loads mesh using entry_point resolution', async () => {
    // Create mesh with custom entry_point
    const newMeshDir = path.join(env.meshesDir, 'code-review');
    fs.mkdirSync(newMeshDir, { recursive: true });
    fs.writeFileSync(
      path.join(newMeshDir, 'config.yaml'),
      `mesh: code-review
entry_point: reviewer
agents:
  - name: reviewer
    model: haiku
    prompt: "You review code."
  - name: approver
    model: sonnet
    prompt: "You approve changes."
`
    );

    // Send message to mesh name only (should resolve to entry_point)
    const msgFile = path.join(
      env.msgsDir,
      `${Date.now()}-core-core--code-review-worker-test.md`
    );
    fs.writeFileSync(
      msgFile,
      `---
to: code-review
from: core/core
msg-id: entry-point-test
headline: Review this PR
timestamp: ${new Date().toISOString()}
---

Please review PR #123.
`
    );

    await new Promise(resolve => setTimeout(resolve, 600));

    // Should be routed to entry_point 'reviewer'
    const messages = queue.poll('code-review/reviewer');
    assert.strictEqual(messages.length, 1, 'Message should route to entry_point');
    assert.strictEqual(messages[0].from_agent, 'core/core');
  });

  test('Drops message when mesh truly does not exist', async () => {
    // DO NOT create the mesh - it should not exist

    let errorWritten = false;
    const originalWriteFile = fs.writeFileSync;
    const writeFileSpy = (filepath: string | Buffer | URL | number, data: string | NodeJS.ArrayBufferView, ...args: any[]) => {
      if (typeof filepath === 'string' && filepath.includes('error-system--core-core')) {
        errorWritten = true;
      }
      return originalWriteFile(filepath as string, data, ...(args as [fs.WriteFileOptions | undefined]));
    };
    fs.writeFileSync = writeFileSpy as typeof fs.writeFileSync;

    try {
      // Send message to nonexistent mesh
      const msgFile = path.join(
        env.msgsDir,
        `${Date.now()}-core-core--nonexistent-worker-test.md`
      );
      fs.writeFileSync(
        msgFile,
        `---
to: nonexistent/worker
from: core/core
msg-id: nonexistent-test
headline: This should fail
timestamp: ${new Date().toISOString()}
---

This mesh does not exist.
`
      );

      await new Promise(resolve => setTimeout(resolve, 600));

      // Message should NOT be queued (dropped)
      const messages = queue.poll('nonexistent/worker');
      assert.strictEqual(messages.length, 0, 'Message to nonexistent mesh should be dropped');

      // Error message should have been written to core
      assert.ok(errorWritten, 'Error message should be written to core');
    } finally {
      fs.writeFileSync = originalWriteFile;
    }
  });

  test('Hot-loads mesh with JSON config', async () => {
    // Create mesh with JSON config format
    const newMeshDir = path.join(env.meshesDir, 'json-mesh');
    fs.mkdirSync(newMeshDir, { recursive: true });
    fs.writeFileSync(
      path.join(newMeshDir, 'config.json'),
      JSON.stringify({
        mesh: 'json-mesh',
        entry_point: 'processor',
        agents: [
          { name: 'processor', model: 'haiku', prompt: 'Process data.' }
        ]
      }, null, 2)
    );

    // Send message to the JSON-configured mesh
    const msgFile = path.join(
      env.msgsDir,
      `${Date.now()}-core-core--json-mesh-processor-test.md`
    );
    fs.writeFileSync(
      msgFile,
      `---
to: json-mesh/processor
from: core/core
msg-id: json-config-test
headline: Process this
timestamp: ${new Date().toISOString()}
---

Process the data.
`
    );

    await new Promise(resolve => setTimeout(resolve, 600));

    // Message should be queued
    const messages = queue.poll('json-mesh/processor');
    assert.strictEqual(messages.length, 1, 'Message should be delivered to JSON-configured mesh');
  });

  test('Hot-loads mesh with .yml extension', async () => {
    // Create mesh with .yml config
    const newMeshDir = path.join(env.meshesDir, 'yml-mesh');
    fs.mkdirSync(newMeshDir, { recursive: true });
    fs.writeFileSync(
      path.join(newMeshDir, 'config.yml'),
      `mesh: yml-mesh
entry_point: handler
agents:
  - name: handler
    model: haiku
    prompt: "Handle requests."
`
    );

    const msgFile = path.join(
      env.msgsDir,
      `${Date.now()}-core-core--yml-mesh-handler-test.md`
    );
    fs.writeFileSync(
      msgFile,
      `---
to: yml-mesh/handler
from: core/core
msg-id: yml-test
headline: Handle this
timestamp: ${new Date().toISOString()}
---

Please handle this request.
`
    );

    await new Promise(resolve => setTimeout(resolve, 600));

    const messages = queue.poll('yml-mesh/handler');
    assert.strictEqual(messages.length, 1, 'Message should be delivered to .yml-configured mesh');
  });
});

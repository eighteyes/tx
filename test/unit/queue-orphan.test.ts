/**
 * Queue Orphan Detection Test
 *
 * Tests findOrphanedMessages and markMessageFailed methods that prevent
 * infinite retry loops when agents are renamed or removed from mesh configs.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('Queue Orphan Detection', () => {
  let env: TestEnv;
  let queue: MessageQueue;

  before(async () => {
    env = createTestEnv('queue-orphan');
    queue = new MessageQueue(env.dbPath);
  });

  after(async () => {
    if (queue) queue.close();
    env.cleanup();
  });

  describe('findOrphanedMessages()', () => {
    it('returns messages for non-existent agents', () => {
      // Insert messages for agents that exist and ones that do not
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'research/architect',
        payload: { body: 'design the system' },
      });
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'research/writer',
        payload: { body: 'write the docs' },
      });

      // Only 'research/writer' is valid; 'research/architect' was renamed
      const validAgentIds = new Set(['research/writer', 'core/core']);
      const orphans = queue.findOrphanedMessages(validAgentIds);

      assert.strictEqual(orphans.length, 1);
      assert.strictEqual(orphans[0].to_agent, 'research/architect');
    });

    it('returns empty when all agents valid', () => {
      // Clear previous test data
      queue.clearAllMessages();

      queue.insert({
        from_agent: 'core/core',
        to_agent: 'mesh/agent-a',
        payload: { body: 'task a' },
      });
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'mesh/agent-b',
        payload: { body: 'task b' },
      });

      const validAgentIds = new Set(['mesh/agent-a', 'mesh/agent-b', 'core/core']);
      const orphans = queue.findOrphanedMessages(validAgentIds);

      assert.strictEqual(orphans.length, 0);
    });

    it('ignores delivered messages', () => {
      queue.clearAllMessages();

      const id = queue.insert({
        from_agent: 'core/core',
        to_agent: 'mesh/removed-agent',
        payload: { body: 'old task' },
      });

      // Mark as delivered so it is no longer pending
      queue.markProcessed(id);

      const validAgentIds = new Set(['core/core']);
      const orphans = queue.findOrphanedMessages(validAgentIds);

      assert.strictEqual(orphans.length, 0);
    });
  });

  describe('markMessageFailed()', () => {
    it('changes message status to failed', () => {
      queue.clearAllMessages();

      const id = queue.insert({
        from_agent: 'core/core',
        to_agent: 'mesh/old-agent',
        payload: { body: 'stale task' },
      });

      queue.markMessageFailed(id, 'Agent no longer exists: mesh/old-agent');

      // Message should no longer appear as pending
      const pending = queue.peek('mesh/old-agent');
      assert.strictEqual(pending.length, 0);

      // Verify status is 'failed' via queryMessages
      const failed = queue.queryMessages({ status: 'failed', to_agent: 'mesh/old-agent' });
      assert.strictEqual(failed.length, 1);
      assert.strictEqual(failed[0].id, id);
    });

    it('stores failure reason in payload', () => {
      queue.clearAllMessages();

      const id = queue.insert({
        from_agent: 'core/core',
        to_agent: 'mesh/gone',
        payload: { body: 'task' },
      });

      const reason = 'Agent no longer exists: mesh/gone';
      queue.markMessageFailed(id, reason);

      const failed = queue.queryMessages({ status: 'failed', to_agent: 'mesh/gone' });
      assert.strictEqual(failed.length, 1);
      assert.strictEqual(failed[0].payload.fail_reason, reason);
    });
  });
});

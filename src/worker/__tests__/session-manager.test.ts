/**
 * SessionManager tests
 *
 * Tests session suspend/resume and response buffering.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { SessionManager } from '../session-manager.ts';
import { MessageQueue } from '../../queue/index.ts';

describe('SessionManager', () => {
  const testDir = path.join(process.cwd(), '.test-session-manager');
  const dbPath = path.join(testDir, 'test-queue.db');
  let queue: MessageQueue;
  let manager: SessionManager;

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    queue = new MessageQueue(dbPath);
    manager = new SessionManager(queue);
  });

  afterEach(() => {
    queue.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('suspend()', () => {
    it('should suspend a session', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      assert.strictEqual(manager.isSuspended('mesh/agent'), true);
    });

    it('should store session details', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      const suspended = manager.get('mesh/agent');
      assert.ok(suspended);
      assert.strictEqual(suspended.sessionId, 'session-123');
      assert.strictEqual(suspended.reason, 'ask-human');
      assert.strictEqual(suspended.meshName, 'mesh');
      assert.ok(suspended.targetAgents.has('core/core'));
    });

    it('should emit session:suspended event', () => {
      let emitted = false;
      manager.on('session:suspended', () => {
        emitted = true;
      });

      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      assert.strictEqual(emitted, true);
    });

    it('should persist to SQLite', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      const dbSession = queue.getSuspendedSession('mesh/agent');
      assert.ok(dbSession);
      assert.strictEqual(dbSession.sessionId, 'session-123');
    });
  });

  describe('markResumed()', () => {
    it('should mark session as resumed', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      const returned = manager.markResumed('mesh/agent');

      assert.ok(returned);
      assert.strictEqual(returned.sessionId, 'session-123');
      assert.strictEqual(manager.isSuspended('mesh/agent'), false);
    });

    it('should emit session:resumed event', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      let emitted = false;
      manager.on('session:resumed', () => {
        emitted = true;
      });

      manager.markResumed('mesh/agent');

      assert.strictEqual(emitted, true);
    });

    it('should remove from SQLite', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      manager.markResumed('mesh/agent');

      const dbSession = queue.getSuspendedSession('mesh/agent');
      assert.strictEqual(dbSession, null);
    });
  });

  describe('hasPendingAskHumanForMesh()', () => {
    it('should return true if mesh has ask-human session', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      assert.strictEqual(manager.hasPendingAskHumanForMesh('mesh'), true);
    });

    it('should return false for await-response sessions', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'await-response',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['mesh/other'],
        pendingCount: 1,
      });

      assert.strictEqual(manager.hasPendingAskHumanForMesh('mesh'), false);
    });

    it('should return false for different mesh', () => {
      manager.suspend('mesh1/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        meshName: 'mesh1',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      assert.strictEqual(manager.hasPendingAskHumanForMesh('mesh2'), false);
    });
  });

  describe('bufferResponse()', () => {
    it('should buffer responses', () => {
      manager.bufferResponse('mesh/agent', {
        from: 'core/core',
        content: 'response 1',
      });
      manager.bufferResponse('mesh/agent', {
        from: 'mesh/other',
        content: 'response 2',
        headline: 'Subject',
      });

      assert.strictEqual(manager.getBufferedResponseCount('mesh/agent'), 2);
    });
  });

  describe('getAndClearBufferedResponses()', () => {
    it('should return and clear responses', () => {
      manager.bufferResponse('mesh/agent', { from: 'core/core', content: 'response' });

      const responses = manager.getAndClearBufferedResponses('mesh/agent');

      assert.strictEqual(responses.length, 1);
      assert.strictEqual(responses[0].content, 'response');
      assert.strictEqual(manager.getBufferedResponseCount('mesh/agent'), 0);
    });

    it('should return empty array if no buffered responses', () => {
      const responses = manager.getAndClearBufferedResponses('mesh/agent');
      assert.deepStrictEqual(responses, []);
    });
  });

  describe('removeTargetAgent()', () => {
    it('should remove target and return true when all responded', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'await-response',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['mesh/target'],
        pendingCount: 1,
      });

      const allResponded = manager.removeTargetAgent('mesh/agent', 'mesh/target');

      assert.strictEqual(allResponded, true);
    });

    it('should return false if more targets remain', () => {
      manager.suspend('mesh/agent', {
        sessionId: 'session-123',
        reason: 'await-response',
        meshName: 'mesh',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['mesh/target1', 'mesh/target2'],
        pendingCount: 2,
      });

      const allResponded = manager.removeTargetAgent('mesh/agent', 'mesh/target1');

      assert.strictEqual(allResponded, false);
      assert.strictEqual(manager.get('mesh/agent')?.targetAgents.size, 1);
    });
  });

  describe('clearForMesh()', () => {
    it('should clear sessions and buffers for mesh', () => {
      manager.suspend('mesh1/agent', {
        sessionId: 'session-1',
        reason: 'ask-human',
        meshName: 'mesh1',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });
      manager.bufferResponse('mesh1/agent', { from: 'core/core', content: 'response' });

      manager.suspend('mesh2/agent', {
        sessionId: 'session-2',
        reason: 'ask-human',
        meshName: 'mesh2',
        agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      const result = manager.clearForMesh('mesh1');

      assert.strictEqual(result.sessions, 1);
      assert.strictEqual(result.buffers, 1);
      assert.strictEqual(manager.isSuspended('mesh1/agent'), false);
      assert.strictEqual(manager.isSuspended('mesh2/agent'), true);
    });
  });

  describe('buildAskResponsePrompt()', () => {
    it('should build prompt for single response', () => {
      const prompt = manager.buildAskResponsePrompt([
        { from: 'core/core', content: 'Hello', headline: 'Subject' },
      ]);

      assert.ok(prompt.includes('Ask Response Received'));
      assert.ok(prompt.includes('core/core'));
      assert.ok(prompt.includes('Hello'));
      assert.ok(prompt.includes('Subject'));
    });

    it('should build prompt for multiple responses', () => {
      const prompt = manager.buildAskResponsePrompt([
        { from: 'agent1', content: 'Response 1' },
        { from: 'agent2', content: 'Response 2' },
      ]);

      assert.ok(prompt.includes('Ask Responses Received (2 total)'));
      assert.ok(prompt.includes('Response 1'));
      assert.ok(prompt.includes('Response 2'));
    });
  });

  describe('buildBatchedAskResponseContent()', () => {
    it('should return content for single response', () => {
      const content = manager.buildBatchedAskResponseContent([
        { from: 'core/core', content: 'Hello' },
      ]);

      assert.strictEqual(content, 'Hello');
    });

    it('should build combined content for multiple responses', () => {
      const content = manager.buildBatchedAskResponseContent([
        { from: 'user1', content: 'Response 1', headline: 'First' },
        { from: 'user2', content: 'Response 2' },
      ]);

      assert.ok(content.includes('Human Responses (2 total)'));
      assert.ok(content.includes('First'));
      assert.ok(content.includes('Response 1'));
      assert.ok(content.includes('Response 2'));
    });
  });

  describe('restoreFromDatabase()', () => {
    it('should restore sessions from database', () => {
      // Manually insert a session into the database
      queue.suspendSession('mesh/agent', {
        sessionId: 'session-123',
        reason: 'ask-human',
        suspendedAt: Date.now(),
        meshName: 'mesh',
        targetAgents: ['core/core'],
        pendingCount: 1,
      });

      // Create new manager to test restoration
      const newManager = new SessionManager(queue);
      const count = newManager.restoreFromDatabase((meshName, agentName) => {
        if (meshName === 'mesh' && agentName === 'agent') {
          return { name: 'agent', model: 'sonnet', prompt: 'test' };
        }
        return undefined;
      });

      assert.strictEqual(count, 1);
      assert.strictEqual(newManager.isSuspended('mesh/agent'), true);
    });
  });
});

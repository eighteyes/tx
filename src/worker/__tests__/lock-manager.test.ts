/**
 * LockManager tests
 *
 * Tests OAOM (One-Agent-One-Message) lock management.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LockManager, type LockReason } from '../lock-manager.ts';

describe('LockManager', () => {
  let lockManager: LockManager;

  beforeEach(() => {
    lockManager = new LockManager();
  });

  describe('acquire()', () => {
    it('should acquire a lock for an agent', () => {
      lockManager.acquire('mesh/agent', 'processing');

      assert.strictEqual(lockManager.isLocked('mesh/agent'), true);
    });

    it('should store lock reason and timestamp', () => {
      const before = Date.now();
      lockManager.acquire('mesh/agent', 'awaiting-human', 'worker-123', 'session-abc');
      const after = Date.now();

      const lock = lockManager.getState('mesh/agent');
      assert.ok(lock);
      assert.strictEqual(lock.reason, 'awaiting-human');
      assert.strictEqual(lock.workerId, 'worker-123');
      assert.strictEqual(lock.sessionId, 'session-abc');
      assert.ok(lock.since >= before && lock.since <= after);
    });

    it('should emit agent:locked event', () => {
      let emitted = false;
      let eventData: { agentId: string; reason: LockReason } | null = null;

      lockManager.on('agent:locked', (data) => {
        emitted = true;
        eventData = data;
      });

      lockManager.acquire('mesh/agent', 'processing');

      assert.strictEqual(emitted, true);
      assert.deepStrictEqual(eventData, { agentId: 'mesh/agent', reason: 'processing' });
    });
  });

  describe('isLocked()', () => {
    it('should return false for unlocked agent', () => {
      assert.strictEqual(lockManager.isLocked('mesh/agent'), false);
    });

    it('should return true for locked agent', () => {
      lockManager.acquire('mesh/agent', 'processing');
      assert.strictEqual(lockManager.isLocked('mesh/agent'), true);
    });
  });

  describe('release()', () => {
    it('should release a lock', () => {
      lockManager.acquire('mesh/agent', 'processing');
      lockManager.release('mesh/agent');

      assert.strictEqual(lockManager.isLocked('mesh/agent'), false);
    });

    it('should emit agent:unlocked event', () => {
      let emitted = false;
      let eventAgentId = '';
      let eventWasLocked: LockReason = 'processing';
      let eventDuration = 0;

      lockManager.acquire('mesh/agent', 'processing');

      lockManager.on('agent:unlocked', (data: { agentId: string; wasLocked: LockReason; duration: number }) => {
        emitted = true;
        eventAgentId = data.agentId;
        eventWasLocked = data.wasLocked;
        eventDuration = data.duration;
      });

      lockManager.release('mesh/agent');

      assert.strictEqual(emitted, true);
      assert.strictEqual(eventAgentId, 'mesh/agent');
      assert.strictEqual(eventWasLocked, 'processing');
      assert.ok(eventDuration >= 0);
    });

    it('should invoke onUnlock callback', () => {
      let callbackCalled = false;
      let callbackAgentId = '';

      lockManager.setOnUnlockCallback((agentId) => {
        callbackCalled = true;
        callbackAgentId = agentId;
      });

      lockManager.acquire('mesh/agent', 'processing');
      lockManager.release('mesh/agent');

      assert.strictEqual(callbackCalled, true);
      assert.strictEqual(callbackAgentId, 'mesh/agent');
    });

    it('should do nothing if agent is not locked', () => {
      // Should not throw
      lockManager.release('mesh/agent');
      assert.strictEqual(lockManager.isLocked('mesh/agent'), false);
    });
  });

  describe('updateReason()', () => {
    it('should update lock reason', () => {
      lockManager.acquire('mesh/agent', 'processing');
      lockManager.updateReason('mesh/agent', 'awaiting-human');

      const lock = lockManager.getState('mesh/agent');
      assert.strictEqual(lock?.reason, 'awaiting-human');
    });

    it('should preserve original timestamp', () => {
      lockManager.acquire('mesh/agent', 'processing');
      const originalSince = lockManager.getState('mesh/agent')?.since;

      // Small delay
      lockManager.updateReason('mesh/agent', 'awaiting-agent');

      const updatedSince = lockManager.getState('mesh/agent')?.since;
      assert.strictEqual(updatedSince, originalSince);
    });

    it('should do nothing if agent is not locked', () => {
      lockManager.updateReason('mesh/agent', 'awaiting-human');
      assert.strictEqual(lockManager.getState('mesh/agent'), undefined);
    });
  });

  describe('hasLockWithReason()', () => {
    it('should return true if lock has matching reason', () => {
      lockManager.acquire('mesh/agent', 'awaiting-human');
      assert.strictEqual(lockManager.hasLockWithReason('mesh/agent', 'awaiting-human'), true);
    });

    it('should return false if lock has different reason', () => {
      lockManager.acquire('mesh/agent', 'processing');
      assert.strictEqual(lockManager.hasLockWithReason('mesh/agent', 'awaiting-human'), false);
    });

    it('should return false if agent is not locked', () => {
      assert.strictEqual(lockManager.hasLockWithReason('mesh/agent', 'processing'), false);
    });
  });

  describe('clearForMesh()', () => {
    it('should clear all locks for a mesh', () => {
      lockManager.acquire('mesh1/agent1', 'processing');
      lockManager.acquire('mesh1/agent2', 'awaiting-human');
      lockManager.acquire('mesh2/agent1', 'processing');

      const cleared = lockManager.clearForMesh('mesh1');

      assert.strictEqual(cleared, 2);
      assert.strictEqual(lockManager.isLocked('mesh1/agent1'), false);
      assert.strictEqual(lockManager.isLocked('mesh1/agent2'), false);
      assert.strictEqual(lockManager.isLocked('mesh2/agent1'), true);
    });

    it('should return 0 if no locks for mesh', () => {
      lockManager.acquire('mesh2/agent1', 'processing');
      const cleared = lockManager.clearForMesh('mesh1');
      assert.strictEqual(cleared, 0);
    });
  });

  describe('getLockedAgentIds()', () => {
    it('should return all locked agent IDs', () => {
      lockManager.acquire('mesh/agent1', 'processing');
      lockManager.acquire('mesh/agent2', 'awaiting-human');

      const ids = lockManager.getLockedAgentIds();

      assert.deepStrictEqual(ids.sort(), ['mesh/agent1', 'mesh/agent2']);
    });

    it('should return empty array if no locks', () => {
      assert.deepStrictEqual(lockManager.getLockedAgentIds(), []);
    });
  });

  describe('getAllLocks()', () => {
    it('should return a copy of all locks', () => {
      lockManager.acquire('mesh/agent', 'processing');

      const locks = lockManager.getAllLocks();

      assert.strictEqual(locks.size, 1);
      assert.ok(locks.has('mesh/agent'));

      // Verify it's a copy (modifying returned map doesn't affect original)
      locks.delete('mesh/agent');
      assert.strictEqual(lockManager.isLocked('mesh/agent'), true);
    });
  });

  describe('getLockedCount()', () => {
    it('should return count of locked agents', () => {
      assert.strictEqual(lockManager.getLockedCount(), 0);

      lockManager.acquire('mesh/agent1', 'processing');
      assert.strictEqual(lockManager.getLockedCount(), 1);

      lockManager.acquire('mesh/agent2', 'awaiting-human');
      assert.strictEqual(lockManager.getLockedCount(), 2);

      lockManager.release('mesh/agent1');
      assert.strictEqual(lockManager.getLockedCount(), 1);
    });
  });
});

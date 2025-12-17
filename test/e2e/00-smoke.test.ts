/**
 * V4 Smoke Test - Test 0
 *
 * Verifies that core can start in a tmux session.
 * This is the first TDD test for TX V4.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { TmuxSession } from '../../src/core/tmux.ts';

const TEST_SESSION = 'tx-v4-test';

describe('V4 Smoke Test', () => {
  let session: TmuxSession;

  before(async () => {
    // Clean up any existing test session
    session = new TmuxSession(TEST_SESSION);
    await session.kill().catch(() => {}); // Ignore if doesn't exist
  });

  after(async () => {
    // Cleanup: kill test session
    if (session) {
      await session.kill().catch(() => {});
    }
  });

  it('should create a tmux session', async () => {
    const created = await session.create();
    assert.strictEqual(created, true, 'Session should be created successfully');
  });

  it('should verify session exists after creation', async () => {
    // Create first if not exists
    await session.create().catch(() => {});

    const exists = await session.exists();
    assert.strictEqual(exists, true, 'Session should exist after creation');
  });

  it('should kill the session', async () => {
    // Ensure session exists first
    await session.create().catch(() => {});

    const killed = await session.kill();
    assert.strictEqual(killed, true, 'Session should be killed successfully');

    // Verify it no longer exists
    const existsAfter = await session.exists();
    assert.strictEqual(existsAfter, false, 'Session should not exist after kill');
  });
});

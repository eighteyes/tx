/**
 * SessionStore Unit Tests
 *
 * Tests for session awareness Phase 1 infrastructure
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../../src/session/session-store.ts';
import type { SessionMetadata } from '../../src/session/types.ts';

const TEST_DB_PATH = '/tmp/test-sessions.db';

describe('SessionStore', () => {
  let store: SessionStore;

  before(() => {
    // Clean up any existing test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    store = new SessionStore(TEST_DB_PATH);
  });

  after(() => {
    store.close();
    // Clean up test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    // Clean up WAL files
    [TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm'].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  test('should record and retrieve a session', () => {
    const session: SessionMetadata = {
      id: 'test-session-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/test-session-1.md',
      messageCount: 5,
      toolCalls: 3,
      headline: 'Test session headline',
      tags: ['test', 'unit-test'],
      createdAt: Date.now()
    };

    store.recordSession(session);
    const retrieved = store.getSession('test-session-1');

    assert.ok(retrieved, 'Session should be retrieved');
    assert.equal(retrieved.id, session.id);
    assert.equal(retrieved.agentId, session.agentId);
    assert.equal(retrieved.meshId, session.meshId);
    assert.equal(retrieved.messageCount, session.messageCount);
    assert.deepEqual(retrieved.tags, session.tags);
  });

  test('should update session metadata', () => {
    const session: SessionMetadata = {
      id: 'test-session-2',
      agentId: 'dev/tester',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/test-session-2.md',
      createdAt: Date.now()
    };

    store.recordSession(session);

    const endedAt = Date.now();
    store.updateSession('test-session-2', {
      endedAt,
      durationSeconds: 120,
      finalStatus: 'success',
      messageCount: 10,
      toolCalls: 5
    });

    const updated = store.getSession('test-session-2');
    assert.ok(updated, 'Updated session should exist');
    assert.equal(updated.endedAt, endedAt);
    assert.equal(updated.durationSeconds, 120);
    assert.equal(updated.finalStatus, 'success');
    assert.equal(updated.messageCount, 10);
    assert.equal(updated.toolCalls, 5);
  });

  test('should list sessions for an agent', () => {
    const sessions: SessionMetadata[] = [
      {
        id: 'list-test-1',
        agentId: 'dev/reviewer',
        meshId: 'dev',
        startedAt: Date.now() - 3000,
        transcriptPath: '/test/sessions/list-test-1.md',
        createdAt: Date.now() - 3000
      },
      {
        id: 'list-test-2',
        agentId: 'dev/reviewer',
        meshId: 'dev',
        startedAt: Date.now() - 2000,
        transcriptPath: '/test/sessions/list-test-2.md',
        createdAt: Date.now() - 2000
      },
      {
        id: 'list-test-3',
        agentId: 'dev/reviewer',
        meshId: 'dev',
        startedAt: Date.now() - 1000,
        transcriptPath: '/test/sessions/list-test-3.md',
        createdAt: Date.now() - 1000
      }
    ];

    sessions.forEach(s => store.recordSession(s));

    const listed = store.listSessions('dev/reviewer', 10);
    assert.equal(listed.length, 3);
    // Should be ordered by most recent first
    assert.equal(listed[0].id, 'list-test-3');
    assert.equal(listed[1].id, 'list-test-2');
    assert.equal(listed[2].id, 'list-test-1');
  });

  test('should index and search session content', () => {
    const session: SessionMetadata = {
      id: 'search-test-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/search-test-1.md',
      headline: 'Implementing authentication feature',
      tags: ['auth', 'security'],
      createdAt: Date.now()
    };

    store.recordSession(session);
    store.indexSessionContent(
      'search-test-1',
      'This session implements user authentication with JWT tokens and bcrypt password hashing',
      session.headline,
      session.tags
    );

    // Search for "authentication"
    const results1 = store.search('authentication');
    assert.ok(results1.length > 0, 'Should find sessions matching "authentication"');
    assert.ok(results1.some(r => r.id === 'search-test-1'), 'Should find our test session');

    // Search for "JWT"
    const results2 = store.search('JWT');
    assert.ok(results2.length > 0, 'Should find sessions matching "JWT"');
    assert.ok(results2.some(r => r.id === 'search-test-1'), 'Should find our test session');

    // Verify snippet is included
    const result = results1.find(r => r.id === 'search-test-1');
    assert.ok(result?.snippet, 'Result should include snippet');
  });

  test('should cache and retrieve summaries', () => {
    const session: SessionMetadata = {
      id: 'summary-test-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/summary-test-1.md',
      createdAt: Date.now()
    };

    store.recordSession(session);

    const summaryContent = 'This is a test summary of the session';
    store.cacheSummary('summary-test-1', 'summary', summaryContent);

    const retrieved = store.getCachedSummary('summary-test-1', 'summary');
    assert.equal(retrieved, summaryContent, 'Cached summary should match');

    // Different type should not exist
    const notFound = store.getCachedSummary('summary-test-1', 'final-answer');
    assert.equal(notFound, null, 'Different summary type should not exist');
  });

  test('should prune old sessions', () => {
    const oldSession: SessionMetadata = {
      id: 'old-session-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now() - (100 * 24 * 60 * 60 * 1000), // 100 days ago
      transcriptPath: '/test/sessions/old-session-1.md',
      createdAt: Date.now() - (100 * 24 * 60 * 60 * 1000)
    };

    const recentSession: SessionMetadata = {
      id: 'recent-session-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/recent-session-1.md',
      createdAt: Date.now()
    };

    store.recordSession(oldSession);
    store.recordSession(recentSession);

    // Prune sessions older than 30 days
    const pruned = store.pruneOldSessions(30);
    assert.equal(pruned, 1, 'Should prune 1 old session');

    // Verify old session is gone
    const oldRetrieved = store.getSession('old-session-1');
    assert.equal(oldRetrieved, null, 'Old session should be deleted');

    // Verify recent session still exists
    const recentRetrieved = store.getSession('recent-session-1');
    assert.ok(recentRetrieved, 'Recent session should still exist');
  });

  test('should get database stats', () => {
    const stats = store.getStats();
    assert.ok(stats.sessionCount > 0, 'Should have sessions');
    assert.ok(typeof stats.ftsEntries === 'number', 'Should report FTS entries');
    assert.ok(typeof stats.summaryCount === 'number', 'Should report summary count');
  });

  test('should check if session exists', () => {
    const session: SessionMetadata = {
      id: 'exists-test-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/exists-test-1.md',
      createdAt: Date.now()
    };

    store.recordSession(session);

    assert.ok(store.hasSession('exists-test-1'), 'Should return true for existing session');
    assert.ok(!store.hasSession('non-existent'), 'Should return false for non-existent session');
  });

  test('should handle partial updates correctly', () => {
    const session: SessionMetadata = {
      id: 'partial-update-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/partial-update-1.md',
      messageCount: 5,
      createdAt: Date.now()
    };

    store.recordSession(session);

    // Update only message count
    store.updateSession('partial-update-1', { messageCount: 10 });

    const updated = store.getSession('partial-update-1');
    assert.equal(updated?.messageCount, 10, 'Message count should be updated');
    assert.equal(updated?.endedAt, undefined, 'Other fields should remain unchanged');
  });

  test('should handle FTS search with agent filter', () => {
    const session1: SessionMetadata = {
      id: 'filter-test-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/filter-test-1.md',
      createdAt: Date.now()
    };

    const session2: SessionMetadata = {
      id: 'filter-test-2',
      agentId: 'dev/tester',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/filter-test-2.md',
      createdAt: Date.now()
    };

    store.recordSession(session1);
    store.recordSession(session2);
    store.indexSessionContent('filter-test-1', 'unique test content for filtering');
    store.indexSessionContent('filter-test-2', 'unique test content for filtering');

    // Search with agent filter
    const results = store.search('unique test', 'dev/implementer');
    assert.ok(results.length > 0, 'Should find results');
    assert.ok(results.every(r => r.agentId === 'dev/implementer'), 'All results should match agent filter');
  });
});

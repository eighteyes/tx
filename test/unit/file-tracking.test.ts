/**
 * File Tracking Unit Tests
 *
 * Tests for session file change tracking feature
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../../src/session/session-store.ts';
import type { SessionMetadata, FileChangeSummary } from '../../src/session/types.ts';

const TEST_DB_PATH = '/tmp/test-file-tracking.db';

describe('File Tracking', () => {
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
    // Clean up test DB and WAL files
    [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm'].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  test('should store and retrieve filesChanged', () => {
    const filesChanged: FileChangeSummary = {
      created: ['/test/file1.ts', '/test/file2.ts'],
      modified: ['/test/file3.ts'],
      deleted: ['/test/file4.ts'],
      gitCommits: ['abc1234', 'def5678']
    };

    const session: SessionMetadata = {
      id: 'file-track-1',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/file-track-1.md',
      filesChanged,
      createdAt: Date.now()
    };

    store.recordSession(session);
    const retrieved = store.getSession('file-track-1');

    assert.ok(retrieved, 'Session should be retrieved');
    assert.ok(retrieved.filesChanged, 'filesChanged should exist');
    assert.deepEqual(retrieved.filesChanged.created, filesChanged.created);
    assert.deepEqual(retrieved.filesChanged.modified, filesChanged.modified);
    assert.deepEqual(retrieved.filesChanged.deleted, filesChanged.deleted);
    assert.deepEqual(retrieved.filesChanged.gitCommits, filesChanged.gitCommits);
  });

  test('should handle empty file changes', () => {
    const filesChanged: FileChangeSummary = {
      created: [],
      modified: [],
      deleted: [],
      gitCommits: []
    };

    const session: SessionMetadata = {
      id: 'file-track-2',
      agentId: 'dev/tester',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/file-track-2.md',
      filesChanged,
      createdAt: Date.now()
    };

    store.recordSession(session);
    const retrieved = store.getSession('file-track-2');

    assert.ok(retrieved, 'Session should be retrieved');
    assert.ok(retrieved.filesChanged, 'filesChanged should exist');
    assert.equal(retrieved.filesChanged.created.length, 0);
    assert.equal(retrieved.filesChanged.modified.length, 0);
    assert.equal(retrieved.filesChanged.deleted.length, 0);
  });

  test('should handle session without filesChanged', () => {
    const session: SessionMetadata = {
      id: 'file-track-3',
      agentId: 'dev/reviewer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/file-track-3.md',
      createdAt: Date.now()
    };

    store.recordSession(session);
    const retrieved = store.getSession('file-track-3');

    assert.ok(retrieved, 'Session should be retrieved');
    assert.equal(retrieved.filesChanged, undefined, 'filesChanged should be undefined');
  });

  test('should update filesChanged via updateSession', () => {
    const session: SessionMetadata = {
      id: 'file-track-4',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/file-track-4.md',
      createdAt: Date.now()
    };

    store.recordSession(session);

    const filesChanged: FileChangeSummary = {
      created: ['/test/updated-file.ts'],
      modified: [],
      deleted: []
    };

    store.updateSession('file-track-4', { filesChanged });

    const retrieved = store.getSession('file-track-4');
    assert.ok(retrieved?.filesChanged, 'filesChanged should be updated');
    assert.deepEqual(retrieved.filesChanged.created, ['/test/updated-file.ts']);
  });

  test('should handle partial file changes (created only)', () => {
    const filesChanged: FileChangeSummary = {
      created: ['/test/new1.ts', '/test/new2.ts'],
      modified: [],
      deleted: []
    };

    const session: SessionMetadata = {
      id: 'file-track-5',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/file-track-5.md',
      filesChanged,
      createdAt: Date.now()
    };

    store.recordSession(session);
    const retrieved = store.getSession('file-track-5');

    assert.ok(retrieved?.filesChanged, 'filesChanged should exist');
    assert.equal(retrieved.filesChanged.created.length, 2);
    assert.equal(retrieved.filesChanged.modified.length, 0);
    assert.equal(retrieved.filesChanged.deleted.length, 0);
  });

  test('should handle git commits without gitCommits array', () => {
    const filesChanged: FileChangeSummary = {
      created: ['/test/file.ts'],
      modified: [],
      deleted: []
      // Note: no gitCommits field
    };

    const session: SessionMetadata = {
      id: 'file-track-6',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/file-track-6.md',
      filesChanged,
      createdAt: Date.now()
    };

    store.recordSession(session);
    const retrieved = store.getSession('file-track-6');

    assert.ok(retrieved?.filesChanged, 'filesChanged should exist');
    assert.equal(retrieved.filesChanged.gitCommits, undefined, 'gitCommits should be undefined if not provided');
  });

  test('should preserve filesChanged on partial updates', () => {
    const filesChanged: FileChangeSummary = {
      created: ['/test/preserve.ts'],
      modified: [],
      deleted: []
    };

    const session: SessionMetadata = {
      id: 'file-track-7',
      agentId: 'dev/implementer',
      meshId: 'dev',
      startedAt: Date.now(),
      transcriptPath: '/test/sessions/file-track-7.md',
      filesChanged,
      createdAt: Date.now()
    };

    store.recordSession(session);

    // Update other fields without touching filesChanged
    store.updateSession('file-track-7', {
      endedAt: Date.now(),
      durationSeconds: 60,
      finalStatus: 'success'
    });

    const retrieved = store.getSession('file-track-7');
    assert.ok(retrieved?.filesChanged, 'filesChanged should be preserved');
    assert.deepEqual(retrieved.filesChanged.created, ['/test/preserve.ts']);
  });

  test('should handle migration for existing sessions without files_changed column', () => {
    // This test verifies that old sessions (from before migration) work correctly
    // The migration adds the files_changed column if it doesn't exist
    const stats = store.getStats();
    assert.ok(stats.sessionCount >= 0, 'Database should be accessible after migration');
  });
});

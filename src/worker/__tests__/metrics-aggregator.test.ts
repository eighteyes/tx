/**
 * MetricsAggregator tests
 *
 * Tests session and worker metrics tracking, persistence, and event emission.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MetricsAggregator } from '../metrics-aggregator.ts';
import type { SemanticModel } from '../../shared/types.ts';

describe('MetricsAggregator', () => {
  const testDir = path.join(process.cwd(), '.test-metrics-aggregator');
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    aggregator = new MetricsAggregator(testDir);
  });

  afterEach(() => {
    aggregator.shutdown();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initSession()', () => {
    it('should initialize a new session', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      assert.strictEqual(aggregator.hasSession('dev-1234567890'), true);
      assert.strictEqual(aggregator.getSessionCount(), 1);
    });

    it('should set initial session values correctly', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      const session = aggregator.getSession('dev-1234567890');
      assert.ok(session);
      assert.strictEqual(session.meshName, 'dev');
      assert.strictEqual(session.workers.length, 0);
      assert.strictEqual(session.totalInputTokens, 0);
      assert.strictEqual(session.totalOutputTokens, 0);
      assert.strictEqual(session.totalCostUsd, 0);
      assert.strictEqual(session.totalToolCalls, 0);
      assert.strictEqual(session.workerCount, 0);
      assert.ok(session.startedAt > 0);
    });

    it('should not overwrite existing session', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      const session = aggregator.getSession('dev-1234567890');
      const originalStartedAt = session?.startedAt;

      // Try to init again
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      const sessionAfter = aggregator.getSession('dev-1234567890');
      assert.strictEqual(sessionAfter?.startedAt, originalStartedAt);
    });

    it('should emit metrics:updated event', () => {
      let emitted = false;
      let eventData: unknown;

      aggregator.on('metrics:updated', (data) => {
        emitted = true;
        eventData = data;
      });

      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      assert.strictEqual(emitted, true);
      assert.deepStrictEqual(eventData, {
        type: 'session',
        meshInstance: 'dev-1234567890',
      });
    });
  });

  describe('trackWorkerComplete()', () => {
    beforeEach(() => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });
    });

    it('should accumulate worker metrics into session', () => {
      aggregator.trackWorkerComplete('dev-1234567890', {
        agentId: 'dev/implementer',
        model: 'sonnet' as SemanticModel,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCostUsd: 0.05,
        totalToolCalls: 10,
        startedAt: Date.now() - 5000,
      });

      const session = aggregator.getSession('dev-1234567890');
      assert.ok(session);
      assert.strictEqual(session.workerCount, 1);
      assert.strictEqual(session.totalInputTokens, 1000);
      assert.strictEqual(session.totalOutputTokens, 500);
      assert.strictEqual(session.totalCostUsd, 0.05);
      assert.strictEqual(session.totalToolCalls, 10);
      assert.strictEqual(session.workers.length, 1);
    });

    it('should accumulate multiple workers', () => {
      aggregator.trackWorkerComplete('dev-1234567890', {
        agentId: 'dev/implementer',
        model: 'sonnet' as SemanticModel,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCostUsd: 0.05,
        totalToolCalls: 10,
        startedAt: Date.now() - 5000,
      });

      aggregator.trackWorkerComplete('dev-1234567890', {
        agentId: 'dev/tester',
        model: 'haiku' as SemanticModel,
        totalInputTokens: 500,
        totalOutputTokens: 200,
        totalCostUsd: 0.01,
        totalToolCalls: 5,
        startedAt: Date.now() - 3000,
      });

      const session = aggregator.getSession('dev-1234567890');
      assert.ok(session);
      assert.strictEqual(session.workerCount, 2);
      assert.strictEqual(session.totalInputTokens, 1500);
      assert.strictEqual(session.totalOutputTokens, 700);
      // Use approximate comparison for floating point
      assert.ok(Math.abs(session.totalCostUsd - 0.06) < 0.0001);
      assert.strictEqual(session.totalToolCalls, 15);
      assert.strictEqual(session.workers.length, 2);
    });

    it('should set completedAt on worker', () => {
      const beforeTrack = Date.now();

      aggregator.trackWorkerComplete('dev-1234567890', {
        agentId: 'dev/implementer',
        model: 'sonnet' as SemanticModel,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCostUsd: 0.05,
        startedAt: Date.now() - 5000,
      });

      const session = aggregator.getSession('dev-1234567890');
      assert.ok(session);
      assert.ok(session.workers[0].completedAt);
      assert.ok(session.workers[0].completedAt >= beforeTrack);
    });

    it('should emit metrics:updated event', () => {
      let emitted = false;
      let eventData: unknown;

      aggregator.on('metrics:updated', (data) => {
        if (data.type === 'worker') {
          emitted = true;
          eventData = data;
        }
      });

      aggregator.trackWorkerComplete('dev-1234567890', {
        agentId: 'dev/implementer',
        model: 'sonnet' as SemanticModel,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCostUsd: 0.05,
        startedAt: Date.now(),
      });

      assert.strictEqual(emitted, true);
      assert.deepStrictEqual(eventData, {
        type: 'worker',
        meshInstance: 'dev-1234567890',
        agentId: 'dev/implementer',
      });
    });

    it('should handle missing session gracefully', () => {
      // Should not throw
      aggregator.trackWorkerComplete('nonexistent-session', {
        agentId: 'dev/implementer',
        model: 'sonnet' as SemanticModel,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCostUsd: 0.05,
        startedAt: Date.now(),
      });

      assert.strictEqual(aggregator.hasSession('nonexistent-session'), false);
    });
  });

  describe('markSessionComplete()', () => {
    it('should set completedAt and calculate duration', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      // Wait a bit to ensure measurable duration
      const session = aggregator.markSessionComplete('dev-1234567890');

      assert.ok(session);
      assert.ok(session.completedAt);
      assert.ok(session.totalDurationMs >= 0);
    });

    it('should return undefined for unknown session', () => {
      const result = aggregator.markSessionComplete('nonexistent');
      assert.strictEqual(result, undefined);
    });
  });

  describe('finalizeSession()', () => {
    it('should remove session from tracking', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      assert.strictEqual(aggregator.hasSession('dev-1234567890'), true);

      aggregator.finalizeSession('dev-1234567890');

      assert.strictEqual(aggregator.hasSession('dev-1234567890'), false);
    });

    it('should emit session:complete event', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      let emitted = false;
      aggregator.on('session:complete', () => {
        emitted = true;
      });

      aggregator.finalizeSession('dev-1234567890');

      assert.strictEqual(emitted, true);
    });

    it('should return the finalized session', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      const session = aggregator.finalizeSession('dev-1234567890');

      assert.ok(session);
      assert.strictEqual(session.meshName, 'dev');
      assert.ok(session.completedAt);
    });
  });

  describe('findSessionByMeshName()', () => {
    it('should find session by mesh name', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      const result = aggregator.findSessionByMeshName('dev');

      assert.ok(result);
      assert.strictEqual(result.key, 'dev-1234567890');
      assert.strictEqual(result.session.meshName, 'dev');
    });

    it('should return undefined for unknown mesh', () => {
      const result = aggregator.findSessionByMeshName('unknown');
      assert.strictEqual(result, undefined);
    });
  });

  describe('summarize()', () => {
    it('should return correct totals across sessions', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      aggregator.trackWorkerComplete('dev-1234567890', {
        agentId: 'dev/implementer',
        model: 'sonnet' as SemanticModel,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCostUsd: 0.05,
        totalToolCalls: 10,
        startedAt: Date.now(),
      });

      aggregator.initSession({
        meshInstance: 'brain-9876543210',
        meshName: 'brain',
      });

      aggregator.trackWorkerComplete('brain-9876543210', {
        agentId: 'brain/brain',
        model: 'opus' as SemanticModel,
        totalInputTokens: 2000,
        totalOutputTokens: 1000,
        totalCostUsd: 0.20,
        totalToolCalls: 5,
        startedAt: Date.now(),
      });

      const summary = aggregator.summarize();

      assert.strictEqual(summary.activeSessions, 2);
      assert.strictEqual(summary.totalWorkers, 2);
      assert.strictEqual(summary.totalInputTokens, 3000);
      assert.strictEqual(summary.totalOutputTokens, 1500);
      assert.strictEqual(summary.totalCostUsd, 0.25);
      assert.strictEqual(summary.totalToolCalls, 15);
      assert.strictEqual(summary.sessions.length, 2);
    });

    it('should return empty summary when no sessions', () => {
      const summary = aggregator.summarize();

      assert.strictEqual(summary.activeSessions, 0);
      assert.strictEqual(summary.totalWorkers, 0);
      assert.strictEqual(summary.totalInputTokens, 0);
      assert.strictEqual(summary.totalOutputTokens, 0);
      assert.strictEqual(summary.totalCostUsd, 0);
      assert.strictEqual(summary.totalToolCalls, 0);
      assert.strictEqual(summary.sessions.length, 0);
    });
  });

  describe('persistence', () => {
    it('should persist metrics to disk', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      aggregator.persist();

      const metricsPath = path.join(testDir, '.ai', 'tx', 'data', 'metrics.json');
      assert.ok(fs.existsSync(metricsPath));

      const content = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      assert.strictEqual(content.sessions.length, 1);
      assert.strictEqual(content.sessions[0].meshName, 'dev');
      assert.ok(content.updatedAt > 0);
    });

    it('should load metrics from disk', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      aggregator.trackWorkerComplete('dev-1234567890', {
        agentId: 'dev/implementer',
        model: 'sonnet' as SemanticModel,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCostUsd: 0.05,
        startedAt: Date.now(),
      });

      aggregator.persist();

      // Create new aggregator and load
      const newAggregator = new MetricsAggregator(testDir);
      const loaded = newAggregator.loadFromDisk();

      assert.strictEqual(loaded, true);
      assert.strictEqual(newAggregator.hasSession('dev-1234567890'), true);

      const session = newAggregator.getSession('dev-1234567890');
      assert.ok(session);
      assert.strictEqual(session.totalInputTokens, 1000);
      assert.strictEqual(session.workerCount, 1);

      newAggregator.shutdown();
    });

    it('should return false when no metrics file exists', () => {
      const loaded = aggregator.loadFromDisk();
      assert.strictEqual(loaded, false);
    });
  });

  describe('clearForMesh()', () => {
    it('should clear sessions for specific mesh', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      aggregator.initSession({
        meshInstance: 'brain-9876543210',
        meshName: 'brain',
      });

      const cleared = aggregator.clearForMesh('dev');

      assert.strictEqual(cleared, 1);
      assert.strictEqual(aggregator.hasSession('dev-1234567890'), false);
      assert.strictEqual(aggregator.hasSession('brain-9876543210'), true);
    });

    it('should return 0 when no matching sessions', () => {
      const cleared = aggregator.clearForMesh('nonexistent');
      assert.strictEqual(cleared, 0);
    });
  });

  describe('clear()', () => {
    it('should clear all sessions', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      aggregator.initSession({
        meshInstance: 'brain-9876543210',
        meshName: 'brain',
      });

      aggregator.clear();

      assert.strictEqual(aggregator.getSessionCount(), 0);
    });
  });

  describe('getSessionKeys()', () => {
    it('should return all session keys', () => {
      aggregator.initSession({
        meshInstance: 'dev-1234567890',
        meshName: 'dev',
      });

      aggregator.initSession({
        meshInstance: 'brain-9876543210',
        meshName: 'brain',
      });

      const keys = aggregator.getSessionKeys();

      assert.strictEqual(keys.length, 2);
      assert.ok(keys.includes('dev-1234567890'));
      assert.ok(keys.includes('brain-9876543210'));
    });
  });
});

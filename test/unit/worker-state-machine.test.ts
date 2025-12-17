/**
 * Unit Tests for WorkerStateMachine
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { WorkerStateMachine } from '../../src/state-machine/workers/worker-state.ts';
import type { WorkerConfig } from '../../src/shared/types.ts';

describe('WorkerStateMachine', () => {
  let machine: WorkerStateMachine;
  const testConfig: WorkerConfig = {
    id: 'test-worker',
    model: 'sonnet',
    prompt: 'test prompt'
  };

  before(() => {
    machine = new WorkerStateMachine(
      'test-worker',
      testConfig,
      'test-mesh',
      'test-agent'
    );
  });

  it('should start in pending state', () => {
    assert.strictEqual(machine.getStatus(), 'pending');
    const state = machine.getState();
    assert.strictEqual((state as any).status, 'pending');
  });

  it('should transition from pending to initializing', async () => {
    const transitionPromise = new Promise((resolve) => {
      machine.once('transition', (event) => {
        resolve(event);
      });
    });

    await machine.initialize();

    const event = await transitionPromise as any;
    assert.strictEqual(event.transitionName, 'initialize');
    assert.strictEqual(event.from.status, 'pending');
    assert.strictEqual(event.to.status, 'initializing');
    assert.strictEqual(machine.getStatus(), 'initializing');
  });

  it('should transition from initializing to running', async () => {
    const machine2 = new WorkerStateMachine('test-worker-2', testConfig, 'test-mesh', 'test-agent');
    await machine2.initialize();

    const transitionPromise = new Promise((resolve) => {
      machine2.once('transition', (event) => {
        resolve(event);
      });
    });

    await machine2.start(12345);

    const event = await transitionPromise as any;
    assert.strictEqual(event.transitionName, 'start');
    assert.strictEqual(event.to.status, 'running');
    assert.strictEqual(event.to.pid, 12345);
    assert.strictEqual(machine2.getStatus(), 'running');
  });

  it('should transition from running to idle', async () => {
    const machine3 = new WorkerStateMachine('test-worker-3', testConfig, 'test-mesh', 'test-agent');
    await machine3.initialize();
    await machine3.start(12345);

    await machine3.markIdle();

    assert.strictEqual(machine3.getStatus(), 'idle');
    assert.strictEqual(machine3.getMessagesProcessed(), 1);
  });

  it('should transition from idle to running (resume)', async () => {
    const machine4 = new WorkerStateMachine('test-worker-4', testConfig, 'test-mesh', 'test-agent');
    await machine4.initialize();
    await machine4.start(12345);
    await machine4.markIdle();

    await machine4.processNext();

    assert.strictEqual(machine4.getStatus(), 'running');
  });

  it('should transition from running to complete', async () => {
    const machine5 = new WorkerStateMachine('test-worker-5', testConfig, 'test-mesh', 'test-agent');
    await machine5.initialize();
    await machine5.start(12345);

    const result = {
      success: true,
      messagesProcessed: 5
    };

    await machine5.complete(result);

    assert.strictEqual(machine5.getStatus(), 'complete');
    const state = machine5.getState() as any;
    assert.strictEqual(state.result.success, true);
    assert.strictEqual(state.result.messagesProcessed, 5);
  });

  it('should transition from running to error', async () => {
    const machine6 = new WorkerStateMachine('test-worker-6', testConfig, 'test-mesh', 'test-agent');
    await machine6.initialize();
    await machine6.start(12345);

    await machine6.error('Test error message');

    assert.strictEqual(machine6.getStatus(), 'error');
    const state = machine6.getState() as any;
    assert.strictEqual(state.error, 'Test error message');
  });

  it('should support retry from error state', async () => {
    const machine7 = new WorkerStateMachine('test-worker-7', testConfig, 'test-mesh', 'test-agent');
    await machine7.initialize();
    await machine7.start(12345);
    await machine7.error('Test error');

    await machine7.retry();

    assert.strictEqual(machine7.getStatus(), 'initializing');
    assert.strictEqual(machine7.context.retryCount, 1);
  });

  it('should reject retry when max retries exceeded', async () => {
    const machine8 = new WorkerStateMachine('test-worker-8', testConfig, 'test-mesh', 'test-agent');
    await machine8.initialize();
    await machine8.start(12345);
    await machine8.error('Test error');

    // Manually set retry count to max
    machine8.context.retryCount = 3;

    try {
      await machine8.retry();
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.strictEqual((error as Error).message, 'Max retries exceeded: 3');
    }
  });

  it('should maintain immutable state snapshots', async () => {
    const machine9 = new WorkerStateMachine('test-worker-9', testConfig, 'test-mesh', 'test-agent');
    await machine9.initialize();

    const snapshot = machine9.getState();

    // Try to mutate snapshot (should not affect internal state)
    (snapshot as any).status = 'hacked';

    // Verify internal state is unchanged
    assert.strictEqual(machine9.getStatus(), 'initializing');
  });

  it('should record complete transition history', async () => {
    const machine10 = new WorkerStateMachine('test-worker-10', testConfig, 'test-mesh', 'test-agent');

    await machine10.initialize();
    await machine10.start(123);
    await machine10.markIdle();
    await machine10.processNext();
    await machine10.complete({ success: true, messagesProcessed: 2 });

    const history = machine10.getHistory();
    assert.strictEqual(history.length, 5);
    assert.strictEqual(history[0].transitionName, 'initialize');
    assert.strictEqual(history[1].transitionName, 'start');
    assert.strictEqual(history[2].transitionName, 'idle');
    assert.strictEqual(history[3].transitionName, 'resume');
    assert.strictEqual(history[4].transitionName, 'complete');
  });

  it('should reject invalid transitions via guards', async () => {
    const machine11 = new WorkerStateMachine('test-worker-11', testConfig, 'test-mesh', 'test-agent');

    // Try to start without initializing
    try {
      await machine11.start(123);
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.strictEqual((error as Error).message, 'Cannot start from pending');
    }
  });

  it('should calculate duration correctly', async () => {
    const machine12 = new WorkerStateMachine('test-worker-12', testConfig, 'test-mesh', 'test-agent');
    await machine12.initialize();
    await machine12.start(123);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 50));

    const duration = machine12.getDuration();
    assert.ok(duration >= 50, `Duration ${duration} should be at least 50ms`);
  });

  it('should track messages processed count', async () => {
    const machine13 = new WorkerStateMachine('test-worker-13', testConfig, 'test-mesh', 'test-agent');
    await machine13.initialize();
    await machine13.start(123);

    assert.strictEqual(machine13.getMessagesProcessed(), 0);

    await machine13.markIdle();
    assert.strictEqual(machine13.getMessagesProcessed(), 1);

    await machine13.processNext();
    await machine13.markIdle();
    assert.strictEqual(machine13.getMessagesProcessed(), 2);
  });

  it('should emit transition events', async () => {
    const machine14 = new WorkerStateMachine('test-worker-14', testConfig, 'test-mesh', 'test-agent');

    const events: any[] = [];
    machine14.on('transition', (event) => {
      events.push(event);
    });

    await machine14.initialize();
    await machine14.start(123);
    await machine14.complete({ success: true, messagesProcessed: 1 });

    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].transitionName, 'initialize');
    assert.strictEqual(events[1].transitionName, 'start');
    assert.strictEqual(events[2].transitionName, 'complete');
  });
});

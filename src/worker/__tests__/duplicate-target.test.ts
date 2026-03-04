/**
 * Tests for the duplicate_target guardrail (agent completion frontier)
 *
 * The duplicate_target guardrail prevents agents from sending multiple messages
 * to the same target in a single session. This prevents cascade multiplication
 * bugs where duplicate sends compound through the mesh.
 *
 * Key behaviors:
 * - First send to target: allowed, target added to frontier
 * - Second send to same target: blocked (strict) or warned (warning mode)
 * - core/core exemption: always allowed (agents send HITL, errors, completion)
 * - dispatch type exemption: fan-out is intentional
 * - Ask-response reset: when B responds to A, A can send to B again
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { WorkerLifecycleManager } from '../worker-lifecycle.ts';
import { GuardrailConfig } from '../guardrail-config.ts';
import { WorkerStateMachine } from '../../state-machine/index.ts';
import type { WorkerConfig } from '../../shared/types.ts';
import type { HookContext } from '../hooks.ts';

// Mock SdkRunner for testing
class MockSdkRunner {
  private killed = false;

  kill(reason: string): void {
    this.killed = reason !== '';
  }

  isKilled(): boolean {
    return this.killed;
  }
}

describe('duplicate_target guardrail', () => {
  const testDir = path.join(process.cwd(), '.test-duplicate-target');
  const stateFile = path.join(testDir, 'workers.json');
  const configFile = path.join(testDir, '.ai', 'tx', 'data', 'config.yaml');
  let manager: WorkerLifecycleManager;
  let guardrails: GuardrailConfig;

  beforeEach(() => {
    // Create test directory structure
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(testDir, '.ai', 'tx', 'data'), { recursive: true });

    manager = new WorkerLifecycleManager(stateFile);
    guardrails = new GuardrailConfig(testDir);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Helper to create mock worker data
  function createMockWorkerData(agentId: string) {
    const workerConfig: WorkerConfig = {
      id: agentId,
      model: 'sonnet',
      prompt: 'test prompt',
      workDir: testDir,
    };
    const machine = new WorkerStateMachine(agentId, workerConfig, 'test', 'agent', 60000, false);
    const hookContext: HookContext = {
      meshInstance: 'test-1',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
      agentId,
      agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
      taskId: 'task-1',
      taskBody: 'test task',
      msgsDir: testDir,
    };

    return {
      runner: new MockSdkRunner() as unknown as import('../sdk-runner.ts').SdkRunner,
      machine,
      startedAt: Date.now(),
      hookContext,
    };
  }

  describe('GuardrailConfig.getMode() for duplicate_target', () => {
    it('should return default mode (strict: false, warning: true) when not configured', () => {
      const mode = guardrails.getMode('duplicate_target', 'mesh', 'agent');

      assert.strictEqual(mode.strict, false);
      assert.strictEqual(mode.warning, true);
    });

    it('should respect global config', () => {
      // Write config file with strict: true
      const config = `
guardrails:
  duplicate_target:
    strict: true
    warning: true
`;
      fs.writeFileSync(configFile, config);

      // Re-initialize guardrails to pick up config
      const strictGuardrails = new GuardrailConfig(testDir);
      const mode = strictGuardrails.getMode('duplicate_target', 'mesh', 'agent');

      assert.strictEqual(mode.strict, true);
      assert.strictEqual(mode.warning, true);
    });

    it('should respect mesh-level overrides', () => {
      const config = `
guardrails:
  duplicate_target:
    strict: false
    warning: true
  meshes:
    narrative-engine:
      duplicate_target:
        strict: true
`;
      fs.writeFileSync(configFile, config);

      const meshGuardrails = new GuardrailConfig(testDir);

      // Global: strict=false
      const globalMode = meshGuardrails.getMode('duplicate_target', 'other-mesh', 'agent');
      assert.strictEqual(globalMode.strict, false);

      // Mesh override: strict=true
      const meshMode = meshGuardrails.getMode('duplicate_target', 'narrative-engine', 'agent');
      assert.strictEqual(meshMode.strict, true);
    });

    it('should respect agent-level overrides', () => {
      const config = `
guardrails:
  duplicate_target:
    strict: true
  meshes:
    narrative-engine:
      agents:
        narrator:
          duplicate_target:
            strict: false
`;
      fs.writeFileSync(configFile, config);

      const agentGuardrails = new GuardrailConfig(testDir);

      // Other agents in mesh: inherit mesh default (strict=true)
      const otherMode = agentGuardrails.getMode('duplicate_target', 'narrative-engine', 'architect');
      assert.strictEqual(otherMode.strict, true);

      // Narrator has override: strict=false
      const narratorMode = agentGuardrails.getMode('duplicate_target', 'narrative-engine', 'narrator');
      assert.strictEqual(narratorMode.strict, false);
    });
  });

  describe('WorkerLifecycleManager completion frontier', () => {
    it('should track sent targets correctly', () => {
      manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      // First send
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target'), false);
      manager.addSentTarget('mesh/agent', 'mesh/target');

      // Second check should show target is in frontier
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target'), true);
    });

    it('should allow sending to different targets', () => {
      manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      manager.addSentTarget('mesh/agent', 'mesh/target1');
      manager.addSentTarget('mesh/agent', 'mesh/target2');

      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target1'), true);
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target2'), true);
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target3'), false);
    });

    it('should reset frontier for specific target on response', () => {
      manager.add('mesh/narrator', createMockWorkerData('mesh/narrator'));

      // Narrator sends to oracle
      manager.addSentTarget('mesh/narrator', 'mesh/oracle');
      manager.addSentTarget('mesh/narrator', 'mesh/editor');
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), true);
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/editor'), true);

      // Oracle responds — only oracle frontier is reset
      manager.resetSentTargetForResponse('mesh/narrator', 'mesh/oracle');

      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), false);
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/editor'), true);
    });
  });

  describe('core/core exemption', () => {
    it('should always allow sends to core/core', () => {
      manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      // Multiple sends to core/core should all succeed (not tracked in frontier)
      // In actual dispatcher, core/core is exempted from the check
      // Here we just verify the exemption logic concept

      // The exemption check in dispatcher is: toAgentId === 'core/core'
      // This test validates the concept by checking that we can track
      // the same non-core target multiple times IF we wanted to (for testing)

      // Send to non-core target
      manager.addSentTarget('mesh/agent', 'mesh/other');
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/other'), true);

      // But core/core would be exempted (not added to frontier in dispatcher)
      // We verify by checking that untracked targets return false
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'core/core'), false);
    });
  });

  describe('ask-response loop pattern', () => {
    it('should allow valid narrator → oracle → narrator → oracle flow', () => {
      manager.add('mesh/narrator', createMockWorkerData('mesh/narrator'));

      // Step 1: Narrator sends to oracle (first query)
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), false);
      manager.addSentTarget('mesh/narrator', 'mesh/oracle');
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), true);

      // Step 2: Oracle responds → frontier reset for oracle
      manager.resetSentTargetForResponse('mesh/narrator', 'mesh/oracle');
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), false);

      // Step 3: Narrator can now send to oracle again (second query)
      manager.addSentTarget('mesh/narrator', 'mesh/oracle');
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), true);

      // Step 4: Oracle responds again → frontier reset again
      manager.resetSentTargetForResponse('mesh/narrator', 'mesh/oracle');
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), false);
    });

    it('should not reset frontier for unrelated agents', () => {
      manager.add('mesh/narrator', createMockWorkerData('mesh/narrator'));

      // Narrator sends to oracle and editor
      manager.addSentTarget('mesh/narrator', 'mesh/oracle');
      manager.addSentTarget('mesh/narrator', 'mesh/editor');

      // Oracle responds — only oracle is reset
      manager.resetSentTargetForResponse('mesh/narrator', 'mesh/oracle');

      // Editor frontier should still be blocked
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/editor'), true);
      // Oracle frontier is now open
      assert.strictEqual(manager.hasSentToTarget('mesh/narrator', 'mesh/oracle'), false);
    });
  });

  describe('cascade multiplication scenario (the original bug)', () => {
    it('should prevent architect → simulator duplicate sends', () => {
      // This tests the scenario from the bug report:
      // Architect sent TWO messages to simulator in a single session
      // (one at "mechanical resolution" and another at "entropy resolution")
      // This should now be blocked by the duplicate_target guardrail

      manager.add('mesh/architect', createMockWorkerData('mesh/architect'));

      // First send: architect → simulator (mechanical resolution)
      assert.strictEqual(manager.hasSentToTarget('mesh/architect', 'mesh/simulator'), false);
      manager.addSentTarget('mesh/architect', 'mesh/simulator');

      // Second send attempt: architect → simulator (entropy resolution)
      // This should be detected as duplicate
      assert.strictEqual(manager.hasSentToTarget('mesh/architect', 'mesh/simulator'), true);

      // In strict mode, dispatcher would block this second send
      // In warning mode, dispatcher would allow but inject feedback
    });
  });

  describe('worker cleanup', () => {
    it('should clean up frontier when worker is removed', () => {
      const workerId = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));
      manager.addSentTarget('mesh/agent', 'mesh/target');
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target'), true);

      // Remove the worker
      manager.remove('mesh/agent', workerId);

      // No active worker means no frontier
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target'), false);
    });

    it('should reset frontier for new worker session', () => {
      // First worker session
      const workerId1 = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));
      manager.addSentTarget('mesh/agent', 'mesh/target');
      manager.remove('mesh/agent', workerId1);

      // Second worker session (new turn)
      const workerId2 = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      // New session should have empty frontier
      assert.strictEqual(manager.hasSentToTarget('mesh/agent', 'mesh/target'), false);
      assert.notStrictEqual(workerId1, workerId2);
    });
  });
});

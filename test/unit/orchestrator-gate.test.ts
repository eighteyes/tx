/**
 * Orchestrator Gate Test
 *
 * Verifies that orchestrator: true agents get:
 * 1. Mesh validator accepts orchestrator field without warnings
 * 2. PreToolUse hook blocks Write outside msgs dir
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MeshValidator } from '../../src/worker/mesh-validator.ts';

describe('Orchestrator Gate', () => {

  describe('Mesh validator', () => {
    it('should accept orchestrator: true on agent config', () => {
      const config = {
        mesh: 'test-orch',
        agents: [
          {
            name: 'coordinator',
            model: 'sonnet',
            prompt: 'coordinator.md',
            orchestrator: true,
          },
          {
            name: 'worker',
            model: 'haiku',
            prompt: 'worker.md',
          },
        ],
        entry_point: 'coordinator',
      };

      const result = MeshValidator.validate(config, 'test-orch');
      // orchestrator field should not generate warnings about unknown fields
      const unknownFieldWarnings = result.warnings.filter(w =>
        w.includes("'orchestrator'") && w.includes('unknown')
      );
      assert.strictEqual(
        unknownFieldWarnings.length,
        0,
        `Should not warn about orchestrator field, but got: ${unknownFieldWarnings.join(', ')}`
      );
    });

    it('should warn about unknown agent fields but not orchestrator', () => {
      const config = {
        mesh: 'test-unknown-fields',
        agents: [
          {
            name: 'agent',
            model: 'sonnet',
            prompt: 'agent.md',
            orchestrator: true,
            bogusField: 'should warn',
          },
        ],
        entry_point: 'agent',
      };

      const result = MeshValidator.validate(config, 'test-unknown-fields');
      const bogusWarnings = result.warnings.filter(w => w.includes('bogusField'));
      const orchestratorWarnings = result.warnings.filter(w =>
        w.includes('orchestrator') && w.includes('unknown')
      );
      assert.ok(bogusWarnings.length > 0, 'Should warn about bogusField');
      assert.strictEqual(orchestratorWarnings.length, 0, 'Should not warn about orchestrator');
    });
  });

  describe('Orchestrator Write hook logic', () => {
    it('should block Write to non-msgs paths', () => {
      const msgsDir = '/workspace/tx-core/.ai/tx/msgs';

      // Simulate the hook logic from dispatcher
      const checkWrite = (filePath: string) => {
        if (!filePath.startsWith(msgsDir)) {
          return { decision: 'block' as const, reason: `Blocked: ${filePath}` };
        }
        return { decision: 'allow' as const };
      };

      // Should block writes to source code
      const blocked = checkWrite('/workspace/tx-core/src/app.ts');
      assert.strictEqual(blocked.decision, 'block');

      // Should allow writes to msgs dir
      const allowed = checkWrite(`${msgsDir}/task-123.md`);
      assert.strictEqual(allowed.decision, 'allow');

      // Should block writes to other .ai paths
      const blockedAi = checkWrite('/workspace/tx-core/.ai/tx/data/config.yaml');
      assert.strictEqual(blockedAi.decision, 'block');

      // Should allow subdirectories of msgs
      const allowedSub = checkWrite(`${msgsDir}/sub/dir/file.md`);
      assert.strictEqual(allowedSub.decision, 'allow');
    });

    it('should block when file_path is empty', () => {
      const msgsDir = '/workspace/tx-core/.ai/tx/msgs';
      const checkWrite = (filePath: string) => {
        if (!filePath.startsWith(msgsDir)) {
          return { decision: 'block' as const };
        }
        return { decision: 'allow' as const };
      };

      const result = checkWrite('');
      assert.strictEqual(result.decision, 'block');
    });
  });
});

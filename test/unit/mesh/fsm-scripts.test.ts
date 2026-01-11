/**
 * FSM Scripts Test
 *
 * Tests the ScriptExecutor for running FSM gate and transition scripts.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ScriptExecutor, type ScriptContext } from '../../../src/mesh/fsm-scripts.ts';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.ts';

describe('ScriptExecutor', () => {
  let env: TestEnv;
  let executor: ScriptExecutor;
  let scriptsDir: string;

  before(async () => {
    env = createTestEnv('tx-fsm-scripts');
    scriptsDir = path.join(env.rootDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });

    executor = new ScriptExecutor({
      workDir: env.rootDir,
      timeoutMs: 5000,  // 5 second timeout for tests
    });
  });

  after(async () => {
    env.cleanup();
  });

  describe('script execution', () => {
    it('should execute a successful script', async () => {
      const scriptPath = path.join(scriptsDir, 'success.sh');
      fs.writeFileSync(scriptPath, `#!/bin/bash
echo "Hello from script"
exit 0
`, { mode: 0o755 });

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
      };

      const result = await executor.execute(scriptPath, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('Hello from script'));
      assert.strictEqual(result.timedOut, false);
    });

    it('should handle script failure', async () => {
      const scriptPath = path.join(scriptsDir, 'failure.sh');
      fs.writeFileSync(scriptPath, `#!/bin/bash
echo "Error message" >&2
exit 1
`, { mode: 0o755 });

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
      };

      const result = await executor.execute(scriptPath, context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Error message'));
    });

    it('should report non-existent script', async () => {
      const scriptPath = path.join(scriptsDir, 'does-not-exist.sh');

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
      };

      const result = await executor.execute(scriptPath, context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 127);  // Command not found
      assert.ok(result.stderr.includes('not found'));
    });

    it('should timeout long-running scripts', async () => {
      const scriptPath = path.join(scriptsDir, 'slow.sh');
      fs.writeFileSync(scriptPath, `#!/bin/bash
sleep 60
echo "Should not reach here"
`, { mode: 0o755 });

      // Create executor with short timeout
      const shortExecutor = new ScriptExecutor({
        workDir: env.rootDir,
        timeoutMs: 500,  // 0.5 second timeout
      });

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
      };

      const result = await shortExecutor.execute(scriptPath, context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.timedOut, true);
      assert.ok(result.durationMs >= 400, 'Should have waited for timeout');
    });
  });

  describe('environment injection', () => {
    it('should inject FSM state variables', async () => {
      const scriptPath = path.join(scriptsDir, 'env-check.sh');
      fs.writeFileSync(scriptPath, `#!/bin/bash
echo "STATE=$FSM_STATE"
echo "MESH=$FSM_MESH_NAME"
echo "PREV=$FSM_PREVIOUS_STATE"
echo "TRANS=$FSM_TRANSITION"
`, { mode: 0o755 });

      const context: ScriptContext = {
        fsmState: 'implementation',
        fsmMeshName: 'feature-mesh',
        fsmPreviousState: 'planning',
        fsmTransition: 'planning->implementation',
      };

      const result = await executor.execute(scriptPath, context);

      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('STATE=implementation'));
      assert.ok(result.stdout.includes('MESH=feature-mesh'));
      assert.ok(result.stdout.includes('PREV=planning'));
      assert.ok(result.stdout.includes('TRANS=planning->implementation'));
    });

    it('should inject message frontmatter', async () => {
      const scriptPath = path.join(scriptsDir, 'msg-check.sh');
      fs.writeFileSync(scriptPath, `#!/bin/bash
echo "FROM=$MSG_FROM"
echo "TO=$MSG_TO"
echo "TYPE=$MSG_TYPE"
echo "ID=$MSG_ID"
`, { mode: 0o755 });

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
        msgFrom: 'dev/dev-worker',
        msgTo: 'dev/reviewer',
        msgType: 'ask',
        msgId: 'ask-123',
      };

      const result = await executor.execute(scriptPath, context);

      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('FROM=dev/dev-worker'));
      assert.ok(result.stdout.includes('TO=dev/reviewer'));
      assert.ok(result.stdout.includes('TYPE=ask'));
      assert.ok(result.stdout.includes('ID=ask-123'));
    });

    it('should inject custom context variables', async () => {
      const scriptPath = path.join(scriptsDir, 'ctx-check.sh');
      fs.writeFileSync(scriptPath, `#!/bin/bash
echo "FEATURE=$FSM_CTX_FEATURE_NAME"
echo "PRIORITY=$FSM_CTX_PRIORITY"
`, { mode: 0o755 });

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
        feature_name: 'user-auth',
        priority: 'high',
      };

      const result = await executor.execute(scriptPath, context);

      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('FEATURE=user-auth'));
      assert.ok(result.stdout.includes('PRIORITY=high'));
    });
  });

  describe('output parsing', () => {
    it('should parse KEY=value outputs', async () => {
      const scriptPath = path.join(scriptsDir, 'outputs.sh');
      fs.writeFileSync(scriptPath, `#!/bin/bash
echo "RESULT=success"
echo "COUNT=42"
echo "STATUS=approved"
echo "not a key value"
`, { mode: 0o755 });

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
      };

      const result = await executor.execute(scriptPath, context);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.outputs, {
        RESULT: 'success',
        COUNT: '42',
        STATUS: 'approved',
      });
    });
  });

  describe('inline script execution', () => {
    it('should execute inline script', async () => {
      const script = 'echo "Hello inline"';

      const context: ScriptContext = {
        fsmState: 'planning',
        fsmMeshName: 'test-mesh',
      };

      const result = await executor.executeInline(script, context);

      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('Hello inline'));
    });

    it('should inject environment into inline script', async () => {
      const script = 'echo "STATE=$FSM_STATE"';

      const context: ScriptContext = {
        fsmState: 'review',
        fsmMeshName: 'test-mesh',
      };

      const result = await executor.executeInline(script, context);

      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('STATE=review'));
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      const executor2 = new ScriptExecutor({
        workDir: '/tmp',
        timeoutMs: 1000,
      });

      executor2.setConfig({
        timeoutMs: 2000,
        shell: '/bin/sh',
      });

      const config = executor2.getConfig();
      assert.strictEqual(config.timeoutMs, 2000);
      assert.strictEqual(config.shell, '/bin/sh');
      assert.strictEqual(config.workDir, '/tmp');  // Unchanged
    });
  });
});

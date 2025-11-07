const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { Validator } = require('../../lib/validator');
const { Queue } = require('../../lib/queue');
const { TX_ROOT } = require('../../lib/paths');

test('Completion Agent Validation', async (t) => {
  await t.test('Validator should accept completion_agent without warning', () => {
    // Test that completion_agent field is recognized and doesn't produce "informational only" warning
    const validation = Validator.validateMeshConfig('job-applicator');

    // Should be valid
    assert.strictEqual(validation.valid, true, 'Mesh config should be valid');

    // Should not have "informational only" warning for completion_agent
    const hasInformationalWarning = validation.warnings.some(w =>
      w.includes('completion_agent') && w.includes('informational only')
    );
    assert.strictEqual(hasInformationalWarning, false,
      'Should not warn that completion_agent is informational only');
  });

  await t.test('Queue should load mesh config', () => {
    const meshConfig = Queue.loadMeshConfig('job-applicator');

    assert.ok(meshConfig, 'Mesh config should be loaded');
    assert.strictEqual(meshConfig.mesh, 'job-applicator');
    assert.strictEqual(meshConfig.completion_agent, 'job-applicator');
  });

  await t.test('Queue should validate completion_agent for task-complete messages', () => {
    // This test just ensures the validation function doesn't throw
    // Actual logging is tested via integration tests

    // Should not throw when completion_agent matches
    assert.doesNotThrow(() => {
      Queue.validateCompletionAgent('job-applicator', 'job-applicator', 'task-complete');
    }, 'Should not throw when completion_agent matches');

    // Should not throw when completion_agent doesn't match (just warns)
    assert.doesNotThrow(() => {
      Queue.validateCompletionAgent('job-applicator', 'wrong-agent', 'task-complete');
    }, 'Should not throw when completion_agent does not match (logs warning)');

    // Should not throw for non-task-complete messages
    assert.doesNotThrow(() => {
      Queue.validateCompletionAgent('job-applicator', 'job-applicator', 'task');
    }, 'Should not throw for non-task-complete messages');
  });
});

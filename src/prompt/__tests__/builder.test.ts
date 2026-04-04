/**
 * Tests for PromptBuilder
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { PromptBuilder } from '../builder.js';
import { PromptContext } from '../types.js';

// Test fixture setup
const TEST_DIR = resolve('.ai/tmp/prompt-test');
const TEST_PROMPT_FILE = resolve(TEST_DIR, 'test-prompt.md');

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_PROMPT_FILE, '# Test Agent\n\nYou are a test agent.');
}

function teardown() {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
}

test('PromptBuilder - basic prompt without task', () => {
  setup();

  const context: PromptContext = {
    mesh: 'test',
    agent: 'worker',
    model: 'sonnet',
    agentPromptPath: TEST_PROMPT_FILE,
  };

  const builder = new PromptBuilder(context);
  const prompt = builder.build();

  // Should include preamble
  assert.ok(prompt.includes('You are a Claude agent'));

  // Should include agent prompt
  assert.ok(prompt.includes('# Test Agent'));
  assert.ok(prompt.includes('You are a test agent'));

  // Should NOT include task context
  assert.ok(!prompt.includes('## Task Context'));

  // Should include rearmatter
  assert.ok(prompt.includes('## Quality Gates'));

  teardown();
});

test('PromptBuilder - prompt with task message', () => {
  setup();

  const taskMessage = `---
to: test/worker
from: core/core
msg-id: test-123
headline: Test task
---

Please do something important.`;

  const context: PromptContext = {
    mesh: 'test',
    agent: 'worker',
    model: 'sonnet',
    agentPromptPath: TEST_PROMPT_FILE,
    taskMessage,
  };

  const builder = new PromptBuilder(context);
  const prompt = builder.build();

  // Should include task context
  assert.ok(prompt.includes('## Task Context'));
  assert.ok(prompt.includes('**From**: core/core'));
  assert.ok(prompt.includes('**Headline**: Test task'));
  assert.ok(prompt.includes('Please do something important'));

  // Should include message delivery instructions
  assert.ok(prompt.includes('Message delivery'));
  assert.ok(prompt.includes('.ai/tx/msgs/'));

  teardown();
});

test('PromptBuilder - selective sections', () => {
  setup();

  const context: PromptContext = {
    mesh: 'test',
    agent: 'worker',
    model: 'sonnet',
    agentPromptPath: TEST_PROMPT_FILE,
  };

  const builder = new PromptBuilder(context, {
    includePreamble: false,
    includeRearmatter: false,
  });

  const prompt = builder.build();

  // Should NOT include preamble
  assert.ok(!prompt.includes('You are a Claude agent'));

  // Should include agent prompt
  assert.ok(prompt.includes('# Test Agent'));

  // Should NOT include rearmatter
  assert.ok(!prompt.includes('## Quality Gates'));

  teardown();
});

test('PromptBuilder - metadata', () => {
  setup();

  const context: PromptContext = {
    mesh: 'test',
    agent: 'worker',
    model: 'haiku',
    agentPromptPath: TEST_PROMPT_FILE,
  };

  const builder = new PromptBuilder(context);
  const metadata = builder.getMetadata();

  assert.strictEqual(metadata.mesh, 'test');
  assert.strictEqual(metadata.agent, 'worker');
  assert.strictEqual(metadata.model, 'haiku');
  assert.ok(metadata.sections.includes('preamble'));
  assert.ok(metadata.sections.includes('agent-prompt'));

  teardown();
});

test('PromptBuilder - missing prompt file', () => {
  const context: PromptContext = {
    mesh: 'test',
    agent: 'worker',
    model: 'sonnet',
    agentPromptPath: '/nonexistent/prompt.md',
  };

  const builder = new PromptBuilder(context);

  assert.throws(() => {
    builder.build();
  }, /Failed to load agent prompt/);
});

test('PromptBuilder - with quality gates', () => {
  setup();

  const context: PromptContext = {
    mesh: 'test',
    agent: 'worker',
    model: 'sonnet',
    agentPromptPath: TEST_PROMPT_FILE,
    qualityGates: [
      'All tests pass',
      'Code is properly formatted',
      'No TypeScript errors',
    ],
  };

  const builder = new PromptBuilder(context);
  const prompt = builder.build();

  assert.ok(prompt.includes('## Quality Gates'));
  assert.ok(prompt.includes('All tests pass'));
  assert.ok(prompt.includes('Code is properly formatted'));
  assert.ok(prompt.includes('No TypeScript errors'));

  teardown();
});

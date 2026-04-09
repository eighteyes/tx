/**
 * cli-factory.test - Tests for tx factory CLI command
 *
 * Validates the factory pipeline: YAML input → validation → catalog match → compile fallback.
 *
 * Responsibilities:
 * - Verify valid capability YAML generates a mesh with config.yaml in output dir
 * - Verify invalid capability YAML returns error result
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runFactory } from '../../src/cli/factory.ts';

const FRAGMENTS_DIR = path.resolve(import.meta.dirname, '../../src/mesh/fragments');

let tmpDir: string;
let inputDir: string;
let outputDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-factory-test-'));
  inputDir = path.join(tmpDir, 'input');
  outputDir = path.join(tmpDir, 'output');
  fs.mkdirSync(inputDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('runFactory - generates mesh from capabilities YAML file', () => {
  it('produces success: true and config.yaml in output dir', async () => {
    const inputFile = path.join(inputDir, 'needs.yaml');
    fs.writeFileSync(inputFile, [
      'capability:',
      '  domain:',
      '    - dev',
      '  input:',
      '    - prompt',
      '  output:',
      '    - code-changes',
      '  tools:',
      '    - git',
      '  interaction:',
      '    - none',
    ].join('\n'), 'utf-8');

    const result = await runFactory({
      inputFile,
      outputDir,
      fragmentsDir: FRAGMENTS_DIR,
    });

    assert.strictEqual(result.success, true, `Expected success but got errors: ${result.errors.join(', ')}`);
    assert.ok(result.generated, 'Should have generated path');
    assert.ok(fs.existsSync(path.join(outputDir, 'config.yaml')), 'config.yaml should exist in output dir');
    assert.deepStrictEqual(result.errors, []);
  });
});

describe('runFactory - returns error for invalid capabilities', () => {
  it('returns success: false for invalid domain value', async () => {
    const inputFile = path.join(inputDir, 'bad.yaml');
    fs.writeFileSync(inputFile, [
      'capability:',
      '  domain:',
      '    - not-a-real-domain',
      '  input:',
      '    - prompt',
      '  output:',
      '    - code-changes',
      '  tools: []',
      '  interaction:',
      '    - none',
    ].join('\n'), 'utf-8');

    const result = await runFactory({
      inputFile,
      outputDir,
      fragmentsDir: FRAGMENTS_DIR,
    });

    assert.strictEqual(result.success, false, 'Should fail for invalid domain');
    assert.ok(result.errors.length > 0, 'Should have at least one error');
  });
});

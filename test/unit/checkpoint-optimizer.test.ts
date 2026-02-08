/**
 * Checkpoint Optimizer Test
 *
 * Tests the checkpoint optimization feature that auto-places checkpoints
 * and infers fork_from relationships based on file I/O manifest patterns.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  computeCheckpointScores,
  autoEnableCheckpoints,
  inferForkFrom,
  runCheckpointOptimization,
  type CheckpointOptimizationConfig,
  type CheckpointOptimizationResult
} from '../../src/mesh/checkpoint-optimizer.ts';
import type { ManifestEntry } from '../../src/worker/mesh-validator.ts';
import type { AgentConfig } from '../../src/mesh/config-loader.ts';
import { MeshValidator } from '../../src/worker/mesh-validator.ts';
import { MeshConfigLoader } from '../../src/mesh/config-loader.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

describe('CheckpointOptimizer', () => {

  describe('computeCheckpointScores', () => {

    it('should return empty scores for empty manifest', () => {
      const scores = computeCheckpointScores([]);
      assert.strictEqual(scores.size, 0);
    });

    it('should score zero for writer with no readers', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: [], writes: ['writer-agent'] }
      ];

      const scores = computeCheckpointScores(manifest);

      assert.strictEqual(scores.get('writer-agent'), 0);
    });

    it('should score based on reader count (basic fanout)', () => {
      // Agent writes a file read by 3 other agents → score = 3
      const manifest: ManifestEntry[] = [
        {
          id: 'shared-file',
          reads: ['reader1', 'reader2', 'reader3'],
          writes: ['setup-agent']
        }
      ];

      const scores = computeCheckpointScores(manifest);

      assert.strictEqual(scores.get('setup-agent'), 3);
    });

    it('should accumulate scores across multiple files', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['reader1', 'reader2'], writes: ['writer-agent'] },
        { id: 'file2', reads: ['reader3'], writes: ['writer-agent'] }
      ];

      const scores = computeCheckpointScores(manifest);

      // 2 readers for file1 + 1 reader for file2 = 3
      assert.strictEqual(scores.get('writer-agent'), 3);
    });

    it('should score multiple writers independently', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['reader1', 'reader2'], writes: ['writer1', 'writer2'] }
      ];

      const scores = computeCheckpointScores(manifest);

      // Both writers get credit for the same readers
      assert.strictEqual(scores.get('writer1'), 2);
      assert.strictEqual(scores.get('writer2'), 2);
    });

    it('should not score agents who only read', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['reader-only'], writes: ['writer'] }
      ];

      const scores = computeCheckpointScores(manifest);

      assert.strictEqual(scores.has('reader-only'), false);
      assert.strictEqual(scores.get('writer'), 1);
    });
  });


  describe('autoEnableCheckpoints', () => {

    it('should auto-checkpoint agents meeting threshold', () => {
      const agents: AgentConfig[] = [
        { name: 'setup', model: 'sonnet' },
        { name: 'worker1', model: 'haiku' },
        { name: 'worker2', model: 'haiku' }
      ];

      const scores = new Map([
        ['setup', 5],    // above threshold
        ['worker1', 1],  // below threshold
        ['worker2', 2]   // below threshold
      ]);

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 3
      };

      const autoCheckpointed = autoEnableCheckpoints(agents, scores, config);

      assert.deepStrictEqual(autoCheckpointed, ['setup']);
      assert.strictEqual(agents[0].checkpoint, true);
      assert.strictEqual(agents[1].checkpoint, undefined);
      assert.strictEqual(agents[2].checkpoint, undefined);
    });

    it('should use default threshold of 3', () => {
      const agents: AgentConfig[] = [
        { name: 'high-fanout', model: 'sonnet' },
        { name: 'medium-fanout', model: 'sonnet' },
        { name: 'low-fanout', model: 'haiku' }
      ];

      const scores = new Map([
        ['high-fanout', 5],
        ['medium-fanout', 3],  // exactly at default threshold
        ['low-fanout', 2]
      ]);

      const config: CheckpointOptimizationConfig = {
        enabled: true
        // threshold not set, defaults to 3
      };

      const autoCheckpointed = autoEnableCheckpoints(agents, scores, config);

      assert.ok(autoCheckpointed.includes('high-fanout'));
      assert.ok(autoCheckpointed.includes('medium-fanout'));  // >= 3
      assert.ok(!autoCheckpointed.includes('low-fanout'));
    });

    it('should respect exclude list', () => {
      const agents: AgentConfig[] = [
        { name: 'setup', model: 'sonnet' },
        { name: 'excluded-agent', model: 'sonnet' }
      ];

      const scores = new Map([
        ['setup', 5],
        ['excluded-agent', 10]  // high score but excluded
      ]);

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 3,
        exclude: ['excluded-agent']
      };

      const autoCheckpointed = autoEnableCheckpoints(agents, scores, config);

      assert.deepStrictEqual(autoCheckpointed, ['setup']);
      assert.strictEqual(agents[0].checkpoint, true);
      assert.strictEqual(agents[1].checkpoint, undefined);
    });

    it('should not override explicit checkpoint: false', () => {
      const agents: AgentConfig[] = [
        { name: 'explicit-false', model: 'sonnet', checkpoint: false }
      ];

      const scores = new Map([
        ['explicit-false', 100]  // very high score
      ]);

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 1
      };

      const autoCheckpointed = autoEnableCheckpoints(agents, scores, config);

      assert.deepStrictEqual(autoCheckpointed, []);
      assert.strictEqual(agents[0].checkpoint, false);  // preserved
    });

    it('should not override explicit checkpoint: true', () => {
      const agents: AgentConfig[] = [
        { name: 'explicit-true', model: 'sonnet', checkpoint: true }
      ];

      const scores = new Map([
        ['explicit-true', 0]  // zero score
      ]);

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 3
      };

      const autoCheckpointed = autoEnableCheckpoints(agents, scores, config);

      assert.deepStrictEqual(autoCheckpointed, []);  // not auto-checkpointed
      assert.strictEqual(agents[0].checkpoint, true);  // still true from explicit
    });

    it('should handle agents with zero score', () => {
      const agents: AgentConfig[] = [
        { name: 'no-writes', model: 'haiku' }
      ];

      const scores = new Map<string, number>();  // agent not in scores

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 1
      };

      const autoCheckpointed = autoEnableCheckpoints(agents, scores, config);

      assert.deepStrictEqual(autoCheckpointed, []);
      assert.strictEqual(agents[0].checkpoint, undefined);
    });
  });


  describe('inferForkFrom', () => {

    it('should infer fork_from single checkpointed writer', () => {
      const manifest: ManifestEntry[] = [
        { id: 'shared-file', reads: ['downstream'], writes: ['setup'] }
      ];

      const checkpointedAgents = new Set(['setup']);

      const forkFrom = inferForkFrom('downstream', manifest, checkpointedAgents);

      assert.strictEqual(forkFrom, 'setup');
    });

    it('should return null for multiple checkpointed writers (ambiguous)', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['downstream'], writes: ['setup1'] },
        { id: 'file2', reads: ['downstream'], writes: ['setup2'] }
      ];

      const checkpointedAgents = new Set(['setup1', 'setup2']);

      const forkFrom = inferForkFrom('downstream', manifest, checkpointedAgents);

      assert.strictEqual(forkFrom, null);  // ambiguous
    });

    it('should return null when no checkpointed writers', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['downstream'], writes: ['non-checkpointed'] }
      ];

      const checkpointedAgents = new Set<string>();  // none checkpointed

      const forkFrom = inferForkFrom('downstream', manifest, checkpointedAgents);

      assert.strictEqual(forkFrom, null);
    });

    it('should ignore non-checkpointed writers when some are checkpointed', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['downstream'], writes: ['checkpointed-setup'] },
        { id: 'file2', reads: ['downstream'], writes: ['non-checkpointed'] }
      ];

      const checkpointedAgents = new Set(['checkpointed-setup']);

      const forkFrom = inferForkFrom('downstream', manifest, checkpointedAgents);

      assert.strictEqual(forkFrom, 'checkpointed-setup');
    });

    it('should exclude self from writer consideration', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['agent-a'], writes: ['agent-a', 'agent-b'] }
      ];

      // Only agent-a is checkpointed, but agent-a is reading its own file
      const checkpointedAgents = new Set(['agent-a', 'agent-b']);

      const forkFrom = inferForkFrom('agent-a', manifest, checkpointedAgents);

      // Should only consider agent-b as a writer
      assert.strictEqual(forkFrom, 'agent-b');
    });

    it('should return null when agent reads no files', () => {
      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['other-agent'], writes: ['setup'] }
      ];

      const checkpointedAgents = new Set(['setup']);

      const forkFrom = inferForkFrom('no-reads-agent', manifest, checkpointedAgents);

      assert.strictEqual(forkFrom, null);
    });
  });


  describe('runCheckpointOptimization (full pipeline)', () => {

    it('should run full optimization pipeline', () => {
      const agents: AgentConfig[] = [
        { name: 'setup', model: 'sonnet' },
        { name: 'worker1', model: 'haiku' },
        { name: 'worker2', model: 'haiku' },
        { name: 'synthesizer', model: 'sonnet' }
      ];

      const manifest: ManifestEntry[] = [
        // setup writes file read by worker1, worker2, synthesizer
        { id: 'context', reads: ['worker1', 'worker2', 'synthesizer'], writes: ['setup'] },
        // workers write to synthesizer
        { id: 'result1', reads: ['synthesizer'], writes: ['worker1'] },
        { id: 'result2', reads: ['synthesizer'], writes: ['worker2'] }
      ];

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 3
      };

      const result = runCheckpointOptimization(agents, manifest, config, 'test-mesh');

      // Setup should be auto-checkpointed (3 readers)
      assert.ok(result.autoCheckpointed.includes('setup'));
      assert.strictEqual(agents[0].checkpoint, true);

      // Workers shouldn't be checkpointed (only 1 reader each)
      assert.strictEqual(agents[1].checkpoint, undefined);
      assert.strictEqual(agents[2].checkpoint, undefined);

      // Workers should infer fork_from setup
      assert.strictEqual(result.inferredForks.get('worker1'), 'setup');
      assert.strictEqual(result.inferredForks.get('worker2'), 'setup');
      assert.strictEqual(agents[1].fork_from, 'setup');
      assert.strictEqual(agents[2].fork_from, 'setup');

      // Synthesizer forks from setup (only checkpointed writer - workers aren't checkpointed)
      assert.strictEqual(result.inferredForks.get('synthesizer'), 'setup');
      assert.strictEqual(agents[3].fork_from, 'setup');
    });

    it('should not infer fork_from for checkpointed agents', () => {
      const agents: AgentConfig[] = [
        { name: 'setup', model: 'sonnet' },
        { name: 'checkpointed-worker', model: 'haiku', checkpoint: true }
      ];

      const manifest: ManifestEntry[] = [
        { id: 'context', reads: ['checkpointed-worker'], writes: ['setup'] }
      ];

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 1
      };

      const result = runCheckpointOptimization(agents, manifest, config, 'test-mesh');

      // Setup auto-checkpointed
      assert.ok(result.autoCheckpointed.includes('setup'));

      // Checkpointed worker should NOT get fork_from (it's a source, not a fork)
      assert.strictEqual(result.inferredForks.has('checkpointed-worker'), false);
      assert.strictEqual(agents[1].fork_from, undefined);
    });

    it('should preserve explicit fork_from', () => {
      const agents: AgentConfig[] = [
        { name: 'setup1', model: 'sonnet' },
        { name: 'setup2', model: 'sonnet' },
        { name: 'worker', model: 'haiku', fork_from: 'setup2' }  // explicit
      ];

      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['worker'], writes: ['setup1'] },
        { id: 'file2', reads: ['worker'], writes: ['setup2'] }
      ];

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 1
      };

      const result = runCheckpointOptimization(agents, manifest, config, 'test-mesh');

      // Worker should keep explicit fork_from
      assert.strictEqual(result.inferredForks.has('worker'), false);
      assert.strictEqual(agents[2].fork_from, 'setup2');  // preserved
    });

    it('should return scores for all writers', () => {
      const agents: AgentConfig[] = [
        { name: 'agent1', model: 'sonnet' },
        { name: 'agent2', model: 'haiku' }
      ];

      const manifest: ManifestEntry[] = [
        { id: 'file1', reads: ['agent2'], writes: ['agent1'] }
      ];

      const config: CheckpointOptimizationConfig = {
        enabled: true,
        threshold: 10  // high threshold, nothing auto-checkpointed
      };

      const result = runCheckpointOptimization(agents, manifest, config, 'test-mesh');

      assert.strictEqual(result.scores.get('agent1'), 1);
      assert.strictEqual(result.autoCheckpointed.length, 0);
    });
  });


  describe('MeshValidator checkpoint_optimization validation', () => {

    it('should reject missing enabled field', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          threshold: 3
          // enabled missing
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('enabled') && e.includes('required')));
    });

    it('should reject non-boolean enabled', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: 'yes'  // should be boolean
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('enabled') && e.includes('boolean')));
    });

    it('should reject threshold less than 1', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: true,
          threshold: 0  // invalid
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('threshold') && e.includes('>= 1')));
    });

    it('should reject non-number threshold', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: true,
          threshold: 'high'
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('threshold') && e.includes('number')));
    });

    it('should reject non-array exclude', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: true,
          exclude: 'agent1'  // should be array
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('exclude') && e.includes('array')));
    });

    it('should reject non-string items in exclude array', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: true,
          exclude: ['valid', 123]  // 123 is not a string
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('exclude') && e.includes('string')));
    });

    it('should warn about unknown fields', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: true,
          unknown_field: 'value'
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, true);  // still valid
      assert.ok(result.warnings.some(w => w.includes('unknown_field')));
    });

    it('should accept valid checkpoint_optimization config', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: true,
          threshold: 5,
          exclude: ['agent1', 'agent2']
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should accept minimal checkpoint_optimization (enabled only)', () => {
      const config = {
        mesh: 'test',
        agents: [{ name: 'agent', model: 'sonnet', prompt: 'test.md' }],
        checkpoint_optimization: {
          enabled: false
        }
      };

      const result = MeshValidator.validate(config);

      assert.strictEqual(result.valid, true);
    });
  });


  describe('MeshConfigLoader integration', () => {
    let env: TestEnv;
    let loader: MeshConfigLoader;

    before(() => {
      env = createTestEnv('checkpoint-opt-integration');
    });

    after(() => {
      env.cleanup();
    });

    beforeEach(() => {
      loader = new MeshConfigLoader({
        workDir: env.rootDir,
        meshesDir: env.meshesDir
      });
    });

    it('should apply checkpoint optimization when loading mesh config', () => {
      // Create mesh config with checkpoint_optimization enabled
      const meshDir = path.join(env.meshesDir, 'opt-test');
      fs.mkdirSync(meshDir, { recursive: true });

      const config = {
        mesh: 'opt-test',
        entry_point: 'setup',
        agents: [
          { name: 'setup', model: 'sonnet', prompt: 'setup.md' },
          { name: 'worker1', model: 'haiku', prompt: 'worker.md' },
          { name: 'worker2', model: 'haiku', prompt: 'worker.md' },
          { name: 'worker3', model: 'haiku', prompt: 'worker.md' }
        ],
        routing: {
          setup: { complete: { worker1: 'dispatch work', worker2: 'dispatch work', worker3: 'dispatch work' } },
          worker1: { complete: { core: 'done' } },
          worker2: { complete: { core: 'done' } },
          worker3: { complete: { core: 'done' } }
        },
        manifest: [
          // setup writes file read by all 3 workers (fanout = 3)
          { id: 'context', reads: ['worker1', 'worker2', 'worker3'], writes: ['setup'] }
        ],
        checkpoint_optimization: {
          enabled: true,
          threshold: 3
        }
      };

      fs.writeFileSync(
        path.join(meshDir, 'config.yaml'),
        YAML.stringify(config)
      );

      // Create dummy prompt files
      fs.writeFileSync(path.join(meshDir, 'setup.md'), '# Setup');
      fs.writeFileSync(path.join(meshDir, 'worker.md'), '# Worker');

      // Load meshes
      loader.loadAll();
      const loadedConfig = loader.get('opt-test');

      assert.ok(loadedConfig, 'Config should be loaded');

      // Verify setup was auto-checkpointed
      const setupAgent = loadedConfig!.agents.find(a => a.name === 'setup');
      assert.strictEqual(setupAgent?.checkpoint, true);

      // Verify workers got fork_from inferred
      for (const workerName of ['worker1', 'worker2', 'worker3']) {
        const worker: AgentConfig | undefined = loadedConfig!.agents.find(a => a.name === workerName);
        assert.strictEqual(worker?.fork_from, 'setup', `${workerName} should fork from setup`);
      }
    });

    it('should not apply optimization when disabled', () => {
      const meshDir = path.join(env.meshesDir, 'opt-disabled');
      fs.mkdirSync(meshDir, { recursive: true });

      const config = {
        mesh: 'opt-disabled',
        entry_point: 'setup',
        agents: [
          { name: 'setup', model: 'sonnet', prompt: 'setup.md' },
          { name: 'worker', model: 'haiku', prompt: 'worker.md' }
        ],
        routing: {
          setup: { complete: { worker: 'dispatch' } },
          worker: { complete: { core: 'done' } }
        },
        manifest: [
          { id: 'context', reads: ['worker'], writes: ['setup'] }
        ],
        checkpoint_optimization: {
          enabled: false  // disabled
        }
      };

      fs.writeFileSync(
        path.join(meshDir, 'config.yaml'),
        YAML.stringify(config)
      );
      fs.writeFileSync(path.join(meshDir, 'setup.md'), '# Setup');
      fs.writeFileSync(path.join(meshDir, 'worker.md'), '# Worker');

      loader.loadAll();
      const loadedConfig = loader.get('opt-disabled');

      const setupAgent = loadedConfig!.agents.find(a => a.name === 'setup');
      const workerAgent = loadedConfig!.agents.find(a => a.name === 'worker');

      // Nothing should be modified
      assert.strictEqual(setupAgent?.checkpoint, undefined);
      assert.strictEqual(workerAgent?.fork_from, undefined);
    });

    it('should not apply optimization when manifest is empty', () => {
      const meshDir = path.join(env.meshesDir, 'opt-no-manifest');
      fs.mkdirSync(meshDir, { recursive: true });

      const config = {
        mesh: 'opt-no-manifest',
        agents: [
          { name: 'agent', model: 'sonnet', prompt: 'agent.md' }
        ],
        // no manifest
        checkpoint_optimization: {
          enabled: true,
          threshold: 1
        }
      };

      fs.writeFileSync(
        path.join(meshDir, 'config.yaml'),
        YAML.stringify(config)
      );
      fs.writeFileSync(path.join(meshDir, 'agent.md'), '# Agent');

      loader.loadAll();
      const loadedConfig = loader.get('opt-no-manifest');

      const agent = loadedConfig!.agents.find(a => a.name === 'agent');
      assert.strictEqual(agent?.checkpoint, undefined);
    });

    it('should respect exclude list in integration', () => {
      const meshDir = path.join(env.meshesDir, 'opt-exclude');
      fs.mkdirSync(meshDir, { recursive: true });

      const config = {
        mesh: 'opt-exclude',
        entry_point: 'setup1',
        agents: [
          { name: 'setup1', model: 'sonnet', prompt: 'setup.md' },
          { name: 'setup2', model: 'sonnet', prompt: 'setup.md' },
          { name: 'worker', model: 'haiku', prompt: 'worker.md' }
        ],
        routing: {
          setup1: { complete: { setup2: 'continue' } },
          setup2: { complete: { worker: 'dispatch' } },
          worker: { complete: { core: 'done' } }
        },
        manifest: [
          { id: 'file1', reads: ['worker'], writes: ['setup1'] },
          { id: 'file2', reads: ['worker'], writes: ['setup2'] },
          { id: 'file3', reads: ['worker'], writes: ['setup1'] },
          { id: 'file4', reads: ['worker'], writes: ['setup1'] }
        ],
        checkpoint_optimization: {
          enabled: true,
          threshold: 2,
          exclude: ['setup1']  // exclude even though score >= threshold
        }
      };

      fs.writeFileSync(
        path.join(meshDir, 'config.yaml'),
        YAML.stringify(config)
      );
      fs.writeFileSync(path.join(meshDir, 'setup.md'), '# Setup');
      fs.writeFileSync(path.join(meshDir, 'worker.md'), '# Worker');

      loader.loadAll();
      const loadedConfig = loader.get('opt-exclude');

      const setup1 = loadedConfig!.agents.find(a => a.name === 'setup1');
      const setup2 = loadedConfig!.agents.find(a => a.name === 'setup2');

      // setup1 excluded, so not checkpointed despite high score
      assert.strictEqual(setup1?.checkpoint, undefined);
      // setup2 not excluded, so should be checkpointed if score meets threshold
      // score = 1 (only 1 reader), threshold = 2, so NOT checkpointed
      assert.strictEqual(setup2?.checkpoint, undefined);
    });
  });
});

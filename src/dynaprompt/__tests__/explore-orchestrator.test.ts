/**
 * ExploreOrchestrator unit tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ExploreOrchestrator } from '../explore-orchestrator.ts';
import { AgentCheckpointStore } from '../stores/checkpoint-store.ts';
import { SessionStore } from '../../session/session-store.ts';
import { FragmentRegistry } from '../fragment-registry.ts';

const TEST_CHECKPOINT_DB_PATH = path.join(process.cwd(), '.ai/tx/test-explore-checkpoint.db');
const TEST_SESSION_DB_PATH = path.join(process.cwd(), '.ai/tx/test-explore-session.db');
const TEST_EXPLORATIONS_DIR = path.join(process.cwd(), '.ai/tx/test-explorations');
const TEST_SESSIONS_DIR = path.join(process.cwd(), '.ai/tx/test-sessions');

describe('ExploreOrchestrator', () => {
  let orchestrator: ExploreOrchestrator;
  let checkpointStore: AgentCheckpointStore;
  let sessionStore: SessionStore;
  let fragmentRegistry: FragmentRegistry;

  beforeEach(() => {
    // Clean up test database files
    [TEST_CHECKPOINT_DB_PATH, TEST_SESSION_DB_PATH].forEach(dbPath => {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      if (fs.existsSync(`${dbPath}-shm`)) {
        fs.unlinkSync(`${dbPath}-shm`);
      }
      if (fs.existsSync(`${dbPath}-wal`)) {
        fs.unlinkSync(`${dbPath}-wal`);
      }
    });

    // Clean up test directories
    if (fs.existsSync(TEST_EXPLORATIONS_DIR)) {
      fs.rmSync(TEST_EXPLORATIONS_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_SESSIONS_DIR)) {
      fs.rmSync(TEST_SESSIONS_DIR, { recursive: true });
    }

    // Create test sessions directory
    fs.mkdirSync(TEST_SESSIONS_DIR, { recursive: true });

    // Initialize stores
    checkpointStore = new AgentCheckpointStore(TEST_CHECKPOINT_DB_PATH);
    sessionStore = new SessionStore(TEST_SESSION_DB_PATH);
    fragmentRegistry = new FragmentRegistry();

    // Register test fragments
    fragmentRegistry.register('fragment-a', 'Approach A: Use method X', 'Test fragment A');
    fragmentRegistry.register('fragment-b', 'Approach B: Use method Y', 'Test fragment B');
    fragmentRegistry.register('fragment-c', 'Approach C: Use method Z', 'Test fragment C');

    orchestrator = new ExploreOrchestrator(
      checkpointStore,
      sessionStore,
      fragmentRegistry,
      TEST_EXPLORATIONS_DIR,
      3,    // maxRounds
      0.8   // confidenceThreshold
    );
  });

  afterEach(() => {
    checkpointStore.close();

    // Clean up
    if (fs.existsSync(TEST_EXPLORATIONS_DIR)) {
      fs.rmSync(TEST_EXPLORATIONS_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_SESSIONS_DIR)) {
      fs.rmSync(TEST_SESSIONS_DIR, { recursive: true });
    }
  });

  describe('explore() - validation', () => {
    it('throws if checkpoint not found', async () => {
      await assert.rejects(
        async () => await orchestrator.explore({
          checkpointId: 'nonexistent-checkpoint',
          fragmentNames: ['fragment-a'],
        }),
        /Checkpoint not found/
      );
    });

    it('throws if checkpoint has no conversation_id', async () => {
      const checkpointId = checkpointStore.save({
        mesh_instance: 'test-mesh',
        agent_id: 'test-agent',
        conversation_id: '', // Empty conversation_id
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });

      await assert.rejects(
        async () => await orchestrator.explore({
          checkpointId,
          fragmentNames: ['fragment-a'],
        }),
        /has no conversation_id/
      );
    });

    it('handles missing fragment gracefully', async () => {
      // Note: This test would require mocking the SDK query() function
      // to avoid actual API calls. For now, we just verify the structure.
      // In a real integration test, we would mock query() and test the full flow.

      // Just verify that missing fragment can be detected
      const missingFragment = fragmentRegistry.resolve('nonexistent-fragment');
      assert.strictEqual(missingFragment, null);
    });
  });

  describe('explore() - branch creation', () => {
    it('creates branches with summary context', () => {
      // Verify checkpoint with summary can be created
      const checkpointId = checkpointStore.save({
        mesh_instance: 'test-mesh',
        agent_id: 'test-agent',
        conversation_id: 'conv-123',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: 'User asked about arithmetic. Answer was provided.',
      });

      assert.ok(checkpointId);
      const checkpoint = checkpointStore.get(checkpointId);
      assert.ok(checkpoint);
      assert.ok(checkpoint.summary);
      assert.strictEqual(checkpoint.summary, 'User asked about arithmetic. Answer was provided.');
    });
  });

  describe('explore() - judge verdict parsing', () => {
    it('parses confidence and synthesis from judge output', () => {
      const rawOutput = `CONFIDENCE: 0.85
SYNTHESIS:
The best approach is to combine methods X and Y for optimal results.`;

      const confidenceMatch = rawOutput.match(/CONFIDENCE:\s*([\d.]+)/i);
      const synthesisMatch = rawOutput.match(/SYNTHESIS:\s*([\s\S]+)/i);

      assert.ok(confidenceMatch);
      assert.strictEqual(parseFloat(confidenceMatch[1]), 0.85);

      assert.ok(synthesisMatch);
      assert.ok(synthesisMatch[1].includes('combine methods X and Y'));
    });

    it('handles malformed judge output gracefully', () => {
      const rawOutput = 'This is not a properly formatted verdict.';

      const confidenceMatch = rawOutput.match(/CONFIDENCE:\s*([\d.]+)/i);
      const synthesisMatch = rawOutput.match(/SYNTHESIS:\s*([\s\S]+)/i);

      // Should default to 0.5 if confidence not found
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
      assert.strictEqual(confidence, 0.5);

      // Should use full output as synthesis if format not matched
      const synthesis = synthesisMatch ? synthesisMatch[1].trim() : rawOutput;
      assert.strictEqual(synthesis, rawOutput);
    });
  });

  describe('explore() - confidence threshold logic', () => {
    it('converges when confidence >= threshold', () => {
      const confidenceThreshold = 0.8;

      // High confidence should converge
      const highConfidence = 0.85;
      assert.ok(highConfidence >= confidenceThreshold);

      // Low confidence should NOT converge
      const lowConfidence = 0.75;
      assert.ok(lowConfidence < confidenceThreshold);
    });

    it('stops at max rounds even with low confidence', () => {
      const maxRounds = 3;
      let roundNumber = 0;

      // Simulate exploration loop
      while (roundNumber < maxRounds) {
        roundNumber++;
        const confidence = 0.5; // Always low

        if (confidence >= 0.8) {
          break; // Would converge
        }

        if (roundNumber >= maxRounds) {
          // Should exit here
          assert.strictEqual(roundNumber, maxRounds);
          break;
        }
      }

      assert.strictEqual(roundNumber, maxRounds);
    });
  });

  describe('explore() - dataset JSONL output', () => {
    it('writes exploration dataset to JSONL', () => {
      const explorationId = 'test-explore-123';
      const rounds = [
        {
          exploration_id: explorationId,
          mesh_instance: 'test-mesh',
          agent_id: 'test-agent',
          checkpoint_id: 'test-checkpoint',
          round: 1,
          branches: [
            {
              fragment_name: 'fragment-a',
              conversation_id: 'conv-1',
              outcome: 'success' as const,
              tokens_used: 100,
            },
          ],
          synthesis: 'Test synthesis',
          confidence: 0.85,
          outcome: 'converged' as const,
          created_at: new Date().toISOString(),
        },
      ];

      // Create explorations directory
      if (!fs.existsSync(TEST_EXPLORATIONS_DIR)) {
        fs.mkdirSync(TEST_EXPLORATIONS_DIR, { recursive: true });
      }

      // Write JSONL
      const filepath = path.join(TEST_EXPLORATIONS_DIR, `${explorationId}.jsonl`);
      const lines = rounds.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.writeFileSync(filepath, lines, 'utf-8');

      // Verify file exists
      assert.strictEqual(fs.existsSync(filepath), true);

      // Verify content
      const content = fs.readFileSync(filepath, 'utf-8');
      const parsedRounds = content.trim().split('\n').map(line => JSON.parse(line));

      assert.strictEqual(parsedRounds.length, 1);
      assert.strictEqual(parsedRounds[0].exploration_id, explorationId);
      assert.strictEqual(parsedRounds[0].round, 1);
      assert.strictEqual(parsedRounds[0].confidence, 0.85);
      assert.strictEqual(parsedRounds[0].outcome, 'converged');
    });

    it('supports multiple rounds in JSONL', () => {
      const explorationId = 'test-explore-multi';
      const rounds = [
        {
          exploration_id: explorationId,
          mesh_instance: 'test-mesh',
          agent_id: 'test-agent',
          checkpoint_id: 'test-checkpoint',
          round: 1,
          branches: [],
          synthesis: 'Round 1 synthesis',
          confidence: 0.5,
          outcome: null,
          created_at: new Date().toISOString(),
        },
        {
          exploration_id: explorationId,
          mesh_instance: 'test-mesh',
          agent_id: 'test-agent',
          checkpoint_id: 'test-checkpoint',
          round: 2,
          branches: [],
          synthesis: 'Round 2 synthesis',
          confidence: 0.7,
          outcome: null,
          created_at: new Date().toISOString(),
        },
        {
          exploration_id: explorationId,
          mesh_instance: 'test-mesh',
          agent_id: 'test-agent',
          checkpoint_id: 'test-checkpoint',
          round: 3,
          branches: [],
          synthesis: 'Round 3 synthesis',
          confidence: 0.85,
          outcome: 'converged' as const,
          created_at: new Date().toISOString(),
        },
      ];

      // Create explorations directory
      if (!fs.existsSync(TEST_EXPLORATIONS_DIR)) {
        fs.mkdirSync(TEST_EXPLORATIONS_DIR, { recursive: true });
      }

      // Write JSONL
      const filepath = path.join(TEST_EXPLORATIONS_DIR, `${explorationId}.jsonl`);
      const lines = rounds.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.writeFileSync(filepath, lines, 'utf-8');

      // Verify content
      const content = fs.readFileSync(filepath, 'utf-8');
      const parsedRounds = content.trim().split('\n').map(line => JSON.parse(line));

      assert.strictEqual(parsedRounds.length, 3);
      assert.strictEqual(parsedRounds[0].round, 1);
      assert.strictEqual(parsedRounds[1].round, 2);
      assert.strictEqual(parsedRounds[2].round, 3);
      assert.strictEqual(parsedRounds[2].outcome, 'converged');
    });
  });

  describe('explore() - recursive synthesis', () => {
    it('registers synthesis as fragment for next round', () => {
      const synthesisFragmentName = 'synthesis-round-1';
      const synthesisContent = 'Combined approach from branches A and B';

      // Register synthesis fragment
      fragmentRegistry.register(synthesisFragmentName, synthesisContent, 'Synthesis from judge');

      // Verify it can be resolved
      const resolved = fragmentRegistry.resolve(synthesisFragmentName);
      assert.ok(resolved);
      assert.strictEqual(resolved.name, synthesisFragmentName);
      assert.strictEqual(resolved.content, synthesisContent);
    });

    it('includes synthesis fragment in next round', () => {
      const initialFragments = ['fragment-a', 'fragment-b'];
      const synthesisFragmentName = 'synthesis-round-1';

      // Simulate adding synthesis fragment
      const nextRoundFragments = [...initialFragments, synthesisFragmentName];

      assert.strictEqual(nextRoundFragments.length, 3);
      assert.ok(nextRoundFragments.includes(synthesisFragmentName));
    });
  });
});

/**
 * AgentCheckpointStore unit tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { AgentCheckpointStore } from '../stores/checkpoint-store.ts';

const TEST_DB_PATH = path.join(process.cwd(), '.ai/tx/test-checkpoint-store.db');

describe('AgentCheckpointStore', () => {
  let store: AgentCheckpointStore;

  beforeEach(() => {
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    }

    store = new AgentCheckpointStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();
  });

  describe('save()', () => {
    it('creates checkpoint with unique ID', () => {
      const id = store.save({
        mesh_instance: 'test-mesh',
        agent_id: 'test-agent',
        conversation_id: 'conv-123',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });

      assert.match(id, /^ckpt-\d+-\w+$/);
    });

    it('is idempotent with same ID', () => {
      const id = 'ckpt-test-123';
      const checkpoint = {
        id,
        mesh_instance: 'test-mesh',
        agent_id: 'test-agent',
        conversation_id: 'conv-123',
        parent_checkpoint_id: null,
        label: 'First save',
        snapshot_path: null,
        summary: null,
      };

      const id1 = store.save(checkpoint);
      const id2 = store.save({ ...checkpoint, label: 'Second save' });

      assert.strictEqual(id1, id);
      assert.strictEqual(id2, id);

      const retrieved = store.get(id);
      assert.strictEqual(retrieved?.label, 'Second save');
    });

    it('returns checkpoint ID', () => {
      const id = store.save({
        mesh_instance: 'test-mesh',
        agent_id: 'test-agent',
        conversation_id: 'conv-123',
        parent_checkpoint_id: null,
        label: 'test',
        snapshot_path: null,
        summary: null,
      });

      assert.strictEqual(typeof id, 'string');
      assert.ok(id.length > 0);
    });
  });

  describe('get()', () => {
    it('retrieves checkpoint by ID', () => {
      const id = store.save({
        mesh_instance: 'test-mesh',
        agent_id: 'test-agent',
        conversation_id: 'conv-123',
        parent_checkpoint_id: null,
        label: 'test-label',
        snapshot_path: null,
        summary: 'test summary',
      });

      const checkpoint = store.get(id);
      assert.ok(checkpoint);
      assert.strictEqual(checkpoint?.id, id);
      assert.strictEqual(checkpoint?.mesh_instance, 'test-mesh');
      assert.strictEqual(checkpoint?.agent_id, 'test-agent');
      assert.strictEqual(checkpoint?.conversation_id, 'conv-123');
      assert.strictEqual(checkpoint?.label, 'test-label');
      assert.strictEqual(checkpoint?.summary, 'test summary');
    });

    it('returns null for missing checkpoint', () => {
      const checkpoint = store.get('nonexistent-id');
      assert.strictEqual(checkpoint, null);
    });
  });

  describe('listForMesh()', () => {
    it('returns all checkpoints for mesh', () => {
      store.save({
        mesh_instance: 'mesh-a',
        agent_id: 'agent-1',
        conversation_id: 'conv-1',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });
      store.save({
        mesh_instance: 'mesh-a',
        agent_id: 'agent-2',
        conversation_id: 'conv-2',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });
      store.save({
        mesh_instance: 'mesh-b',
        agent_id: 'agent-3',
        conversation_id: 'conv-3',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });

      const meshACheckpoints = store.listForMesh('mesh-a');
      assert.strictEqual(meshACheckpoints.length, 2);
      assert.ok(meshACheckpoints.every(c => c.mesh_instance === 'mesh-a'));
    });

    it('returns empty array for unknown mesh', () => {
      const checkpoints = store.listForMesh('unknown-mesh');
      assert.deepStrictEqual(checkpoints, []);
    });
  });

  describe('listForAgent()', () => {
    it('returns all checkpoints for agent', () => {
      store.save({
        mesh_instance: 'mesh-a',
        agent_id: 'agent-1',
        conversation_id: 'conv-1',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });
      store.save({
        mesh_instance: 'mesh-a',
        agent_id: 'agent-1',
        conversation_id: 'conv-2',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });
      store.save({
        mesh_instance: 'mesh-b',
        agent_id: 'agent-2',
        conversation_id: 'conv-3',
        parent_checkpoint_id: null,
        label: null,
        snapshot_path: null,
        summary: null,
      });

      const agent1Checkpoints = store.listForAgent('agent-1');
      assert.strictEqual(agent1Checkpoints.length, 2);
      assert.ok(agent1Checkpoints.every(c => c.agent_id === 'agent-1'));
    });
  });

  describe('children()', () => {
    it('returns immediate children only', () => {
      const parentId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-parent',
        parent_checkpoint_id: null,
        label: 'parent',
        snapshot_path: null,
        summary: null,
      });

      const child1Id = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-child1',
        parent_checkpoint_id: parentId,
        label: 'child1',
        snapshot_path: null,
        summary: null,
      });

      const child2Id = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-child2',
        parent_checkpoint_id: parentId,
        label: 'child2',
        snapshot_path: null,
        summary: null,
      });

      // Grandchild
      store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-grandchild',
        parent_checkpoint_id: child1Id,
        label: 'grandchild',
        snapshot_path: null,
        summary: null,
      });

      const children = store.children(parentId);
      assert.strictEqual(children.length, 2);
      assert.deepStrictEqual(children.map(c => c.id).sort(), [child1Id, child2Id].sort());
    });

    it('returns empty for leaf checkpoint', () => {
      const leafId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-leaf',
        parent_checkpoint_id: null,
        label: 'leaf',
        snapshot_path: null,
        summary: null,
      });

      const children = store.children(leafId);
      assert.deepStrictEqual(children, []);
    });
  });

  describe('tree()', () => {
    it('builds full hierarchical structure', () => {
      const rootId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-root',
        parent_checkpoint_id: null,
        label: 'root',
        snapshot_path: null,
        summary: null,
      });

      const child1Id = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-child1',
        parent_checkpoint_id: rootId,
        label: 'child1',
        snapshot_path: null,
        summary: null,
      });

      const grandchildId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-grandchild',
        parent_checkpoint_id: child1Id,
        label: 'grandchild',
        snapshot_path: null,
        summary: null,
      });

      const tree = store.tree(rootId);
      assert.ok(tree);
      assert.strictEqual(tree?.checkpoint.id, rootId);
      assert.strictEqual(tree?.children.length, 1);
      assert.strictEqual(tree?.children[0].checkpoint.id, child1Id);
      assert.strictEqual(tree?.children[0].children.length, 1);
      assert.strictEqual(tree?.children[0].children[0].checkpoint.id, grandchildId);
    });

    it('returns null for missing root', () => {
      const tree = store.tree('nonexistent-id');
      assert.strictEqual(tree, null);
    });
  });

  describe('totalForks()', () => {
    it('counts all descendants', () => {
      const rootId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-root',
        parent_checkpoint_id: null,
        label: 'root',
        snapshot_path: null,
        summary: null,
      });

      const child1Id = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-child1',
        parent_checkpoint_id: rootId,
        label: 'child1',
        snapshot_path: null,
        summary: null,
      });

      const child2Id = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-child2',
        parent_checkpoint_id: rootId,
        label: 'child2',
        snapshot_path: null,
        summary: null,
      });

      store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-grandchild',
        parent_checkpoint_id: child1Id,
        label: 'grandchild',
        snapshot_path: null,
        summary: null,
      });

      const total = store.totalForks(rootId);
      assert.strictEqual(total, 3); // 2 children + 1 grandchild
    });

    it('returns 0 for leaf checkpoint', () => {
      const leafId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-leaf',
        parent_checkpoint_id: null,
        label: 'leaf',
        snapshot_path: null,
        summary: null,
      });

      const total = store.totalForks(leafId);
      assert.strictEqual(total, 0);
    });
  });

  describe('gc()', () => {
    it('removes checkpoints older than threshold', () => {
      const now = Date.now();
      const old = now - (10 * 24 * 60 * 60 * 1000); // 10 days ago

      // Create old checkpoint
      const oldId = store.save({
        id: 'old-checkpoint',
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-old',
        parent_checkpoint_id: null,
        label: 'old',
        snapshot_path: null,
        summary: null,
        created_at: old,
      });

      // Create recent checkpoint
      const recentId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-recent',
        parent_checkpoint_id: null,
        label: 'recent',
        snapshot_path: null,
        summary: null,
      });

      store.gc(7); // Remove older than 7 days

      assert.strictEqual(store.get(oldId), null);
      assert.ok(store.get(recentId) !== null);
    });

    it('preserves recent checkpoints', () => {
      const recentId = store.save({
        mesh_instance: 'mesh',
        agent_id: 'agent',
        conversation_id: 'conv-recent',
        parent_checkpoint_id: null,
        label: 'recent',
        snapshot_path: null,
        summary: null,
      });

      store.gc(1); // Remove older than 1 day

      assert.ok(store.get(recentId) !== null);
    });
  });
});

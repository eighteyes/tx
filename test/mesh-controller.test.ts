/**
 * Unit tests for MeshController
 *
 * Tests the mesh controller functionality without starting the server.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MeshController, MeshNotFoundError } from '../src/controllers/mesh-controller.ts';

// Use the actual meshes directory for testing
const MESHES_DIR = path.join(process.cwd(), 'meshes');

describe('MeshController', () => {
  let controller: MeshController;

  before(() => {
    controller = new MeshController(MESHES_DIR);
  });

  describe('listMeshes', () => {
    it('should list all meshes', async () => {
      const result = await controller.listMeshes();

      assert(result.meshes, 'Should have meshes array');
      assert(result.meshes.length > 0, 'Should have at least one mesh');

      // Check mesh structure
      const mesh = result.meshes[0];
      assert(typeof mesh.name === 'string', 'Mesh should have name');
      assert(typeof mesh.path === 'string', 'Mesh should have path');
      assert(typeof mesh.description === 'string' || mesh.description === '', 'Mesh should have description');
      assert(typeof mesh.agents === 'number', 'Mesh should have agent count');
      assert(['yaml', 'json'].includes(mesh.configType), 'Mesh should have valid configType');

      console.log(`Found ${result.meshes.length} meshes`);
    });

    it('should include dev mesh', async () => {
      const result = await controller.listMeshes();
      const devMesh = result.meshes.find(m => m.name === 'dev');

      assert(devMesh, 'Should find dev mesh');
      assert.strictEqual(devMesh.configType, 'yaml');
      assert(devMesh.agents >= 1, 'Dev mesh should have at least 1 agent');
    });
  });

  describe('getMesh', () => {
    it('should get dev mesh config', async () => {
      const result = await controller.getMesh('dev');

      assert.strictEqual(result.name, 'dev');
      assert.strictEqual(result.configType, 'yaml');
      assert(result.config, 'Should have config');
      assert(result.raw, 'Should have raw content');
      assert.strictEqual(result.config.mesh, 'dev');
      assert(Array.isArray(result.config.agents), 'Config should have agents array');

      console.log('Dev mesh config loaded successfully');
    });

    it('should throw MeshNotFoundError for nonexistent mesh', async () => {
      await assert.rejects(
        () => controller.getMesh('nonexistent-mesh-12345'),
        (err: Error) => {
          assert(err instanceof MeshNotFoundError);
          return true;
        }
      );
    });
  });

  describe('validateMesh', () => {
    it('should validate a valid config', async () => {
      const config = {
        mesh: 'test-valid',
        agents: [
          { name: 'worker', model: 'opus', prompt: 'prompt.md' }
        ],
        entry_point: 'worker'
      };

      const result = await controller.validateMesh('test', config as any);

      assert.strictEqual(result.valid, true);
      assert(!result.errors || result.errors.length === 0, 'Should have no errors');

      console.log('Valid config passed validation');
    });

    it('should reject config missing required fields', async () => {
      const config = {
        mesh: 'test-invalid'
        // Missing agents
      };

      const result = await controller.validateMesh('test', config as any);

      assert.strictEqual(result.valid, false);
      assert(result.errors && result.errors.length > 0, 'Should have errors');
      assert(result.errors.some(e => e.includes('agents')), 'Error should mention agents');

      console.log('Invalid config rejected:', result.errors);
    });

    it('should reject config with invalid model', async () => {
      const config = {
        mesh: 'test-invalid-model',
        agents: [
          { name: 'worker', model: 'invalid-model', prompt: 'prompt.md' }
        ]
      };

      const result = await controller.validateMesh('test', config as any);

      assert.strictEqual(result.valid, false);
      assert(result.errors && result.errors.length > 0, 'Should have errors');
      assert(result.errors.some(e => e.includes('model')), 'Error should mention model');

      console.log('Invalid model rejected:', result.errors);
    });
  });

  describe('updateMesh', () => {
    const TEST_MESH_NAME = 'test-mesh-controller-temp';
    const TEST_MESH_DIR = path.join(MESHES_DIR, TEST_MESH_NAME);

    before(async () => {
      // Create a temporary test mesh directory
      await fs.mkdir(TEST_MESH_DIR, { recursive: true });
      await fs.writeFile(
        path.join(TEST_MESH_DIR, 'config.yaml'),
        'mesh: test-mesh-controller-temp\nagents:\n  - name: worker\n    model: opus\n    prompt: prompt.md\nentry_point: worker\n'
      );
    });

    after(async () => {
      // Clean up test mesh
      try {
        await fs.rm(TEST_MESH_DIR, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should update mesh config', async () => {
      const newConfig = {
        mesh: TEST_MESH_NAME,
        description: 'Updated mesh description',
        agents: [
          { name: 'worker', model: 'sonnet', prompt: 'prompt.md' }
        ],
        entry_point: 'worker'
      };

      const result = await controller.updateMesh(TEST_MESH_NAME, {
        config: newConfig as any,
        format: 'yaml'
      });

      assert.strictEqual(result.success, true, 'Update should succeed');

      // Verify the update
      const updated = await controller.getMesh(TEST_MESH_NAME);
      assert.strictEqual(updated.config.description, 'Updated mesh description');
      assert.strictEqual(updated.config.agents[0].model, 'sonnet');

      console.log('Mesh config updated successfully');
    });

    it('should reject invalid config on update', async () => {
      const invalidConfig = {
        mesh: TEST_MESH_NAME
        // Missing agents
      };

      const result = await controller.updateMesh(TEST_MESH_NAME, {
        config: invalidConfig as any,
        format: 'yaml'
      });

      assert.strictEqual(result.success, false, 'Update should fail');
      assert(result.errors && result.errors.length > 0, 'Should have validation errors');

      console.log('Invalid update rejected:', result.errors);
    });

    it('should throw MeshNotFoundError for nonexistent mesh', async () => {
      const config = {
        mesh: 'nonexistent',
        agents: [{ name: 'worker', model: 'opus', prompt: 'prompt.md' }]
      };

      await assert.rejects(
        () => controller.updateMesh('nonexistent-mesh-12345', { config: config as any, format: 'yaml' }),
        (err: Error) => {
          assert(err instanceof MeshNotFoundError);
          return true;
        }
      );
    });
  });
});

// Run tests
console.log('Running MeshController tests...\n');

/**
 * Copy Mesh Utility
 *
 * Reusable helper to copy mesh directories from the project into test environments.
 * Handles nested directories (1 level deep) and preserves directory structure.
 *
 * Responsibilities:
 * - Copy mesh config and prompts from source to test environment
 * - Handle nested directories (scripts, templates, etc.)
 * - Create target mesh directory structure recursively
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestEnv } from './test-env.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Copy a mesh from the project's meshes directory into the test environment.
 *
 * @param env - Test environment with meshesDir property
 * @param meshName - Name of mesh to copy (e.g., 'test-parallelism')
 */
export function copyTestMesh(env: TestEnv, meshName: string): void {
  const srcMeshDir = path.resolve(__dirname, '../../meshes', meshName);
  const destMeshDir = path.join(env.meshesDir, meshName);

  fs.mkdirSync(destMeshDir, { recursive: true });

  const files = fs.readdirSync(srcMeshDir);
  for (const file of files) {
    const srcPath = path.join(srcMeshDir, file);
    const destPath = path.join(destMeshDir, file);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      for (const subFile of fs.readdirSync(srcPath)) {
        fs.copyFileSync(path.join(srcPath, subFile), path.join(destPath, subFile));
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

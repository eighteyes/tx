/**
 * API Endpoints Test
 *
 * Tests HTTP API endpoints for the tx-server including:
 * - Health check
 * - Mesh management
 * - Workspace operations (with security tests)
 * - Dashboard stats
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { server } from '../../src/cli/server.ts';

const API_PORT = 6001; // Use different port to avoid conflicts
const API_HOST = 'localhost';
const BASE_URL = `http://${API_HOST}:${API_PORT}`;

/**
 * Helper to make HTTP requests with retry
 */
async function request(
  method: string,
  path: string,
  body?: unknown,
  retries = 3
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const options: http.RequestOptions = {
          hostname: API_HOST,
          port: API_PORT,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
          },
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : null;
              resolve({
                status: res.statusCode || 0,
                data: parsed,
                headers: res.headers,
              });
            } catch (err) {
              resolve({
                status: res.statusCode || 0,
                data: data,
                headers: res.headers,
              });
            }
          });
        });

        req.on('error', reject);

        if (body) {
          req.write(JSON.stringify(body));
        }

        req.end();
      });
    } catch (err: any) {
      if (i === retries - 1 || err.code !== 'ECONNREFUSED') {
        throw err;
      }
      // Wait before retry
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Max retries exceeded');
}

describe('API Endpoints', () => {
  let shutdown: (() => Promise<void>) | undefined;

  before(async () => {
    // Start server in embedded no-db mode for testing
    shutdown = (await server({
      port: API_PORT,
      host: API_HOST,
      noDb: true,
      embedded: true,
    })) as () => Promise<void>;

    // Wait for server to be ready (longer timeout for initialization)
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  after(async () => {
    if (shutdown) {
      await shutdown();
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const res = await request('GET', '/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ok');
      assert.ok(res.data.timestamp);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in response', async () => {
      const res = await request('GET', '/health');
      assert.strictEqual(res.headers['access-control-allow-origin'], '*');
      assert.ok(res.headers['access-control-allow-methods']);
    });
  });

  describe('Mesh Management', () => {
    it('should list all meshes', async () => {
      const res = await request('GET', '/v1/meshes');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.meshes));
    });

    it('should get a specific mesh config', async () => {
      // First get the list to find a mesh
      const listRes = await request('GET', '/v1/meshes');
      if (listRes.data.meshes.length > 0) {
        const meshName = listRes.data.meshes[0];
        const res = await request('GET', `/v1/meshes/${meshName}`);
        assert.ok(res.status === 200 || res.status === 404); // 404 if mesh has no config
      }
    });

    it('should return 404 for non-existent mesh', async () => {
      const res = await request('GET', '/v1/meshes/nonexistent-mesh-12345');
      assert.strictEqual(res.status, 404);
    });
  });

  describe('Workspace API', () => {
    it('should list workspace root directory', async () => {
      const res = await request('GET', '/v1/workspace?path=');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.path, '');
      assert.ok(Array.isArray(res.data.entries));
      assert.ok(res.data.parent === null);
    });

    it('should read a file from workspace', async () => {
      const res = await request('GET', '/v1/workspace/file?path=package.json');
      if (res.status === 200) {
        assert.ok(res.data.content);
        assert.strictEqual(res.data.path, 'package.json');
        assert.ok(res.data.size > 0);
        assert.ok(res.data.modified);
      } else {
        // File might not exist in test environment
        assert.strictEqual(res.status, 404);
      }
    });

    it('should return 400 if path is missing for file read', async () => {
      const res = await request('GET', '/v1/workspace/file');
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error);
    });

    it('should handle non-existent file gracefully', async () => {
      const res = await request('GET', '/v1/workspace/file?path=nonexistent-file-12345.txt');
      assert.strictEqual(res.status, 404);
    });
  });

  describe('Workspace Security - Path Traversal Protection', () => {
    it('should block path traversal with ../', async () => {
      const res = await request('GET', '/v1/workspace/file?path=../../etc/passwd');
      assert.strictEqual(res.status, 403);
      assert.ok(res.data.error.includes('outside workspace') || res.data.error.includes('Path'));
    });

    it('should block path traversal with absolute paths', async () => {
      const res = await request('GET', '/v1/workspace/file?path=/etc/passwd');
      assert.strictEqual(res.status, 403);
    });

    it('should block encoded path traversal attempts', async () => {
      const res = await request('GET', '/v1/workspace/file?path=..%2F..%2Fetc%2Fpasswd');
      // Node.js URL parser decodes this, so it should be caught
      assert.ok(res.status === 403 || res.status === 404);
    });

    it('should allow legitimate nested paths', async () => {
      const res = await request('GET', '/v1/workspace?path=src');
      // Should succeed or return 404 if src doesn't exist
      assert.ok(res.status === 200 || res.status === 404);
      if (res.status === 200) {
        assert.ok(Array.isArray(res.data.entries));
      }
    });

    it('should block directory traversal in write operations', async () => {
      const res = await request('PUT', '/v1/workspace/file', {
        path: '../../../tmp/malicious.txt',
        content: 'should not be written',
      });
      assert.strictEqual(res.status, 403);
    });

    it('should block directory traversal in delete operations', async () => {
      const res = await request('DELETE', '/v1/workspace/entry?path=../../etc/passwd');
      assert.strictEqual(res.status, 403);
    });
  });

  describe('Dashboard Stats', () => {
    it('should return dashboard statistics', async () => {
      const res = await request('GET', '/v1/dashboard/stats');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data);
      // Stats structure depends on what's available in no-db mode
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent API routes', async () => {
      const res = await request('GET', '/v1/nonexistent-endpoint');
      assert.strictEqual(res.status, 404);
    });

    it('should handle malformed JSON body', async () => {
      return new Promise<void>((resolve, reject) => {
        const options: http.RequestOptions = {
          hostname: API_HOST,
          port: API_PORT,
          path: '/v1/workspace/file',
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
        };

        const req = http.request(options, (res) => {
          assert.ok(res.statusCode === 400 || res.statusCode === 500);
          resolve();
        });

        req.on('error', reject);
        req.write('{ invalid json }');
        req.end();
      });
    });
  });

  describe('Static File Serving', () => {
    it('should serve index.html for root path', async () => {
      const res = await request('GET', '/');
      // Should either serve the built frontend or return a message
      assert.ok(res.status === 200 || res.status === 404);
    });

    it('should fall back to index.html for SPA routes', async () => {
      const res = await request('GET', '/some-spa-route');
      // Should either serve the built frontend or return a message
      assert.ok(res.status === 200 || res.status === 404);
    });
  });
});

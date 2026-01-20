/**
 * deploy.ts - Deploy command
 *
 * One-line description: Deploy a mesh to Cloud Run via tx-server
 *
 * Responsibilities:
 * - Load and validate credentials (refresh if expired)
 * - Validate mesh exists in meshes/{meshName}/
 * - Package mesh directory as tarball
 * - POST multipart to tx-server /v1/deployments
 * - Poll deployment status until complete/failed
 * - Display service URL on success
 */

import fs from 'node:fs';
import path from 'node:path';
import tar from 'tar';
import { getValidCredentials, getServerUrl, type Credentials } from './credentials.ts';

export interface DeployOptions {
  region?: string;
  version?: string;
}

export interface DeployResult {
  success: boolean;
  deploymentId?: string;
  serviceUrl?: string;
  error?: string;
  status?: string;
}

interface DeploymentStatus {
  id: string;
  status: 'pending' | 'building' | 'deploying' | 'running' | 'failed';
  serviceUrl?: string;
  error?: string;
  logs?: string[];
}

/**
 * Get the meshes directory path
 */
function getMeshesDir(): string {
  const workDir = process.env.TX_CWD || process.cwd();
  return path.join(workDir, 'meshes');
}

/**
 * Validate that a mesh exists and has required files
 */
function validateMesh(meshName: string): { valid: boolean; error?: string; meshDir?: string } {
  const meshesDir = getMeshesDir();
  const meshDir = path.join(meshesDir, meshName);

  if (!fs.existsSync(meshDir)) {
    return {
      valid: false,
      error: `Mesh '${meshName}' not found in ${meshesDir}`,
    };
  }

  const configPath = path.join(meshDir, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return {
      valid: false,
      error: `Mesh '${meshName}' is missing config.yaml`,
    };
  }

  return { valid: true, meshDir };
}

/**
 * Package mesh directory as a gzipped tarball
 */
async function packageMesh(meshDir: string): Promise<Buffer> {
  const os = await import('node:os');
  const tmpPath = path.join(os.tmpdir(), `tx-mesh-${Date.now()}.tar.gz`);

  await tar.create(
    {
      gzip: true,
      cwd: meshDir,
      portable: true,
      file: tmpPath,
    },
    ['.']
  );

  const buffer = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);

  return buffer;
}

/**
 * Upload mesh tarball to tx-server
 */
async function uploadMesh(
  tarball: Buffer,
  meshName: string,
  creds: Credentials,
  options: DeployOptions
): Promise<{ deploymentId: string }> {
  const serverUrl = creds.serverUrl || getServerUrl();

  // Create multipart form data
  const boundary = `----TxDeployBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  // Add mesh name field
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="meshName"\r\n\r\n` +
    `${meshName}\r\n`
  ));

  // Add region field if specified
  if (options.region) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="region"\r\n\r\n` +
      `${options.region}\r\n`
    ));
  }

  // Add version field if specified
  if (options.version) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="version"\r\n\r\n` +
      `${options.version}\r\n`
    ));
  }

  // Add tarball file
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="mesh"; filename="${meshName}.tar.gz"\r\n` +
    `Content-Type: application/gzip\r\n\r\n`
  ));
  parts.push(tarball);
  parts.push(Buffer.from('\r\n'));

  // Add closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const response = await fetch(`${serverUrl}/v1/deployments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  const data = await response.json() as { deploymentId: string };
  return data;
}

/**
 * Poll deployment status until complete or failed
 */
async function pollDeploymentStatus(
  deploymentId: string,
  creds: Credentials
): Promise<DeploymentStatus> {
  const serverUrl = creds.serverUrl || getServerUrl();
  const maxAttempts = 120; // 10 minutes max (5 second intervals)
  const pollInterval = 5000;

  let lastStatus = '';

  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${serverUrl}/v1/deployments/${deploymentId}`, {
      headers: {
        'Authorization': `Bearer ${creds.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get deployment status: HTTP ${response.status}`);
    }

    const status = await response.json() as DeploymentStatus;

    // Print status updates
    if (status.status !== lastStatus) {
      lastStatus = status.status;
      printStatusUpdate(status.status);
    }

    // Check terminal states
    if (status.status === 'running') {
      return status;
    }

    if (status.status === 'failed') {
      return status;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Deployment timed out after 10 minutes');
}

/**
 * Print status update
 */
function printStatusUpdate(status: string): void {
  const icons: Record<string, string> = {
    pending: '⏳',
    building: '🔨',
    deploying: '🚀',
    running: '✓',
    failed: '✗',
  };

  const icon = icons[status] || '•';
  console.log(`  ${icon} ${status.charAt(0).toUpperCase() + status.slice(1)}...`);
}

/**
 * Deploy a mesh to Cloud Run
 */
export async function deploy(meshName: string, options: DeployOptions = {}): Promise<DeployResult> {
  // Validate mesh name
  if (!meshName) {
    console.error('Usage: tx deploy <mesh>');
    console.error('');
    console.error('Example: tx deploy research');
    process.exit(1);
  }

  // Get valid credentials
  const creds = await getValidCredentials();
  if (!creds) {
    console.error('Not logged in. Run "tx login" first.');
    process.exit(1);
  }

  // Validate mesh exists
  const validation = validateMesh(meshName);
  if (!validation.valid) {
    console.error(`Error: ${validation.error}`);
    process.exit(1);
  }

  console.log(`\nDeploying mesh '${meshName}'...`);
  console.log('');

  try {
    // Package mesh
    console.log('  📦 Packaging mesh...');
    const tarball = await packageMesh(validation.meshDir!);
    console.log(`     ${(tarball.length / 1024).toFixed(1)} KB`);

    // Upload and start deployment
    console.log('  ☁️  Uploading to tx-server...');
    const { deploymentId } = await uploadMesh(tarball, meshName, creds, options);

    // Poll for completion
    console.log('');
    console.log('Deployment status:');
    const status = await pollDeploymentStatus(deploymentId, creds);

    console.log('');

    if (status.status === 'running') {
      const result: DeployResult = {
        success: true,
        deploymentId,
        serviceUrl: status.serviceUrl,
        status: 'running',
      };
      printDeployResult(result);
      return result;
    } else {
      const result: DeployResult = {
        success: false,
        deploymentId,
        error: status.error || 'Deployment failed',
        status: status.status,
      };
      printDeployResult(result);
      process.exit(1);
      return result; // unreachable but TypeScript needs it
    }
  } catch (error) {
    const result: DeployResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    printDeployResult(result);
    process.exit(1);
    return result; // unreachable but TypeScript needs it
  }
}

/**
 * Print deployment result
 */
export function printDeployResult(result: DeployResult): void {
  if (result.success) {
    console.log('✓ Deployment successful!');
    console.log('');
    if (result.serviceUrl) {
      console.log(`  Service URL: ${result.serviceUrl}`);
    }
    if (result.deploymentId) {
      console.log(`  Deployment ID: ${result.deploymentId}`);
    }
    console.log('');
    console.log('Your mesh is now running on Cloud Run.');
    if (result.serviceUrl) {
      console.log(`Test it with: curl -X POST ${result.serviceUrl} -d '{"prompt": "hello"}'`);
    }
  } else {
    console.log('✗ Deployment failed');
    console.log('');
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    if (result.deploymentId) {
      console.log(`  Deployment ID: ${result.deploymentId}`);
      console.log(`  Check logs with: tx deployments logs ${result.deploymentId}`);
    }
  }
}

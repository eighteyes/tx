/**
 * Test environment helpers
 *
 * Provides isolated test directories that don't interfere with real TX state.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface TestEnv {
  /** Root temp directory for this test */
  rootDir: string;
  /** .ai/tx directory */
  txDir: string;
  /** .ai/tx/msgs directory */
  msgsDir: string;
  /** .ai/tx/data directory */
  dataDir: string;
  /** .ai/tx/sessions directory */
  sessionsDir: string;
  /** .ai/tx/logs directory */
  logsDir: string;
  /** meshes directory */
  meshesDir: string;
  /** Path to queue database */
  dbPath: string;
  /** Cleanup function - call in afterEach/after */
  cleanup: () => void;
}

/**
 * Create an isolated test environment in a temp directory.
 * All TX paths are created under this temp dir.
 *
 * @param prefix - Prefix for the temp directory name
 * @returns TestEnv with all paths and cleanup function
 */
export function createTestEnv(prefix: string = 'tx-v4-test'): TestEnv {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));

  const txDir = path.join(rootDir, '.ai', 'tx');
  const msgsDir = path.join(txDir, 'msgs');
  const dataDir = path.join(txDir, 'data');
  const sessionsDir = path.join(txDir, 'sessions');
  const logsDir = path.join(txDir, 'logs');
  const meshesDir = path.join(rootDir, 'meshes');
  const dbPath = path.join(dataDir, 'queue.db');

  // Create all directories
  fs.mkdirSync(msgsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(path.join(meshesDir, 'configs'), { recursive: true });
  fs.mkdirSync(path.join(meshesDir, 'agents'), { recursive: true });

  const cleanup = () => {
    try {
      fs.rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    rootDir,
    txDir,
    msgsDir,
    dataDir,
    sessionsDir,
    logsDir,
    meshesDir,
    dbPath,
    cleanup
  };
}

/**
 * Helper to create a test message file
 * Note: type is optional to support Phase 7 terminal-by-default inference
 */
export function createTestMessage(msgsDir: string, filename: string, content: {
  to: string;
  from: string;
  type?: string;
  status?: string;
  msgId?: string;
  headline?: string;
  command?: string;
  body: string;
  rearmatter?: Record<string, unknown>;
}): string {
  const frontmatter = [
    '---',
    `to: ${content.to}`,
    `from: ${content.from}`,
  ];

  // Phase 7: type is optional - will be inferred by consumer
  if (content.type) frontmatter.push(`type: ${content.type}`);

  if (content.status) frontmatter.push(`status: ${content.status}`);
  if (content.msgId) frontmatter.push(`msg-id: ${content.msgId}`);
  if (content.headline) frontmatter.push(`headline: ${content.headline}`);
  if (content.command) frontmatter.push(`command: ${content.command}`);
  frontmatter.push(`timestamp: ${new Date().toISOString()}`);
  frontmatter.push('---');

  let fullContent = frontmatter.join('\n') + '\n\n' + content.body;

  // Add rearmatter if provided
  if (content.rearmatter) {
    const rearmatterLines = ['', '---'];
    for (const [key, value] of Object.entries(content.rearmatter)) {
      rearmatterLines.push(`${key}: ${value}`);
    }
    fullContent += rearmatterLines.join('\n');
  }

  const filepath = path.join(msgsDir, filename);
  fs.writeFileSync(filepath, fullContent);
  return filepath;
}

/**
 * Helper to wait for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

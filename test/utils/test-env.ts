/**
 * Test Environment Utilities for E2E Tests with Real LLM
 *
 * Provides isolated test environments, message utilities, and wait helpers
 * for E2E testing against actual Claude API.
 *
 * Strategy:
 * - Use haiku model for cost efficiency
 * - Real file system and SQLite (no mocks)
 * - Flexible assertions (regex matching)
 * - Cost tracking per test run
 * - Clean temp directories per test
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue, type Message } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';

// ============================================
// Types
// ============================================

export interface TestEnvConfig {
  /** Test identifier for temp directory naming */
  testId: string;
  /** Whether to set up mesh configs (default: true) */
  setupMeshes?: boolean;
  /** Optional custom mesh configs to create */
  meshConfigs?: MeshConfigSetup[];
}

export interface MeshConfigSetup {
  name: string;
  config: Record<string, unknown>;
  prompts?: Record<string, string>;  // { "agent-name.md": "prompt content" }
  scripts?: Record<string, string>;  // { "script-name.sh": "script content" }
}

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
  /** .ai/tx/sys-msgs directory */
  sysMsgsDir: string;
  /** .ai/output directory for workspace outputs */
  outputDir: string;
  /** meshes directory */
  meshesDir: string;
  /** Path to queue database */
  dbPath: string;
  /** Message queue instance */
  queue: MessageQueue;
  /** Cleanup function - call in afterEach/after */
  cleanup: () => Promise<void>;
}

export interface MessageCriteria {
  /** Message type to match (e.g., 'task-complete', 'ask-human') */
  type?: string;
  /** Recipient agent */
  to?: string;
  /** Sender agent */
  from?: string;
  /** Status to match */
  status?: string;
  /** Body content pattern (regex) */
  bodyPattern?: RegExp;
  /** Headline pattern (regex) */
  headlinePattern?: RegExp;
}

export interface MessageData {
  to: string;
  from: string;
  type: string;
  headline?: string;
  body: string;
  msgId?: string;
  status?: string;
  command?: string;
  rearmatter?: Record<string, unknown>;
}

export interface WorkerResult {
  success: boolean;
  output?: string;
  sessionId?: string;
  error?: string;
  messagesProcessed?: number;
  cost?: {
    inputTokens: number;
    outputTokens: number;
    totalDollars: number;
  };
}

export interface WaitOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Poll interval in milliseconds (default: 100) */
  interval?: number;
}

// ============================================
// Constants
// ============================================

export const DEFAULT_TIMEOUT = 30000;
export const DEFAULT_POLL_INTERVAL = 100;
export const MAX_COST_PER_TEST = 0.10;  // $0.10 limit per test

export const TIMEOUTS = {
  workerSpawn: 5000,      // Worker starts within 5s
  workerComplete: 30000,  // Worker completes within 30s
  askResponse: 60000,     // Human response within 60s
  fsmTransition: 2000,    // FSM transition within 2s
  messageDelivery: 1000,  // Message delivered within 1s
};

// ============================================
// Setup/Teardown Functions
// ============================================

/**
 * Create an isolated test environment with all necessary directories
 * and a fresh SQLite database.
 */
export async function setupTestEnv(testId: string): Promise<TestEnv> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `tx-v4-test-${testId}-`));

  const txDir = path.join(rootDir, '.ai', 'tx');
  const msgsDir = path.join(txDir, 'msgs');
  const dataDir = path.join(txDir, 'data');
  const sessionsDir = path.join(txDir, 'sessions');
  const logsDir = path.join(txDir, 'logs');
  const sysMsgsDir = path.join(txDir, 'sys-msgs');
  const outputDir = path.join(rootDir, '.ai', 'output');
  const meshesDir = path.join(rootDir, 'meshes');
  const dbPath = path.join(dataDir, 'queue.db');

  // Create all directories
  fs.mkdirSync(msgsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(sysMsgsDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(meshesDir, 'configs'), { recursive: true });
  fs.mkdirSync(path.join(meshesDir, 'agents'), { recursive: true });

  // Initialize queue
  const queue = new MessageQueue(dbPath);

  const cleanup = async () => {
    try {
      queue.close();
    } catch {
      // Ignore close errors
    }
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
    sysMsgsDir,
    outputDir,
    meshesDir,
    dbPath,
    queue,
    cleanup,
  };
}

/**
 * Clean up a test environment
 */
export async function cleanupTestEnv(env: TestEnv): Promise<void> {
  await env.cleanup();
}

// ============================================
// Mesh Setup Utilities
// ============================================

/**
 * Create a test mesh configuration in the test environment
 */
export function createTestMesh(
  env: TestEnv,
  meshSetup: MeshConfigSetup
): void {
  const meshDir = path.join(env.meshesDir, meshSetup.name);
  fs.mkdirSync(meshDir, { recursive: true });

  // Write config.yaml
  const YAML = require('yaml');
  fs.writeFileSync(
    path.join(meshDir, 'config.yaml'),
    YAML.stringify(meshSetup.config)
  );

  // Write prompts
  if (meshSetup.prompts) {
    for (const [filename, content] of Object.entries(meshSetup.prompts)) {
      fs.writeFileSync(path.join(meshDir, filename), content);
    }
  }

  // Write scripts
  if (meshSetup.scripts) {
    const scriptsDir = path.join(meshDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    for (const [filename, content] of Object.entries(meshSetup.scripts)) {
      const scriptPath = path.join(scriptsDir, filename);
      fs.writeFileSync(scriptPath, content);
      fs.chmodSync(scriptPath, '755');
    }
  }
}

// ============================================
// Message Writing Utilities
// ============================================

/**
 * Write a message file to the test environment's msgs directory.
 * This will trigger the Consumer file watcher.
 */
export async function writeMessage(
  env: TestEnv,
  message: MessageData
): Promise<string> {
  const timestamp = Date.now();
  const msgId = message.msgId || `msg-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

  // Format filename: {timestamp}-{type}-{from}--{to}-{msg-id}.md
  const fromSafe = message.from.replace('/', '-');
  const toSafe = message.to.replace('/', '-');
  const filename = `${timestamp}-${message.type}-${fromSafe}--${toSafe}-${msgId}.md`;

  const frontmatter = [
    '---',
    `to: ${message.to}`,
    `from: ${message.from}`,
    `type: ${message.type}`,
  ];

  if (message.status) frontmatter.push(`status: ${message.status}`);
  frontmatter.push(`msg-id: ${msgId}`);
  if (message.headline) frontmatter.push(`headline: ${message.headline}`);
  if (message.command) frontmatter.push(`command: ${message.command}`);
  frontmatter.push(`timestamp: ${new Date(timestamp).toISOString()}`);
  frontmatter.push('---');

  let fullContent = frontmatter.join('\n') + '\n\n' + message.body;

  // Add rearmatter if provided
  if (message.rearmatter) {
    const rearmatterLines = ['', '---'];
    for (const [key, value] of Object.entries(message.rearmatter)) {
      rearmatterLines.push(`${key}: ${value}`);
    }
    fullContent += rearmatterLines.join('\n');
  }

  const filepath = path.join(env.msgsDir, filename);
  fs.writeFileSync(filepath, fullContent);

  // Give file system a moment to process
  await sleep(50);

  return filepath;
}

/**
 * Write a message directly to the queue (bypasses file watcher)
 */
export function insertMessage(
  env: TestEnv,
  message: Omit<MessageData, 'msgId'> & { msgId?: string }
): number {
  return env.queue.insert({
    from_agent: message.from,
    to_agent: message.to,
    type: message.type,
    payload: {
      'msg-id': message.msgId || `msg-${Date.now()}`,
      headline: message.headline || '',
      body: message.body,
      ...(message.rearmatter || {}),
    },
  });
}

// ============================================
// Wait Utilities
// ============================================

/**
 * Wait for a message matching criteria to appear in the queue
 */
export async function waitForMessage(
  env: TestEnv,
  criteria: MessageCriteria,
  options: WaitOptions = {}
): Promise<Message> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check queue for matching messages
    const messages = env.queue.queryMessages({
      type: criteria.type,
      from_agent: criteria.from,
      to_agent: criteria.to,
      status: criteria.status,
    });

    for (const msg of messages) {
      let matches = true;

      if (criteria.bodyPattern) {
        const body = String(msg.payload?.body || '');
        if (!criteria.bodyPattern.test(body)) {
          matches = false;
        }
      }

      if (criteria.headlinePattern) {
        const headline = String(msg.payload?.headline || '');
        if (!criteria.headlinePattern.test(headline)) {
          matches = false;
        }
      }

      if (matches) {
        return msg;
      }
    }

    await sleep(interval);
  }

  throw new Error(
    `Timeout waiting for message matching criteria: ${JSON.stringify(criteria)}`
  );
}

/**
 * Wait for a message file matching criteria to appear in the msgs directory
 */
export async function waitForMessageFile(
  env: TestEnv,
  criteria: MessageCriteria,
  options: WaitOptions = {}
): Promise<{ filepath: string; content: string; parsed: ParsedMessage }> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const files = fs.readdirSync(env.msgsDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filepath = path.join(env.msgsDir, file);
      const content = fs.readFileSync(filepath, 'utf-8');
      const parsed = parseMessage(content);

      let matches = true;

      if (criteria.type && parsed.type !== criteria.type) matches = false;
      if (criteria.to && parsed.to !== criteria.to) matches = false;
      if (criteria.from && parsed.from !== criteria.from) matches = false;
      if (criteria.status && parsed.status !== criteria.status) matches = false;

      if (criteria.bodyPattern && !criteria.bodyPattern.test(parsed.body)) {
        matches = false;
      }

      if (criteria.headlinePattern && !criteria.headlinePattern.test(parsed.headline || '')) {
        matches = false;
      }

      if (matches) {
        return { filepath, content, parsed };
      }
    }

    await sleep(interval);
  }

  throw new Error(
    `Timeout waiting for message file matching criteria: ${JSON.stringify(criteria)}`
  );
}

/**
 * Wait for a worker to complete processing
 */
export async function waitForComplete(
  env: TestEnv,
  agentId: string,
  options: WaitOptions = {}
): Promise<WorkerResult> {
  const timeout = options.timeout ?? TIMEOUTS.workerComplete;

  try {
    const msg = await waitForMessage(
      env,
      { type: 'task-complete', from: agentId },
      { timeout }
    );

    return {
      success: true,
      output: String(msg.payload?.body || ''),
      sessionId: env.queue.getConversationId(agentId) || undefined,
      messagesProcessed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: WaitOptions = {}
): Promise<void> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await condition();
    if (result) return;
    await sleep(interval);
  }

  throw new Error('Timeout waiting for condition');
}

/**
 * Wait for a specific number of messages to appear
 */
export async function waitForMessageCount(
  env: TestEnv,
  criteria: MessageCriteria,
  count: number,
  options: WaitOptions = {}
): Promise<Message[]> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = env.queue.queryMessages({
      type: criteria.type,
      from_agent: criteria.from,
      to_agent: criteria.to,
      status: criteria.status,
    });

    const matching = messages.filter(msg => {
      if (criteria.bodyPattern) {
        const body = String(msg.payload?.body || '');
        if (!criteria.bodyPattern.test(body)) return false;
      }
      if (criteria.headlinePattern) {
        const headline = String(msg.payload?.headline || '');
        if (!criteria.headlinePattern.test(headline)) return false;
      }
      return true;
    });

    if (matching.length >= count) {
      return matching.slice(0, count);
    }

    await sleep(interval);
  }

  throw new Error(
    `Timeout waiting for ${count} messages matching criteria: ${JSON.stringify(criteria)}`
  );
}

// ============================================
// Message Parsing Utilities
// ============================================

export interface ParsedMessage {
  to: string;
  from: string;
  type: string;
  status?: string;
  msgId?: string;
  headline?: string;
  command?: string;
  timestamp?: string;
  body: string;
  rearmatter?: Record<string, unknown>;
}

/**
 * Parse a message file content into structured data
 */
export function parseMessage(content: string): ParsedMessage {
  const lines = content.split('\n');
  const result: ParsedMessage = {
    to: '',
    from: '',
    type: '',
    body: '',
  };

  let inFrontmatter = false;
  let inRearmatter = false;
  let frontmatterEnded = false;
  const bodyLines: string[] = [];
  const rearmatterLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === '---' && !inFrontmatter && !frontmatterEnded) {
      inFrontmatter = true;
      continue;
    }

    if (line === '---' && inFrontmatter) {
      inFrontmatter = false;
      frontmatterEnded = true;
      continue;
    }

    if (line === '---' && frontmatterEnded && !inRearmatter) {
      inRearmatter = true;
      continue;
    }

    if (inFrontmatter) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();

        switch (key) {
          case 'to': result.to = value; break;
          case 'from': result.from = value; break;
          case 'type': result.type = value; break;
          case 'status': result.status = value; break;
          case 'msg-id': result.msgId = value; break;
          case 'headline': result.headline = value; break;
          case 'command': result.command = value; break;
          case 'timestamp': result.timestamp = value; break;
        }
      }
    } else if (inRearmatter) {
      rearmatterLines.push(line);
    } else if (frontmatterEnded) {
      bodyLines.push(line);
    }
  }

  result.body = bodyLines.join('\n').trim();

  // Parse rearmatter
  if (rearmatterLines.length > 0) {
    result.rearmatter = {};
    for (const line of rearmatterLines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        result.rearmatter[key] = value;
      }
    }
  }

  return result;
}

// ============================================
// System Message Utilities
// ============================================

/**
 * Wait for a system message (quality feedback, FSM notifications, etc.)
 */
export async function waitForSystemMessage(
  env: TestEnv,
  criteria: { type?: string; iteration?: number },
  options: WaitOptions = {}
): Promise<{ filepath: string; content: string; parsed: ParsedMessage } | null> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const files = fs.readdirSync(env.sysMsgsDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filepath = path.join(env.sysMsgsDir, file);
      const content = fs.readFileSync(filepath, 'utf-8');
      const parsed = parseMessage(content);

      let matches = true;

      if (criteria.type && parsed.type !== criteria.type) matches = false;
      if (criteria.iteration !== undefined) {
        const bodyIteration = parsed.body.match(/iteration:\s*(\d+)/i);
        if (!bodyIteration || parseInt(bodyIteration[1]) !== criteria.iteration) {
          matches = false;
        }
      }

      if (matches) {
        return { filepath, content, parsed };
      }
    }

    await sleep(interval);
  }

  return null;  // Return null instead of throwing for optional system messages
}

// ============================================
// FSM Utilities
// ============================================

/**
 * Get FSM state from the database
 */
export function getFSMState(env: TestEnv, meshId: string): {
  currentState: string;
  context: Record<string, unknown>;
} | null {
  const db = env.queue.getDb();

  try {
    const row = db.prepare(`
      SELECT current_state, context FROM fsm_states WHERE mesh_id = ?
    `).get(meshId) as { current_state: string; context: string } | undefined;

    if (!row) return null;

    return {
      currentState: row.current_state,
      context: JSON.parse(row.context),
    };
  } catch {
    return null;
  }
}

/**
 * Wait for FSM to reach a specific state
 */
export async function waitForFSMState(
  env: TestEnv,
  meshId: string,
  targetState: string,
  options: WaitOptions = {}
): Promise<{ currentState: string; context: Record<string, unknown> }> {
  const timeout = options.timeout ?? TIMEOUTS.fsmTransition;
  const interval = options.interval ?? DEFAULT_POLL_INTERVAL;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const state = getFSMState(env, meshId);
    if (state?.currentState === targetState) {
      return state;
    }
    await sleep(interval);
  }

  throw new Error(`Timeout waiting for FSM state "${targetState}" for mesh "${meshId}"`);
}

// ============================================
// Session Utilities
// ============================================

/**
 * Get suspended session info for an agent
 */
export function getSuspendedSession(
  env: TestEnv,
  agentId: string
): { sessionId: string; reason: string } | null {
  // Check for suspended session markers in data directory
  const suspendedFile = path.join(env.dataDir, `suspended-${agentId.replace('/', '-')}.json`);

  if (fs.existsSync(suspendedFile)) {
    try {
      return JSON.parse(fs.readFileSync(suspendedFile, 'utf-8'));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Get conversation ID for an agent
 */
export function getConversationId(env: TestEnv, agentId: string): string | null {
  return env.queue.getConversationId(agentId);
}

// ============================================
// Cost Tracking Utilities
// ============================================

export interface CostTracker {
  inputTokens: number;
  outputTokens: number;
  totalDollars: number;
  startTime: number;
}

export function createCostTracker(): CostTracker {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalDollars: 0,
    startTime: Date.now(),
  };
}

export function updateCostTracker(
  tracker: CostTracker,
  inputTokens: number,
  outputTokens: number
): void {
  tracker.inputTokens += inputTokens;
  tracker.outputTokens += outputTokens;

  // Haiku pricing (as of 2024): $0.25/1M input, $1.25/1M output
  const inputCost = (inputTokens / 1_000_000) * 0.25;
  const outputCost = (outputTokens / 1_000_000) * 1.25;
  tracker.totalDollars += inputCost + outputCost;
}

export function logCost(tracker: CostTracker, testName: string): void {
  const duration = Date.now() - tracker.startTime;
  console.log(`[Cost] ${testName}: $${tracker.totalDollars.toFixed(4)} (${tracker.inputTokens} in, ${tracker.outputTokens} out) - ${duration}ms`);
}

export function assertCostLimit(tracker: CostTracker, limit: number = MAX_COST_PER_TEST): void {
  if (tracker.totalDollars > limit) {
    throw new Error(
      `Test exceeded cost limit: $${tracker.totalDollars.toFixed(4)} > $${limit.toFixed(4)}`
    );
  }
}

// ============================================
// Assertion Utilities
// ============================================

/**
 * Flexible regex assertion for LLM output
 */
export function assertMatches(
  actual: string,
  pattern: RegExp,
  message?: string
): void {
  if (!pattern.test(actual)) {
    throw new Error(
      message || `Expected output to match ${pattern}, got: "${actual.slice(0, 200)}..."`
    );
  }
}

/**
 * Semantic assertion - check if output contains any of the expected terms
 */
export function assertContainsAny(
  actual: string,
  terms: string[],
  message?: string
): void {
  const lowerActual = actual.toLowerCase();
  const found = terms.some(term => lowerActual.includes(term.toLowerCase()));

  if (!found) {
    throw new Error(
      message || `Expected output to contain one of [${terms.join(', ')}], got: "${actual.slice(0, 200)}..."`
    );
  }
}

/**
 * Assert that a message file was created
 */
export function assertMessageFileExists(
  env: TestEnv,
  pattern: RegExp
): string {
  const files = fs.readdirSync(env.msgsDir);
  const matching = files.find(f => pattern.test(f));

  if (!matching) {
    throw new Error(
      `Expected message file matching ${pattern}, found: [${files.join(', ')}]`
    );
  }

  return path.join(env.msgsDir, matching);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a unique test ID
 */
export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * List all message files in the test environment
 */
export function listMessageFiles(env: TestEnv): string[] {
  return fs.readdirSync(env.msgsDir).filter(f => f.endsWith('.md'));
}

/**
 * Count messages in queue by type
 */
export function countMessagesByType(env: TestEnv): Record<string, number> {
  const stats = env.queue.getStats();
  return stats.byAgent;
}

/**
 * Clear all messages and sessions for a fresh start
 */
export function resetTestEnv(env: TestEnv): void {
  env.queue.clearAllMessages();
  env.queue.clearAllSessions();
  env.queue.clearAllPendingAsks();

  // Clear message files
  const files = fs.readdirSync(env.msgsDir);
  for (const file of files) {
    fs.unlinkSync(path.join(env.msgsDir, file));
  }
}

// ============================================
// Re-exports from test-env helper
// ============================================

export { createTestEnv } from '../helpers/test-env.ts';

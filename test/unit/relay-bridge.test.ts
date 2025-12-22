/**
 * Unit Tests for ProtagentBridge
 */

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProtagentBridge, type RelayBridgeConfig } from '../../src/core/relay-bridge.ts';

// Test constants
const TEST_PUBKEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef';
const TEST_PRIVATE_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

describe('ProtagentBridge', () => {
  let tmpDir: string;
  let msgsDir: string;
  let archDir: string;

  beforeEach(() => {
    // Create temporary directories for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-bridge-test-'));
    msgsDir = path.join(tmpDir, 'msgs');
    archDir = path.join(msgsDir, 'arch');
    fs.mkdirSync(archDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup temp directories
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Configuration', () => {
    it('should accept valid configuration', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      assert.strictEqual(bridge.getState(), 'disconnected');
      assert.strictEqual(bridge.getSessionId(), null);
    });
  });

  describe('Agent Path Translation', () => {
    it('should validate local path format', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);

      // Access private method via prototype for testing
      const isValidLocalPath = (bridge as any).isValidLocalPath.bind(bridge);

      // Valid paths
      assert.strictEqual(isValidLocalPath('meet/scheduler'), true);
      assert.strictEqual(isValidLocalPath('dev/worker'), true);
      assert.strictEqual(isValidLocalPath('test-mesh/test-agent'), true);

      // Invalid paths
      assert.strictEqual(isValidLocalPath(''), false);
      assert.strictEqual(isValidLocalPath('noagent'), false);
      assert.strictEqual(isValidLocalPath('mesh/agent/extra'), false);
      assert.strictEqual(isValidLocalPath('MESH/Agent'), false);  // uppercase not allowed
      assert.strictEqual(isValidLocalPath('../parent/agent'), false);
    });

    it('should convert local path to wire format', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      const localToWire = (bridge as any).localToWire.bind(bridge);

      // Standard conversion
      const wirePath = localToWire('meet/scheduler');
      assert.strictEqual(wirePath, `${TEST_PUBKEY}/protagent/meet/scheduler`);

      // With arch/ prefix (should be stripped)
      const wirePath2 = localToWire('arch/meet/scheduler');
      assert.strictEqual(wirePath2, `${TEST_PUBKEY}/protagent/meet/scheduler`);

      // Invalid path returns null
      const invalidWire = localToWire('invalid');
      assert.strictEqual(invalidWire, null);
    });

    it('should convert wire format to local path', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      const wireToLocal = (bridge as any).wireToLocal.bind(bridge);

      // Standard conversion
      const remotePubkey = 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678';
      const localPath = wireToLocal(`${remotePubkey}/protagent/meet/scheduler`);
      assert.strictEqual(localPath, 'meet/scheduler');

      // Invalid format returns null
      assert.strictEqual(wireToLocal('invalid/path'), null);
      assert.strictEqual(wireToLocal('pubkey/wrong/meet/scheduler'), null);
    });
  });

  describe('Message File Operations', () => {
    it('should parse message file content', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      const parseMessageFile = (bridge as any).parseMessageFile.bind(bridge);

      const content = `---
to: meet/scheduler
from: core/core
type: task
msg-id: test-123
headline: Test message
---

This is the body of the message.

It can have multiple lines.
`;

      const parsed = parseMessageFile(content);
      assert.ok(parsed, 'Should parse valid message');
      assert.strictEqual(parsed.frontmatter.to, 'meet/scheduler');
      assert.strictEqual(parsed.frontmatter.from, 'core/core');
      assert.strictEqual(parsed.frontmatter.type, 'task');
      assert.strictEqual(parsed.frontmatter['msg-id'], 'test-123');
      assert.ok(parsed.body.includes('This is the body'));
    });

    it('should reject invalid message file content', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      const parseMessageFile = (bridge as any).parseMessageFile.bind(bridge);

      // No frontmatter
      assert.strictEqual(parseMessageFile('Just some text'), null);

      // Missing required fields
      const missingTo = `---
from: core/core
type: task
---
body`;
      assert.strictEqual(parseMessageFile(missingTo), null);
    });

    it('should build message file content', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      const buildMessageFile = (bridge as any).buildMessageFile.bind(bridge);

      const msg = {
        message_id: 'msg-123',
        timestamp: '2024-01-15T12:00:00Z',
        payload: {
          content: 'Hello from remote!',
          metadata: {
            headline: 'Test Message',
            messageType: 'message'
          }
        }
      };

      const content = buildMessageFile('dev/worker', 'meet/scheduler', msg);

      assert.ok(content.includes('to: dev/worker'));
      assert.ok(content.includes('from: meet/scheduler'));
      assert.ok(content.includes('type: message'));
      assert.ok(content.includes('msg-id: msg-123'));
      assert.ok(content.includes('headline: Test Message'));
      assert.ok(content.includes('Hello from remote!'));
    });

    it('should generate valid filenames', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      const generateFilename = (bridge as any).generateFilename.bind(bridge);

      const inboundFilename = generateFilename('meet/scheduler', 'inbound');
      assert.ok(inboundFilename.startsWith('inbound-'));
      assert.ok(inboundFilename.includes('meet-scheduler'));
      assert.ok(inboundFilename.endsWith('.md'));

      const outboundFilename = generateFilename('dev/worker', 'outbound');
      assert.ok(outboundFilename.startsWith('outbound-'));
      assert.ok(outboundFilename.includes('dev-worker'));
      assert.ok(outboundFilename.endsWith('.md'));
    });
  });

  describe('State Management', () => {
    it('should track state transitions', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);

      // Initial state
      assert.strictEqual(bridge.getState(), 'disconnected');

      // Session ID should be null initially
      assert.strictEqual(bridge.getSessionId(), null);
    });
  });

  describe('Duplicate Message Handling', () => {
    it('should track processed message IDs', () => {
      const config: RelayBridgeConfig = {
        relayUrl: 'ws://localhost:3210',
        pubkey: TEST_PUBKEY,
        privateKey: TEST_PRIVATE_KEY,
        msgsDir
      };

      const bridge = new ProtagentBridge(config);
      const processedIds = (bridge as any).processedMessageIds;

      // Initially empty
      assert.strictEqual(processedIds.size, 0);

      // Add some IDs
      processedIds.add('msg-1');
      processedIds.add('msg-2');
      assert.strictEqual(processedIds.size, 2);

      // Check duplicate detection
      assert.strictEqual(processedIds.has('msg-1'), true);
      assert.strictEqual(processedIds.has('msg-3'), false);
    });
  });
});

describe('ProtagentBridge Integration', () => {
  // These tests would require a mock WebSocket server
  // Skipping for now as they require more complex setup

  it.skip('should connect to relay server and complete handshake', async () => {
    // Would require mock WebSocket server
  });

  it.skip('should watch arch directory for outbound messages', async () => {
    // Would require mock WebSocket server and file watcher timing
  });

  it.skip('should write inbound messages to msgs directory', async () => {
    // Would require mock WebSocket server
  });
});

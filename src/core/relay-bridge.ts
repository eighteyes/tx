/**
 * Protagent Relay Bridge
 *
 * WebSocket bridge for connecting TX to the Protagent relay network.
 * Handles bidirectional message routing between local TX agents and remote agents.
 *
 * MVP Implementation Notes:
 * - Skips sanitizer (trusts relay completely - NOT production safe)
 * - Basic reconnection only (no exponential backoff yet)
 * - In-memory session tracking (no persistence yet)
 */

import WebSocket from 'ws';
import { watch, type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { log } from '../shared/logger.ts';

// ============================================================================
// Types
// ============================================================================

export interface RelayBridgeConfig {
  relayUrl: string;
  pubkey: string;
  privateKey: Buffer;
  msgsDir: string;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'error'
  | 'shutdown';

interface RelayMessage {
  type: string;
  session_id?: string;
  to?: string;
  from?: string;
  message_id?: string;
  timestamp?: string;
  payload?: {
    content?: string;
    metadata?: Record<string, unknown>;
  };
  // Handshake fields
  pubkey?: string;
  client?: string;
  version?: string;
  accepted?: boolean;
  relay_version?: string;
  // Error fields
  code?: string;
  message?: string;
}

// ============================================================================
// ProtagentBridge Class
// ============================================================================

export class ProtagentBridge {
  private ws: WebSocket | null = null;
  private config: RelayBridgeConfig;
  private sessionId: string | null = null;
  private state: ConnectionState = 'disconnected';
  private archWatcher: FSWatcher | null = null;
  private processedMessageIds = new Set<string>();

  constructor(config: RelayBridgeConfig) {
    this.config = config;
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (this.state !== 'disconnected') {
      log.warn('relay-bridge', 'Bridge already started', { state: this.state });
      return;
    }

    log.info('relay-bridge', 'Starting bridge', { url: this.config.relayUrl });

    try {
      await this.connect();
      this.watchArchMessages();
    } catch (err) {
      this.state = 'error';
      log.error('relay-bridge', 'Failed to start bridge', { error: (err as Error).message });
      throw err;
    }
  }

  async stop(): Promise<void> {
    log.info('relay-bridge', 'Stopping bridge');
    this.state = 'shutdown';

    // Stop file watcher
    if (this.archWatcher) {
      await this.archWatcher.close();
      this.archWatcher = null;
    }

    // Close WebSocket
    if (this.ws) {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          log.warn('relay-bridge', 'Shutdown timeout, forcing close');
          this.ws?.terminate();
          this.ws = null;
          resolve();
        }, 5000);

        this.ws!.once('close', () => {
          clearTimeout(timeout);
          this.ws = null;
          resolve();
        });

        this.ws!.close();
      });
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.state = 'connecting';

      try {
        this.ws = new WebSocket(this.config.relayUrl);
      } catch (err) {
        this.state = 'error';
        reject(err);
        return;
      }

      const connectTimeout = setTimeout(() => {
        this.ws?.terminate();
        this.state = 'error';
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.on('open', () => {
        log.info('relay-bridge', 'WebSocket connected');
        this.state = 'handshaking';
        this.sendHandshake();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);

        // Resolve once we're connected (after handshake)
        if (this.state === 'connected') {
          clearTimeout(connectTimeout);
          resolve();
        }
      });

      this.ws.on('error', (err: Error) => {
        log.error('relay-bridge', 'WebSocket error', { error: err.message });
        if (this.state === 'connecting' || this.state === 'handshaking') {
          clearTimeout(connectTimeout);
          this.state = 'error';
          reject(err);
        }
      });

      this.ws.on('close', () => {
        log.info('relay-bridge', 'WebSocket closed');
        if (this.state !== 'shutdown') {
          this.state = 'disconnected';
          // MVP: No auto-reconnect for now
        }
      });
    });
  }

  private sendHandshake(): void {
    const handshake: RelayMessage = {
      type: 'handshake',
      pubkey: this.config.pubkey,
      client: 'tx-cli-v4',
      version: '1.0.0'
    };

    log.debug('relay-bridge', 'Sending handshake', { pubkey: this.config.pubkey.slice(0, 16) + '...' });
    this.send(handshake);
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  private handleMessage(data: Buffer): void {
    let msg: RelayMessage;

    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      log.error('relay-bridge', 'Failed to parse message', { error: (err as Error).message });
      return;
    }

    log.debug('relay-bridge', 'Received message', { type: msg.type });

    switch (msg.type) {
      case 'handshake_ack':
        this.handleHandshakeAck(msg);
        break;

      case 'message':
        this.handleInboundMessage(msg);
        break;

      case 'ping':
        this.send({ type: 'pong', timestamp: new Date().toISOString() });
        break;

      case 'error':
        log.error('relay-bridge', 'Relay error', {
          code: msg.code,
          message: msg.message,
          messageId: msg.message_id
        });
        break;

      default:
        log.warn('relay-bridge', 'Unknown message type', { type: msg.type });
    }
  }

  private handleHandshakeAck(msg: RelayMessage): void {
    if (msg.accepted) {
      this.sessionId = msg.session_id || null;
      this.state = 'connected';
      log.info('relay-bridge', 'Handshake accepted', {
        sessionId: this.sessionId?.slice(0, 8) + '...',
        relayVersion: msg.relay_version
      });
    } else {
      this.state = 'error';
      log.error('relay-bridge', 'Handshake rejected');
    }
  }

  private handleInboundMessage(msg: RelayMessage): void {
    if (!msg.to || !msg.from || !msg.message_id) {
      log.warn('relay-bridge', 'Invalid inbound message: missing fields');
      return;
    }

    // Skip if already processed
    if (this.processedMessageIds.has(msg.message_id)) {
      log.debug('relay-bridge', 'Skipping duplicate message', { messageId: msg.message_id.slice(0, 8) });
      return;
    }
    this.processedMessageIds.add(msg.message_id);

    // Limit processed IDs to prevent memory leak
    if (this.processedMessageIds.size > 10000) {
      const ids = Array.from(this.processedMessageIds);
      ids.slice(0, 5000).forEach(id => this.processedMessageIds.delete(id));
    }

    // Transform wire format → TX format
    const toPath = this.wireToLocal(msg.to);
    const fromPath = this.wireToLocal(msg.from);

    if (!toPath || !fromPath) {
      log.warn('relay-bridge', 'Invalid agent paths in message', { to: msg.to, from: msg.from });
      return;
    }

    // Write message to msgs directory
    const content = this.buildMessageFile(toPath, fromPath, msg);
    const filename = this.generateFilename(fromPath, 'inbound');
    const filepath = path.join(this.config.msgsDir, filename);

    try {
      fs.writeFileSync(filepath, content);
      log.info('relay-bridge', 'Wrote inbound message', {
        from: fromPath,
        to: toPath,
        messageId: msg.message_id.slice(0, 8),
        file: filename
      });
    } catch (err) {
      log.error('relay-bridge', 'Failed to write inbound message', { error: (err as Error).message });
    }
  }

  // ============================================================================
  // Outbound Message Handling
  // ============================================================================

  private watchArchMessages(): void {
    // Watch for messages in arch/* subdirectory
    const archDir = path.join(this.config.msgsDir, 'arch');

    // Create arch directory if it doesn't exist
    if (!fs.existsSync(archDir)) {
      fs.mkdirSync(archDir, { recursive: true });
    }

    this.archWatcher = watch(archDir, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    });

    this.archWatcher.on('add', (filepath: string) => {
      if (filepath.endsWith('.md')) {
        this.processOutboundFile(filepath);
      }
    });

    this.archWatcher.on('ready', () => {
      log.info('relay-bridge', 'Watching for outbound messages', { dir: archDir });
    });
  }

  private processOutboundFile(filepath: string): void {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const parsed = this.parseMessageFile(content);

      if (!parsed) {
        log.debug('relay-bridge', 'Skipped non-message file', { file: path.basename(filepath) });
        return;
      }

      const { frontmatter, body } = parsed;

      // Transform local → wire format
      const toWire = this.localToWire(frontmatter.to);
      const fromWire = this.localToWire(frontmatter.from);

      if (!toWire || !fromWire) {
        log.warn('relay-bridge', 'Invalid paths for outbound message', {
          to: frontmatter.to,
          from: frontmatter.from
        });
        return;
      }

      // Build wire message
      const msg: RelayMessage = {
        type: 'message',
        session_id: this.sessionId || undefined,
        to: toWire,
        from: fromWire,
        message_id: frontmatter['msg-id'] || randomUUID(),
        timestamp: frontmatter.timestamp || new Date().toISOString(),
        payload: {
          content: body,
          metadata: {
            headline: frontmatter.headline,
            messageType: frontmatter.type
          }
        }
      };

      this.send(msg);
      log.info('relay-bridge', 'Sent outbound message', {
        to: frontmatter.to,
        from: frontmatter.from,
        messageId: msg.message_id?.slice(0, 8),
        file: path.basename(filepath)
      });
    } catch (err) {
      log.error('relay-bridge', 'Failed to process outbound file', {
        file: path.basename(filepath),
        error: (err as Error).message
      });
    }
  }

  // ============================================================================
  // Agent Path Translation
  // ============================================================================

  /**
   * Convert local TX path to wire format
   * meet/scheduler → {pubkey}/protagent/meet/scheduler
   */
  private localToWire(localPath: string): string | null {
    // Handle arch/* prefix (strip it)
    const cleanPath = localPath.replace(/^arch\//, '');

    // Validate path format
    if (!this.isValidLocalPath(cleanPath)) {
      return null;
    }

    return `${this.config.pubkey}/protagent/${cleanPath}`;
  }

  /**
   * Convert wire format to local TX path
   * {pubkey}/protagent/meet/scheduler → meet/scheduler
   */
  private wireToLocal(wirePath: string): string | null {
    // Extract path after /protagent/
    const match = wirePath.match(/^[a-f0-9]+\/protagent\/(.+)$/);
    if (!match) {
      return null;
    }

    const localPath = match[1];

    // Validate path format
    if (!this.isValidLocalPath(localPath)) {
      return null;
    }

    return localPath;
  }

  /**
   * Validate local agent path format
   */
  private isValidLocalPath(path: string): boolean {
    // Format: mesh/agent (e.g., meet/scheduler)
    return /^[a-z0-9-]+\/[a-z0-9-]+$/.test(path);
  }

  // ============================================================================
  // Message File Operations
  // ============================================================================

  private parseMessageFile(content: string): { frontmatter: Record<string, string>; body: string } | null {
    const parts = content.split(/^---$/m);
    if (parts.length < 3) return null;

    const frontmatter: Record<string, string> = {};
    for (const line of parts[1].trim().split('\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        frontmatter[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    }

    if (!frontmatter.to || !frontmatter.from) return null;

    const body = parts.slice(2).join('---').trim();
    return { frontmatter, body };
  }

  private buildMessageFile(to: string, from: string, msg: RelayMessage): string {
    const timestamp = msg.timestamp || new Date().toISOString();
    const headline = msg.payload?.metadata?.headline || 'External message';
    const msgType = msg.payload?.metadata?.messageType || 'message';
    const content = msg.payload?.content || '';

    return `---
to: ${to}
from: ${from}
type: ${msgType}
msg-id: ${msg.message_id}
headline: ${headline}
timestamp: ${timestamp}
---

${content}
`;
  }

  private generateFilename(from: string, direction: 'inbound' | 'outbound'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const sanitizedFrom = from.replace(/\//g, '-');
    return `${direction}-${sanitizedFrom}-${timestamp}-${random}.md`;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private send(msg: RelayMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('relay-bridge', 'Cannot send: WebSocket not connected');
      return;
    }

    this.ws.send(JSON.stringify(msg));
  }
}

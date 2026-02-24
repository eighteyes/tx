/**
 * CoreWebSocketHandler - WebSocket handler for persistent core agent
 *
 * Provides bidirectional streaming between browser and the persistent core.
 * Unlike the session-based WebSocket, this connects to a single persistent core.
 *
 * Responsibilities:
 * - Handle WebSocket connections for /v1/core/stream
 * - Create or resume PersistentCore instance
 * - Stream core output to all connected clients
 * - Accept input from clients and forward to core
 * - Handle HITL (ask-human) patterns
 */

import { WebSocket, WebSocketServer, type ServerOptions } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { PersistentCore, type WebOutputMessage, type WebInputMessage, type PersistentCoreConfig } from './persistent-core.ts';
import { log } from '../shared/logger.ts';

/**
 * Message from client to server
 */
export interface ClientMessage {
  type: 'user' | 'hitl-response' | 'ping';
  content?: string;
  refMsgId?: string;  // For HITL responses
}

/**
 * Message from server to client
 */
export interface ServerMessage {
  type: 'output' | 'ask-human' | 'status' | 'error' | 'pong' | 'connected';
  data?: WebOutputMessage;
  question?: string;
  msgId?: string;
  status?: 'thinking' | 'using-tool' | 'idle' | 'waiting-for-human';
  sessionId?: string | null;
  error?: string;
  timestamp: number;
}

/**
 * Configuration for CoreWebSocketHandler
 */
export interface CoreWebSocketConfig {
  coreConfig: PersistentCoreConfig;
  heartbeatIntervalMs?: number;
  maxClients?: number;
}

/**
 * CoreWebSocketHandler - Manages WebSocket connections to persistent core
 */
export class CoreWebSocketHandler {
  private config: CoreWebSocketConfig;
  private wss: WebSocketServer | null = null;
  private core: PersistentCore | null = null;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: CoreWebSocketConfig) {
    this.config = {
      heartbeatIntervalMs: 30000,
      maxClients: 10,
      ...config,
    };
  }

  /**
   * Attach to an existing HTTP server
   */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.wss.on('error', (err) => {
      log.error('core-websocket', 'WebSocket server error', { error: err.message });
    });

    // Handle upgrades only for /v1/core/stream
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;
      if (pathname === '/v1/core/stream') {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      }
      // Don't touch socket for other paths — let other handlers process them
    });

    // Start heartbeat
    this.startHeartbeat();

    log.info('core-websocket', 'WebSocket handler attached', {
      path: '/v1/core/stream',
      maxClients: this.config.maxClients,
    });
  }

  /**
   * Create standalone WebSocket server
   */
  listen(port: number, host: string = '0.0.0.0'): void {
    this.wss = new WebSocketServer({ port, host, path: '/v1/core/stream' });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.wss.on('error', (err) => {
      log.error('core-websocket', 'WebSocket server error', { error: err.message });
    });

    // Start heartbeat
    this.startHeartbeat();

    log.info('core-websocket', `WebSocket server listening on ws://${host}:${port}/v1/core/stream`);
  }

  /**
   * Handle a new WebSocket connection
   */
  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    // Check max clients
    if (this.clients.size >= (this.config.maxClients || 10)) {
      log.warn('core-websocket', 'Max clients reached, rejecting connection');
      ws.close(4503, 'Server at capacity');
      return;
    }

    log.info('core-websocket', 'Client connected', {
      remoteAddr: req.socket.remoteAddress,
      clientCount: this.clients.size + 1,
    });

    this.clients.add(ws);

    // Initialize or get core
    await this.ensureCore();

    // Send connected message
    this.sendToClient(ws, {
      type: 'connected',
      sessionId: this.core?.getSessionId(),
      status: this.core?.isRunning() ? 'idle' : undefined,
      timestamp: Date.now(),
    });

    // Handle messages from client
    ws.on('message', (data) => this.handleClientMessage(ws, data));

    ws.on('close', () => {
      log.info('core-websocket', 'Client disconnected', {
        clientCount: this.clients.size - 1,
      });
      this.clients.delete(ws);
    });

    ws.on('error', (err) => {
      log.error('core-websocket', 'Client WebSocket error', {
        error: err.message,
      });
    });

    // Set up ping/pong
    (ws as any).isAlive = true;
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });
  }

  /**
   * Ensure the PersistentCore is running
   */
  private async ensureCore(): Promise<void> {
    if (this.core && this.core.isRunning()) {
      return;
    }

    this.core = new PersistentCore(this.config.coreConfig);

    // Wire up events
    this.core.on('output', (msg: WebOutputMessage) => {
      this.broadcast({
        type: 'output',
        data: msg,
        timestamp: Date.now(),
      });
    });

    this.core.on('ask-human', ({ msgId, question }) => {
      this.broadcast({
        type: 'ask-human',
        msgId,
        question,
        status: 'waiting-for-human',
        timestamp: Date.now(),
      });
    });

    this.core.on('status', (status) => {
      this.broadcast({
        type: 'status',
        status,
        timestamp: Date.now(),
      });
    });

    this.core.on('error', ({ message }) => {
      this.broadcast({
        type: 'error',
        error: message,
        timestamp: Date.now(),
      });
    });

    this.core.on('complete', ({ sessionId }) => {
      this.broadcast({
        type: 'status',
        status: 'idle',
        sessionId,
        timestamp: Date.now(),
      });
    });

    await this.core.start();

    log.info('core-websocket', 'PersistentCore started', {
      sessionId: this.core.getSessionId(),
    });
  }

  /**
   * Handle a message from a client
   */
  private async handleClientMessage(ws: WebSocket, data: any): Promise<void> {
    try {
      const msg: ClientMessage = JSON.parse(data.toString());

      switch (msg.type) {
        case 'ping':
          this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
          break;

        case 'user':
          if (!msg.content) {
            this.sendToClient(ws, {
              type: 'error',
              error: 'content is required',
              timestamp: Date.now(),
            });
            return;
          }
          await this.core?.sendInput({
            type: 'user',
            content: msg.content,
          });
          break;

        case 'hitl-response':
          if (!msg.content || !msg.refMsgId) {
            this.sendToClient(ws, {
              type: 'error',
              error: 'content and refMsgId are required for HITL response',
              timestamp: Date.now(),
            });
            return;
          }
          await this.core?.sendInput({
            type: 'hitl-response',
            content: msg.content,
            refMsgId: msg.refMsgId,
          });
          break;

        default:
          log.warn('core-websocket', 'Unknown message type', { type: msg.type });
      }
    } catch (err) {
      log.error('core-websocket', 'Failed to handle client message', {
        error: (err as Error).message,
      });
      this.sendToClient(ws, {
        type: 'error',
        error: 'Failed to process message',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Start heartbeat to detect dead connections
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.clients) {
        if ((ws as any).isAlive === false) {
          log.debug('core-websocket', 'Terminating dead connection');
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }

        (ws as any).isAlive = false;
        ws.ping();
      }
    }, this.config.heartbeatIntervalMs || 30000);
  }

  /**
   * Get current stats
   */
  getStats(): { clients: number; coreRunning: boolean; sessionId: string | null } {
    return {
      clients: this.clients.size,
      coreRunning: this.core?.isRunning() || false,
      sessionId: this.core?.getSessionId() || null,
    };
  }

  /**
   * Shutdown the WebSocket handler
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Stop core
    if (this.core) {
      await this.core.stop();
      this.core = null;
    }

    // Close all clients
    for (const client of this.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    log.info('core-websocket', 'Shutdown complete');
  }
}

/**
 * Factory function to create CoreWebSocketHandler
 */
export function createCoreWebSocketHandler(
  httpServer: HttpServer,
  config: PersistentCoreConfig
): CoreWebSocketHandler {
  const handler = new CoreWebSocketHandler({
    coreConfig: config,
  });

  handler.attach(httpServer);

  return handler;
}

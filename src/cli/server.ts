/**
 * tx-server - HTTP/WebSocket server for multi-tenant mesh runtime
 *
 * Responsibilities:
 * - Expose REST API for session management
 * - Provide WebSocket endpoint for real-time message streaming
 * - Route messages to mesh entry agents
 * - Manage storage provider lifecycle
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
import { log } from '../shared/logger.ts';
import {
  createStorageProviderFromEnv,
  type StorageProvider,
  type SessionState,
  type AgentMessage,
} from '../storage/index.ts';

interface ServerOptions {
  port?: number;
  host?: string;
  mesh?: string;
}

interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

type RouteHandler = (ctx: RequestContext, storage: StorageProvider) => Promise<unknown>;

/**
 * Parse route pattern and extract params
 * e.g., '/sessions/:id' matches '/sessions/abc123' → { id: 'abc123' }
 */
function matchRoute(
  pattern: string,
  path: string
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const pathPart = pathParts[i];

    if (pp.startsWith(':')) {
      params[pp.slice(1)] = pathPart;
    } else if (pp !== pathPart) {
      return null;
    }
  }

  return params;
}

/**
 * Route definitions
 */
const routes: Array<{ method: string; pattern: string; handler: RouteHandler }> = [
  // Session management
  {
    method: 'POST',
    pattern: '/v1/sessions',
    handler: async (ctx, storage) => {
      const { meshId, tenantId } = ctx.body as { meshId: string; tenantId?: string };
      if (!meshId) {
        throw { status: 400, message: 'meshId is required' };
      }
      const session = await storage.createSession(meshId, tenantId);
      return session;
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions/:id',
    handler: async (ctx, storage) => {
      const session = await storage.getSession(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      return session;
    },
  },
  {
    method: 'DELETE',
    pattern: '/v1/sessions/:id',
    handler: async (ctx, storage) => {
      await storage.destroySession(ctx.params.id);
      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/hibernate',
    handler: async (ctx, storage) => {
      await storage.hibernateSession(ctx.params.id);
      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/resume',
    handler: async (ctx, storage) => {
      const session = await storage.resumeSession(ctx.params.id);
      return session;
    },
  },

  // Message operations
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/messages',
    handler: async (ctx, storage) => {
      const session = await storage.getSession(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }

      const { to, body, type, headline } = ctx.body as {
        to?: string;
        body: string;
        type?: string;
        headline?: string;
      };

      if (!body) {
        throw { status: 400, message: 'body is required' };
      }

      // Default to mesh entry point if 'to' not specified
      const targetAgent = to || `${session.meshId}/worker`;

      const message: AgentMessage = {
        from: 'api/client',
        to: targetAgent,
        type: type || 'task',
        body,
        headline,
        timestamp: Date.now(),
      };

      const msgId = await storage.writeMessage(ctx.params.id, message);
      await storage.queueInsert(ctx.params.id, message);

      return { msgId, message };
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions/:id/messages',
    handler: async (ctx, storage) => {
      const session = await storage.getSession(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }

      const limit = parseInt(ctx.query.get('limit') || '50', 10);
      const since = ctx.query.get('since') || undefined;
      const type = ctx.query.get('type') || undefined;

      const messages = await storage.listMessages(ctx.params.id, {
        limit,
        sinceId: since,
        type,
      });

      return { messages };
    },
  },

  // Health check
  {
    method: 'GET',
    pattern: '/health',
    handler: async () => {
      return { status: 'ok', timestamp: Date.now() };
    },
  },
];

/**
 * Parse JSON body from request
 */
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Handle HTTP request
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  storage: StorageProvider
): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const method = req.method || 'GET';
  const path = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Find matching route
  for (const route of routes) {
    if (route.method !== method) continue;

    const params = matchRoute(route.pattern, path);
    if (params === null) continue;

    try {
      const body = await parseBody(req);
      const ctx: RequestContext = {
        method,
        path,
        params,
        query: url.searchParams,
        body,
      };

      const result = await route.handler(ctx, storage);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    } catch (err) {
      const status = (err as { status?: number }).status || 500;
      const message = (err as { message?: string }).message || 'Internal server error';

      log.error('server', 'Request error', { method, path, status, message });

      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
      return;
    }
  }

  // No route matched
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

/**
 * Handle WebSocket connection for real-time streaming
 */
async function handleWebSocket(
  ws: WebSocket,
  sessionId: string,
  storage: StorageProvider
): Promise<void> {
  const session = await storage.getSession(sessionId);
  if (!session) {
    ws.close(4404, 'Session not found');
    return;
  }

  log.info('server', 'WebSocket connected', { sessionId });

  // Subscribe to messages for this session
  const subscription = storage.subscribeMessages(sessionId);

  // Forward messages to WebSocket
  (async () => {
    try {
      for await (const event of subscription) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event));
        }
      }
    } catch (err) {
      log.error('server', 'WebSocket subscription error', {
        sessionId,
        error: (err as Error).message,
      });
    }
  })();

  ws.on('message', async (data) => {
    try {
      const payload = JSON.parse(data.toString());

      // Handle incoming messages from client
      if (payload.type === 'message') {
        const message: AgentMessage = {
          from: 'api/client',
          to: payload.to || `${session.meshId}/worker`,
          type: payload.messageType || 'task',
          body: payload.body,
          headline: payload.headline,
          timestamp: Date.now(),
        };

        const msgId = await storage.writeMessage(sessionId, message);
        await storage.queueInsert(sessionId, message);

        ws.send(JSON.stringify({ type: 'ack', msgId }));
      }
    } catch (err) {
      log.error('server', 'WebSocket message error', {
        sessionId,
        error: (err as Error).message,
      });
      ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
    }
  });

  ws.on('close', () => {
    log.info('server', 'WebSocket disconnected', { sessionId });
  });
}

/**
 * Start tx-server
 */
export async function server(options: ServerOptions): Promise<void> {
  const port = options.port || parseInt(process.env.TX_SERVER_PORT || '3000', 10);
  const host = options.host || process.env.TX_SERVER_HOST || '0.0.0.0';

  // Initialize storage provider
  const storage = createStorageProviderFromEnv();
  await storage.init();

  log.info('server', 'Storage provider initialized', {
    type: process.env.TX_STORAGE_TYPE || 'local',
  });

  // Create HTTP server
  const httpServer = http.createServer((req, res) => {
    handleRequest(req, res, storage).catch((err) => {
      log.error('server', 'Unhandled request error', { error: (err as Error).message });
      res.writeHead(500);
      res.end('Internal server error');
    });
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/stream$/);

    if (!match) {
      ws.close(4400, 'Invalid WebSocket path');
      return;
    }

    const sessionId = match[1];
    handleWebSocket(ws, sessionId, storage).catch((err) => {
      log.error('server', 'WebSocket handler error', { error: (err as Error).message });
      ws.close(4500, 'Internal error');
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('server', 'Shutting down...');

    wss.close();
    httpServer.close();
    await storage.close();

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start listening
  httpServer.listen(port, host, () => {
    log.info('server', `tx-server listening on http://${host}:${port}`);
    console.log(`\n  tx-server running on http://${host}:${port}\n`);
    console.log('  Endpoints:');
    console.log('    POST   /v1/sessions           Create session');
    console.log('    GET    /v1/sessions/:id       Get session');
    console.log('    DELETE /v1/sessions/:id       Destroy session');
    console.log('    POST   /v1/sessions/:id/messages   Send message');
    console.log('    GET    /v1/sessions/:id/messages   List messages');
    console.log('    WS     /v1/sessions/:id/stream     Real-time stream\n');
    console.log('  Environment:');
    console.log(`    TX_STORAGE_TYPE: ${process.env.TX_STORAGE_TYPE || 'local'}`);
    console.log(`    TX_REDIS_URL: ${process.env.TX_REDIS_URL || '(not set)'}\n`);
  });
}

/**
 * tx-server - HTTP/WebSocket server for multi-tenant mesh runtime
 *
 * Responsibilities:
 * - Expose REST API for session management
 * - Provide WebSocket endpoint for real-time message streaming
 * - Authenticate requests and enforce quotas
 * - Manage worker pool for message processing
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'node:url';
import YAML from 'yaml';
import { log } from '../shared/logger.ts';
import {
  createStorageProviderFromEnv,
  type StorageProvider,
  type AgentMessage,
} from '../storage/index.ts';
import {
  SessionManager,
  WorkerPool,
  AuthMiddleware,
  RateLimiter,
  QuotaManager,
  rateLimitKey,
  type MeshConfig,
  type TenantInfo,
} from '../server/index.ts';
import { MeshController, MeshNotFoundError } from '../controllers/mesh-controller.ts';
import { WorkspaceController, PathNotFoundError, PathSecurityError } from '../controllers/workspace-controller.ts';
import { LogsController } from '../controllers/logs-controller.ts';
import { SessionsController } from '../controllers/sessions-controller.ts';
import { StatsController } from '../controllers/stats-controller.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerOptions {
  port?: number;
  host?: string;
  mesh?: string;
  concurrency?: number;
  authEnabled?: boolean;
  noDb?: boolean;
}

interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  tenant: TenantInfo;
}

type RouteHandler = (ctx: RequestContext, deps: ServerDeps) => Promise<unknown>;

interface ServerDeps {
  storage: StorageProvider;
  sessionManager: SessionManager;
  workerPool: WorkerPool;
  quotaManager: QuotaManager;
  rateLimiter: RateLimiter;
  meshController: MeshController;
  workspaceController: WorkspaceController;
  logsController: LogsController;
  sessionsController: SessionsController;
  statsController: StatsController;
}

/**
 * Parse route pattern and extract params
 */
function matchRoute(pattern: string, path: string): Record<string, string> | null {
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
    handler: async (ctx, deps) => {
      const { meshId, entryAgent, ttlSeconds } = ctx.body as {
        meshId: string;
        entryAgent?: string;
        ttlSeconds?: number;
      };

      if (!meshId) {
        throw { status: 400, message: 'meshId is required' };
      }

      // Check quota
      const quotaCheck = deps.quotaManager.checkQuota(ctx.tenant.tenantId, 'session');
      if (!quotaCheck.allowed) {
        throw { status: 429, message: quotaCheck.message };
      }

      const session = await deps.sessionManager.create({
        meshId,
        tenantId: ctx.tenant.tenantId,
        entryAgent,
        ttlSeconds,
      });

      deps.quotaManager.recordSessionCreated(ctx.tenant.tenantId);

      return session;
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions/:id',
    handler: async (ctx, deps) => {
      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      // Check tenant ownership
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }
      return session;
    },
  },
  {
    method: 'DELETE',
    pattern: '/v1/sessions/:id',
    handler: async (ctx, deps) => {
      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }

      await deps.sessionManager.destroy(ctx.params.id);
      deps.quotaManager.recordSessionDestroyed(ctx.tenant.tenantId);

      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/hibernate',
    handler: async (ctx, deps) => {
      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }

      await deps.sessionManager.hibernate(ctx.params.id);
      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/resume',
    handler: async (ctx, deps) => {
      const session = await deps.sessionManager.resume(ctx.params.id);
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }
      return session;
    },
  },

  // Message operations
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/messages',
    handler: async (ctx, deps) => {
      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }

      // Check quota
      const quotaCheck = deps.quotaManager.checkQuota(ctx.tenant.tenantId, 'message');
      if (!quotaCheck.allowed) {
        throw { status: 429, message: quotaCheck.message };
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

      const targetAgent = to || session.config.entryAgent || `${session.meshId}/worker`;

      const message: AgentMessage = {
        from: 'api/client',
        to: targetAgent,
        type: type || 'task',
        body,
        headline,
        timestamp: Date.now(),
      };

      const msgId = await deps.storage.writeMessage(ctx.params.id, message);
      await deps.storage.queueInsert(ctx.params.id, message);

      deps.quotaManager.recordMessageSent(ctx.tenant.tenantId);
      await deps.sessionManager.touch(ctx.params.id);

      return { msgId, message };
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions/:id/messages',
    handler: async (ctx, deps) => {
      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }

      const limit = parseInt(ctx.query.get('limit') || '50', 10);
      const since = ctx.query.get('since') || undefined;
      const type = ctx.query.get('type') || undefined;

      const messages = await deps.storage.listMessages(ctx.params.id, {
        limit,
        sinceId: since,
        type,
      });

      return { messages };
    },
  },

  // Tenant usage
  {
    method: 'GET',
    pattern: '/v1/usage',
    handler: async (ctx, deps) => {
      const usage = deps.quotaManager.getUsage(ctx.tenant.tenantId);
      return {
        usage,
        quotas: ctx.tenant.quotas,
      };
    },
  },

  // Worker stats
  {
    method: 'GET',
    pattern: '/v1/stats',
    handler: async (ctx, deps) => {
      const workerStats = deps.workerPool.getStats();
      const sessions = deps.sessionManager.getActiveSessions()
        .filter(s => s.tenantId === ctx.tenant.tenantId);

      return {
        sessions: sessions.length,
        workers: workerStats,
      };
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

  // Mesh management routes
  {
    method: 'GET',
    pattern: '/v1/meshes',
    handler: async (ctx, deps) => {
      return deps.meshController.listMeshes();
    },
  },
  {
    method: 'GET',
    pattern: '/v1/meshes/:name',
    handler: async (ctx, deps) => {
      try {
        return await deps.meshController.getMesh(ctx.params.name);
      } catch (error) {
        if (error instanceof MeshNotFoundError) {
          throw { status: 404, message: error.message };
        }
        throw error;
      }
    },
  },
  {
    method: 'PUT',
    pattern: '/v1/meshes/:name',
    handler: async (ctx, deps) => {
      const body = ctx.body as { config: unknown; format: 'yaml' | 'json' };

      if (!body.config) {
        throw { status: 400, message: 'config is required' };
      }
      if (!body.format || !['yaml', 'json'].includes(body.format)) {
        throw { status: 400, message: 'format must be yaml or json' };
      }

      try {
        const result = await deps.meshController.updateMesh(ctx.params.name, body as { config: any; format: 'yaml' | 'json' });
        if (!result.success) {
          throw { status: 400, message: 'Validation failed', errors: result.errors, warnings: result.warnings };
        }
        return result;
      } catch (error) {
        if (error instanceof MeshNotFoundError) {
          throw { status: 404, message: error.message };
        }
        if ((error as { status?: number }).status) {
          throw error;
        }
        throw { status: 500, message: (error as Error).message };
      }
    },
  },
  {
    method: 'POST',
    pattern: '/v1/meshes/:name/validate',
    handler: async (ctx, deps) => {
      const body = ctx.body as { config: unknown };

      if (!body.config) {
        throw { status: 400, message: 'config is required' };
      }

      return deps.meshController.validateMesh(ctx.params.name, body.config as any);
    },
  },

  // Dashboard stats
  {
    method: 'GET',
    pattern: '/v1/dashboard/stats',
    handler: async (ctx, deps) => {
      return deps.statsController.getDashboardStats();
    },
  },

  // Workspace file browser routes
  {
    method: 'GET',
    pattern: '/v1/workspace',
    handler: async (ctx, deps) => {
      const dirPath = ctx.query.get('path') || '';
      try {
        return await deps.workspaceController.listDirectory(dirPath);
      } catch (error) {
        if (error instanceof PathNotFoundError) {
          throw { status: 404, message: error.message };
        }
        if (error instanceof PathSecurityError) {
          throw { status: 403, message: error.message };
        }
        throw error;
      }
    },
  },
  {
    method: 'GET',
    pattern: '/v1/workspace/file',
    handler: async (ctx, deps) => {
      const filePath = ctx.query.get('path');
      if (!filePath) {
        throw { status: 400, message: 'path is required' };
      }
      try {
        return await deps.workspaceController.readFile(filePath);
      } catch (error) {
        if (error instanceof PathNotFoundError) {
          throw { status: 404, message: error.message };
        }
        if (error instanceof PathSecurityError) {
          throw { status: 403, message: error.message };
        }
        throw error;
      }
    },
  },
  {
    method: 'PUT',
    pattern: '/v1/workspace/file',
    handler: async (ctx, deps) => {
      const body = ctx.body as { path: string; content: string };
      if (!body.path) {
        throw { status: 400, message: 'path is required' };
      }
      if (body.content === undefined) {
        throw { status: 400, message: 'content is required' };
      }
      try {
        await deps.workspaceController.writeFile(body.path, body.content);
        return { success: true };
      } catch (error) {
        if (error instanceof PathSecurityError) {
          throw { status: 403, message: error.message };
        }
        throw error;
      }
    },
  },
  {
    method: 'POST',
    pattern: '/v1/workspace/file',
    handler: async (ctx, deps) => {
      const body = ctx.body as { path: string; content?: string };
      if (!body.path) {
        throw { status: 400, message: 'path is required' };
      }
      try {
        await deps.workspaceController.createFile(body.path, body.content || '');
        return { success: true };
      } catch (error) {
        if (error instanceof PathSecurityError) {
          throw { status: 403, message: error.message };
        }
        throw error;
      }
    },
  },
  {
    method: 'POST',
    pattern: '/v1/workspace/directory',
    handler: async (ctx, deps) => {
      const body = ctx.body as { path: string };
      if (!body.path) {
        throw { status: 400, message: 'path is required' };
      }
      try {
        await deps.workspaceController.createDirectory(body.path);
        return { success: true };
      } catch (error) {
        if (error instanceof PathSecurityError) {
          throw { status: 403, message: error.message };
        }
        throw error;
      }
    },
  },
  {
    method: 'DELETE',
    pattern: '/v1/workspace/entry',
    handler: async (ctx, deps) => {
      const entryPath = ctx.query.get('path');
      if (!entryPath) {
        throw { status: 400, message: 'path is required' };
      }
      try {
        await deps.workspaceController.deleteEntry(entryPath);
        return { success: true };
      } catch (error) {
        if (error instanceof PathNotFoundError) {
          throw { status: 404, message: error.message };
        }
        if (error instanceof PathSecurityError) {
          throw { status: 403, message: error.message };
        }
        throw error;
      }
    },
  },

  // Logs routes
  {
    method: 'GET',
    pattern: '/v1/logs',
    handler: async (ctx, deps) => {
      const filter = {
        level: ctx.query.get('level') || undefined,
        component: ctx.query.get('component') || undefined,
        search: ctx.query.get('search') || undefined,
        limit: parseInt(ctx.query.get('limit') || '100', 10),
        offset: parseInt(ctx.query.get('offset') || '0', 10),
        last: ctx.query.get('last') === 'true',
      };
      return deps.logsController.listLogs(filter);
    },
  },
  {
    method: 'GET',
    pattern: '/v1/logs/components',
    handler: async (ctx, deps) => {
      const components = await deps.logsController.getComponents();
      return { components };
    },
  },
  {
    method: 'DELETE',
    pattern: '/v1/logs',
    handler: async (ctx, deps) => {
      await deps.logsController.clearLogs();
      return { success: true };
    },
  },

  // Sessions list routes
  {
    method: 'GET',
    pattern: '/v1/sessions-list',
    handler: async (ctx, deps) => {
      const filter = {
        meshId: ctx.query.get('meshId') || undefined,
        status: ctx.query.get('status') || undefined,
        limit: parseInt(ctx.query.get('limit') || '50', 10),
        offset: parseInt(ctx.query.get('offset') || '0', 10),
      };
      return deps.sessionsController.listSessions(filter);
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions-list/:id/artifacts',
    handler: async (ctx, deps) => {
      const artifacts = await deps.sessionsController.getSessionArtifacts(ctx.params.id);
      return { artifacts };
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
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Load mesh configuration
 */
function createMeshConfigLoader(meshesDir: string): (meshId: string) => Promise<MeshConfig | null> {
  return async (meshId: string) => {
    const meshPath = path.join(meshesDir, meshId);

    // Try YAML config
    const yamlPath = path.join(meshPath, 'config.yaml');
    if (fs.existsSync(yamlPath)) {
      const content = fs.readFileSync(yamlPath, 'utf-8');
      const config = YAML.parse(content);

      // Load agent prompts
      const agents: Record<string, { prompt: string; model?: string; maxTurns?: number }> = {};
      const agentsDir = meshPath;

      for (const [agentName, agentConfig] of Object.entries(config.agents || {})) {
        const promptPath = path.join(agentsDir, agentName, 'prompt.md');
        let prompt = '';
        if (fs.existsSync(promptPath)) {
          prompt = fs.readFileSync(promptPath, 'utf-8');
        }
        agents[agentName] = {
          prompt,
          model: (agentConfig as { model?: string }).model,
          maxTurns: (agentConfig as { maxTurns?: number }).maxTurns,
        };
      }

      return {
        mesh: config.mesh || meshId,
        entry_point: config.entry_point,
        agents,
      };
    }

    // Try JSON config
    const jsonPath = path.join(meshPath, 'config.json');
    if (fs.existsSync(jsonPath)) {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      return JSON.parse(content);
    }

    return null;
  };
}

/**
 * Start tx-server
 */
export async function server(options: ServerOptions): Promise<void> {
  const port = options.port || parseInt(process.env.TX_SERVER_PORT || '6000', 10);
  const host = options.host || process.env.TX_SERVER_HOST || '0.0.0.0';
  const concurrency = options.concurrency || parseInt(process.env.TX_WORKER_CONCURRENCY || '10', 10);
  const authEnabled = options.authEnabled ?? process.env.TX_AUTH_ENABLED === 'true';
  const noDb = options.noDb ?? false;
  const meshesDir = process.env.TX_ROOT
    ? path.join(process.env.TX_ROOT, 'meshes')
    : path.join(process.cwd(), 'meshes');

  // Initialize mesh controller (always needed for mesh CRUD)
  const meshController = new MeshController(meshesDir);

  let storage: StorageProvider | null = null;
  let sessionManager: SessionManager | null = null;
  let workerPool: WorkerPool | null = null;
  let quotaManager: QuotaManager | null = null;
  let rateLimiter: RateLimiter | null = null;
  let auth: AuthMiddleware;

  if (!noDb) {
    // Full mode: Initialize storage provider
    storage = createStorageProviderFromEnv();
    await storage.init();
    log.info('server', 'Storage provider initialized', { type: process.env.TX_STORAGE_TYPE || 'local' });

    // Initialize session manager
    sessionManager = new SessionManager({ storage });
    sessionManager.start();

    // Initialize auth
    auth = new AuthMiddleware({ enabled: authEnabled });
    auth.loadFromEnv();

    // Initialize rate limiter
    rateLimiter = new RateLimiter({
      enabled: true,
      defaultLimit: 60,  // 60 requests per minute
      defaultBurst: 100,
    });
    rateLimiter.start();

    // Initialize quota manager
    quotaManager = new QuotaManager({ storage });
    quotaManager.start();

    // Initialize worker pool
    workerPool = new WorkerPool({
      storage,
      sessionManager,
      concurrency,
      meshConfigLoader: createMeshConfigLoader(meshesDir),
    });
    workerPool.start();

    // Wire up events
    workerPool.on('worker:complete', ({ sessionId, durationMs }) => {
      const session = sessionManager!.getActiveSessions().find(s => s.sessionId === sessionId);
      if (session?.tenantId) {
        quotaManager!.recordWorkerCompleted(session.tenantId, durationMs);
      }
    });

    sessionManager.on('session:destroyed', (sessionId) => {
      // Already handled in route
    });

    log.info('server', 'Full mode: Storage, sessions, and workers initialized');
  } else {
    // No-DB mode: Minimal setup for static serving and mesh CRUD only
    auth = new AuthMiddleware({ enabled: false });
    log.info('server', 'No-DB mode: Only mesh CRUD and static serving available');
  }

  // Initialize additional controllers (always available)
  const workDir = process.env.TX_CWD || process.cwd();
  const workspaceController = new WorkspaceController(workDir);
  const logsController = new LogsController(workDir);
  const sessionsController = new SessionsController(workDir);
  const statsController = new StatsController(workDir, meshesDir);

  const deps: ServerDeps = {
    storage: storage!,
    sessionManager: sessionManager!,
    workerPool: workerPool!,
    quotaManager: quotaManager!,
    rateLimiter: rateLimiter!,
    meshController,
    workspaceController,
    logsController,
    sessionsController,
    statsController,
  };

  // Create HTTP server
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const method = req.method || 'GET';
    const reqPath = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let tenant: TenantInfo;

    if (!noDb) {
      // Full mode: Auth, rate limiting, and quota tracking
      const authResult = auth.authenticate(req);
      if (!authResult.authenticated) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: authResult.error }));
        return;
      }

      tenant = authResult.tenant!;

      // Rate limit check
      const limitKey = rateLimitKey(tenant.tenantId, reqPath);
      const limitResult = rateLimiter!.check(limitKey, tenant.quotas.maxMessagesPerMinute);

      res.setHeader('X-RateLimit-Remaining', String(limitResult.remaining));
      res.setHeader('X-RateLimit-Reset', String(limitResult.resetAt));

      if (!limitResult.allowed) {
        res.setHeader('Retry-After', String(limitResult.retryAfter || 60));
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: limitResult.retryAfter }));
        return;
      }

      // Record API request
      quotaManager!.recordApiRequest(tenant.tenantId);
    } else {
      // No-DB mode: Create dummy tenant for route handlers
      tenant = {
        tenantId: 'local',
        name: 'Local Development',
        quotas: {
          maxSessions: 999,
          maxMessagesPerSession: 999,
          maxMessagesPerMinute: 999,
          maxWorkerTimeMs: 999999,
        },
      };
    }

    // Find matching route
    for (const route of routes) {
      if (route.method !== method) continue;

      const params = matchRoute(route.pattern, reqPath);
      if (params === null) continue;

      try {
        const body = await parseBody(req);
        const ctx: RequestContext = {
          method,
          path: reqPath,
          params,
          query: url.searchParams,
          body,
          tenant,
        };

        const result = await route.handler(ctx, deps);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      } catch (err) {
        const status = (err as { status?: number }).status || 500;
        const message = (err as { message?: string }).message || 'Internal server error';

        if (status >= 500) {
          log.error('server', 'Request error', { method, path: reqPath, status, message });
          if (!noDb) {
            quotaManager!.recordApiRequest(tenant.tenantId, true);
          }
        }

        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
        return;
      }
    }

    // No route matched - serve static files for non-API routes
    // Compute frontend dist path relative to this file
    // This file is at: src/cli/server.ts
    // Frontend dist is at: frontend/dist/
    const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');

    // For API routes that didn't match, return 404
    if (reqPath.startsWith('/v1/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Try to serve static file
    let filePath = path.join(frontendDistPath, reqPath);

    // Determine content type based on extension
    const getContentType = (filepath: string): string => {
      const ext = path.extname(filepath).toLowerCase();
      const types: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
      };
      return types[ext] || 'application/octet-stream';
    };

    // Check if file exists
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        res.end(content);
        return;
      }
    } catch {
      // File doesn't exist, fall through to SPA fallback
    }

    // SPA fallback - serve index.html for all other routes
    const indexPath = path.join(frontendDistPath, 'index.html');
    try {
      const content = fs.readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Frontend not built. Run: cd frontend && npm run build');
    }
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/stream$/);

    if (!match) {
      ws.close(4400, 'Invalid WebSocket path');
      return;
    }

    const sessionId = match[1];

    // Authenticate WebSocket
    const authResult = auth.authenticate(req);
    if (!authResult.authenticated) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    const tenant = authResult.tenant!;

    // Get session
    const session = await sessionManager.get(sessionId);
    if (!session) {
      ws.close(4404, 'Session not found');
      return;
    }

    if (session.tenantId !== tenant.tenantId) {
      ws.close(4403, 'Access denied');
      return;
    }

    log.info('server', 'WebSocket connected', { sessionId, tenantId: tenant.tenantId });

    // Subscribe to messages
    const subscription = storage.subscribeMessages(sessionId);

    (async () => {
      try {
        for await (const event of subscription) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
          }
        }
      } catch (err) {
        log.error('server', 'WebSocket subscription error', { sessionId, error: (err as Error).message });
      }
    })();

    ws.on('message', async (data) => {
      try {
        const payload = JSON.parse(data.toString());

        if (payload.type === 'message') {
          // Check quota
          const quotaCheck = quotaManager.checkQuota(tenant.tenantId, 'message');
          if (!quotaCheck.allowed) {
            ws.send(JSON.stringify({ type: 'error', message: quotaCheck.message }));
            return;
          }

          const message: AgentMessage = {
            from: 'api/client',
            to: payload.to || session.config.entryAgent || `${session.meshId}/worker`,
            type: payload.messageType || 'task',
            body: payload.body,
            headline: payload.headline,
            timestamp: Date.now(),
          };

          const msgId = await storage.writeMessage(sessionId, message);
          await storage.queueInsert(sessionId, message);

          quotaManager.recordMessageSent(tenant.tenantId);
          await sessionManager.touch(sessionId);

          ws.send(JSON.stringify({ type: 'ack', msgId }));
        }
      } catch (err) {
        log.error('server', 'WebSocket message error', { sessionId, error: (err as Error).message });
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    });

    ws.on('close', () => {
      log.info('server', 'WebSocket disconnected', { sessionId });
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('server', 'Shutting down...');

    wss.close();
    httpServer.close();

    if (!noDb) {
      await workerPool!.stop();
      await quotaManager!.stop();
      rateLimiter!.stop();
      sessionManager!.stop();
      await storage!.close();
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start listening
  httpServer.listen(port, host, () => {
    log.info('server', `tx-server listening on http://${host}:${port}`, { mode: noDb ? 'no-db' : 'full' });

    const sessionEndpoints = noDb ? '' : `
  API Endpoints:
    POST   /v1/sessions              Create session
    GET    /v1/sessions/:id          Get session
    DELETE /v1/sessions/:id          Destroy session
    POST   /v1/sessions/:id/hibernate
    POST   /v1/sessions/:id/resume
    POST   /v1/sessions/:id/messages Send message
    GET    /v1/sessions/:id/messages List messages
    GET    /v1/usage                 Get usage stats
    GET    /v1/stats                 Get worker stats
    WS     /v1/sessions/:id/stream   Real-time stream
`;

    const config = noDb ? `
  Configuration:
    MODE:                 no-db (static serving + mesh CRUD only)
    AUTH:                 disabled
` : `
  Configuration:
    MODE:                 full (sessions, workers, storage)
    TX_STORAGE_TYPE:      ${process.env.TX_STORAGE_TYPE || 'local'}
    TX_REDIS_URL:         ${process.env.TX_REDIS_URL || '(not set)'}
    TX_AUTH_ENABLED:      ${authEnabled}
    TX_WORKER_CONCURRENCY: ${concurrency}
`;

    console.log(`
  tx-server running on http://${host}:${port}
${sessionEndpoints}
  Mesh Management:
    GET    /v1/meshes                List all meshes
    GET    /v1/meshes/:name          Get mesh config
    PUT    /v1/meshes/:name          Update mesh config
    POST   /v1/meshes/:name/validate Validate mesh config
${config}`);
  });
}

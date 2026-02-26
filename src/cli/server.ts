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
import { CoreWebSocketHandler } from '../core/core-websocket.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerOptions {
  port?: number;
  host?: string;
  mesh?: string;
  concurrency?: number;
  authEnabled?: boolean;
  noDb?: boolean;
  embedded?: boolean; // When true, returns shutdown fn instead of setting signal handlers
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
  // Optional in no-db mode
  storage: StorageProvider | null;
  sessionManager: SessionManager | null;
  workerPool: WorkerPool | null;
  quotaManager: QuotaManager | null;
  rateLimiter: RateLimiter | null;
  // Always available
  meshController: MeshController;
  workspaceController: WorkspaceController;
  logsController: LogsController;
  sessionsController: SessionsController;
  statsController: StatsController;
  meshConfigLoader: (meshId: string) => Promise<MeshConfig | null>;
  workDir: string;
  serverPort: number;
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
 * Resolve a workspace template path by scanning the filesystem.
 * Template like ".ai/research/{topic}/" → find matching directory.
 * Returns the resolved relative path or null if not found.
 */
function resolveWorkspaceTemplate(baseDir: string, template: string): string | null {
  // Strip trailing slash
  const tmpl = template.replace(/\/+$/, '');

  // Check if template has variables
  const varMatch = tmpl.match(/\{([^}]+)\}/);
  if (!varMatch) {
    // Static path — just check if it exists
    const fullPath = path.join(baseDir, tmpl);
    return fs.existsSync(fullPath) ? tmpl : null;
  }

  // Split at the variable segment
  const segments = tmpl.split('/');
  const staticSegments: string[] = [];
  let varSegmentIndex = -1;

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].includes('{')) {
      varSegmentIndex = i;
      break;
    }
    staticSegments.push(segments[i]);
  }

  if (varSegmentIndex === -1) return null;

  // Build static prefix path
  const prefixPath = path.join(baseDir, ...staticSegments);
  if (!fs.existsSync(prefixPath)) return null;

  try {
    const entries = fs.readdirSync(prefixPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    if (dirs.length === 0) return null;

    // Pick most recently modified directory
    let best = dirs[0].name;
    let bestTime = 0;
    for (const dir of dirs) {
      try {
        const stat = fs.statSync(path.join(prefixPath, dir.name));
        if (stat.mtimeMs > bestTime) {
          bestTime = stat.mtimeMs;
          best = dir.name;
        }
      } catch {}
    }

    // Reconstruct the resolved path
    const resolvedSegments = [...staticSegments, best, ...segments.slice(varSegmentIndex + 1)];
    const resolved = resolvedSegments.join('/');

    // Verify the full resolved path exists
    const fullResolved = path.join(baseDir, resolved);
    return fs.existsSync(fullResolved) ? resolved : null;
  } catch {
    return null;
  }
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
      if (!deps.sessionManager || !deps.quotaManager) {
        throw { status: 503, message: 'Session management not available in no-db mode' };
      }

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

      // Look up workspace template from mesh config
      let workspaceTemplate: string | undefined;
      try {
        const meshConfig = await deps.meshConfigLoader(meshId);
        if (meshConfig?.workspace?.path) {
          workspaceTemplate = meshConfig.workspace.path;
        }
      } catch {}

      // entryAgent resolved from mesh config by session-manager if not explicitly provided
      const session = await deps.sessionManager.create({
        meshId,
        tenantId: ctx.tenant.tenantId,
        entryAgent,
        ttlSeconds,
        metadata: workspaceTemplate ? { workspace_template: workspaceTemplate } : undefined,
      });

      deps.quotaManager.recordSessionCreated(ctx.tenant.tenantId);

      // Register www session so tx-start can forward core-messages
      registerWwwSession(deps.workDir, meshId, session.sessionId, deps.serverPort);

      return session;
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions/:id',
    handler: async (ctx, deps) => {
      if (!deps.sessionManager) {
        throw { status: 503, message: 'Session management not available in no-db mode' };
      }

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
      if (!deps.sessionManager || !deps.quotaManager) {
        throw { status: 503, message: 'Session management not available in no-db mode' };
      }

      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }

      // Unregister www session
      unregisterWwwSession(deps.workDir, session.meshId);

      await deps.sessionManager.destroy(ctx.params.id);
      deps.quotaManager.recordSessionDestroyed(ctx.tenant.tenantId);

      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/hibernate',
    handler: async (ctx, deps) => {
      if (!deps.sessionManager) {
        throw { status: 503, message: 'Session management not available in no-db mode' };
      }

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
      if (!deps.sessionManager) {
        throw { status: 503, message: 'Session management not available in no-db mode' };
      }

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
      if (!deps.sessionManager || !deps.storage || !deps.quotaManager) {
        throw { status: 503, message: 'Session management not available in no-db mode' };
      }

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
        from: 'core/core',
        to: targetAgent,
        type: type || 'task',
        body,
        headline,
        timestamp: Date.now(),
      };

      // Write to session storage (for message history/WebSocket)
      await deps.storage.writeMessage(ctx.params.id, message);

      // Write to .ai/tx/msgs/ so tx-start Consumer picks it up
      const msgId = writeToMsgsDir(deps.workDir, message, ctx.params.id);

      deps.quotaManager.recordMessageSent(ctx.tenant.tenantId);
      await deps.sessionManager.touch(ctx.params.id);

      return { msgId, message };
    },
  },
  // Forward endpoint: tx-start POSTs mesh responses here instead of file-copy
  {
    method: 'POST',
    pattern: '/v1/sessions/:id/forward',
    handler: async (ctx, deps) => {
      if (!deps.storage) {
        throw { status: 503, message: 'Storage not available in no-db mode' };
      }

      const { from, to, type, body, headline, msgId, refMsgId } = ctx.body as {
        from: string;
        to?: string;
        type?: string;
        body: string;
        headline?: string;
        msgId?: string;
        refMsgId?: string;
      };

      if (!from || !body) {
        throw { status: 400, message: 'from and body are required' };
      }

      const message: AgentMessage = {
        from,
        to: to || 'core/core',
        type: type || 'task-complete',
        body,
        headline,
        msgId,
        refMsgId,
        timestamp: Date.now(),
      };

      // Write to session storage ONLY (triggers WS subscription, avoids msgs dir loop)
      const storedId = await deps.storage.writeMessage(ctx.params.id, message);

      log.info('server', 'Forwarded message to session', { sessionId: ctx.params.id, from, msgId: storedId });
      return { success: true, msgId: storedId };
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions/:id/messages',
    handler: async (ctx, deps) => {
      if (!deps.sessionManager || !deps.storage) {
        throw { status: 503, message: 'Session management not available in no-db mode' };
      }

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
      if (!deps.quotaManager) {
        throw { status: 503, message: 'Usage tracking not available in no-db mode' };
      }

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
      if (!deps.workerPool || !deps.sessionManager) {
        throw { status: 503, message: 'Stats not available in no-db mode' };
      }

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

  // Session-scoped workspace (files tab)
  {
    method: 'GET',
    pattern: '/v1/sessions/:id/workspace',
    handler: async (ctx, deps) => {
      if (!deps.sessionManager) {
        throw { status: 503, message: 'Session management not available' };
      }

      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }

      // Check if this session already has a bound workspace
      let resolved = session.config.metadata?.workspace_resolved as string | undefined;
      let template = session.config.metadata?.workspace_template as string | undefined;

      if (!resolved) {
        // Get workspace template from session metadata or mesh config
        if (!template) {
          try {
            const meshConfig = await deps.meshConfigLoader(session.meshId);
            template = meshConfig?.workspace?.path;
          } catch {}
        }

        if (!template) {
          return { workspace: null, message: 'No workspace defined for this mesh' };
        }

        // Resolve the template
        resolved = resolveWorkspaceTemplate(deps.workDir, template) || undefined;
        if (!resolved) {
          return { workspace: { template, resolved: null }, entries: [], message: 'Workspace not yet created' };
        }

        // Bind this workspace to the session so it sticks across conversations
        if (deps.storage) {
          try {
            await deps.storage.updateSession(ctx.params.id, {
              metadata: {
                ...session.config.metadata,
                workspace_template: template,
                workspace_resolved: resolved,
              },
            });
            // Also update in-memory session
            if (!session.config.metadata) session.config.metadata = {};
            session.config.metadata.workspace_resolved = resolved;
            session.config.metadata.workspace_template = template;
          } catch {}
        }
      }

      // List directory contents
      const dirPath = ctx.query.get('path') || '';
      const fullBase = path.join(deps.workDir, resolved);
      const targetPath = dirPath ? path.join(fullBase, dirPath) : fullBase;

      // Security: ensure target is within resolved workspace
      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(fullBase);
      if (!resolvedTarget.startsWith(resolvedBase)) {
        throw { status: 403, message: 'Path outside workspace' };
      }

      if (!fs.existsSync(targetPath)) {
        return { workspace: { template, resolved }, entries: [], path: dirPath };
      }

      const stat = fs.statSync(targetPath);
      if (!stat.isDirectory()) {
        throw { status: 400, message: 'Not a directory' };
      }

      const entries = fs.readdirSync(targetPath, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.'))
        .map(e => {
          const entryPath = path.join(targetPath, e.name);
          try {
            const entryStat = fs.statSync(entryPath);
            return {
              name: e.name,
              path: dirPath ? `${dirPath}/${e.name}` : e.name,
              type: e.isDirectory() ? 'directory' : 'file',
              size: entryStat.size,
              modified: entryStat.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const workspaceTemplate = template || session.config.metadata?.workspace_template || resolved;
      return { workspace: { template: workspaceTemplate, resolved }, entries, path: dirPath || '' };
    },
  },
  {
    method: 'GET',
    pattern: '/v1/sessions/:id/workspace/file',
    handler: async (ctx, deps) => {
      if (!deps.sessionManager) {
        throw { status: 503, message: 'Session management not available' };
      }

      const session = await deps.sessionManager.get(ctx.params.id);
      if (!session) {
        throw { status: 404, message: 'Session not found' };
      }
      if (session.tenantId !== ctx.tenant.tenantId) {
        throw { status: 403, message: 'Access denied' };
      }

      const filePath = ctx.query.get('path');
      if (!filePath) {
        throw { status: 400, message: 'path is required' };
      }

      // Use bound workspace if available, otherwise resolve fresh
      let resolved = session.config.metadata?.workspace_resolved as string | undefined;
      if (!resolved) {
        let template = session.config.metadata?.workspace_template as string | undefined;
        if (!template) {
          try {
            const meshConfig = await deps.meshConfigLoader(session.meshId);
            template = meshConfig?.workspace?.path;
          } catch {}
        }
        if (!template) {
          throw { status: 404, message: 'No workspace defined for this mesh' };
        }
        resolved = resolveWorkspaceTemplate(deps.workDir, template) || undefined;
        if (!resolved) {
          throw { status: 404, message: 'Workspace not yet created' };
        }
      }

      const fullBase = path.join(deps.workDir, resolved);
      const targetPath = path.join(fullBase, filePath);

      // Security: ensure target is within resolved workspace
      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(fullBase);
      if (!resolvedTarget.startsWith(resolvedBase)) {
        throw { status: 403, message: 'Path outside workspace' };
      }

      if (!fs.existsSync(targetPath)) {
        throw { status: 404, message: 'File not found' };
      }

      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        throw { status: 400, message: 'Cannot read directory as file' };
      }

      // 10MB limit
      if (stat.size > 10 * 1024 * 1024) {
        throw { status: 413, message: 'File too large' };
      }

      const content = fs.readFileSync(targetPath, 'utf-8');
      return {
        path: filePath,
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };
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
 * www-sessions registry — lets tx-start know which meshes have active web sessions.
 * File: .ai/tx/data/www-sessions.json
 * Format: { meshId: { sessionId, createdAt } }
 */
function getWwwSessionsPath(workDir: string): string {
  return path.join(workDir, '.ai', 'tx', 'data', 'www-sessions.json');
}

function registerWwwSession(workDir: string, meshId: string, sessionId: string, port?: number): void {
  const filePath = getWwwSessionsPath(workDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let registry: Record<string, { sessionId: string; createdAt: number; port?: number }> = {};
  try {
    if (fs.existsSync(filePath)) {
      registry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {}

  registry[meshId] = { sessionId, createdAt: Date.now(), port };
  fs.writeFileSync(filePath, JSON.stringify(registry, null, 2));
  log.info('server', 'Registered www session', { meshId, sessionId, port });
}

function unregisterWwwSession(workDir: string, meshId: string): void {
  const filePath = getWwwSessionsPath(workDir);
  try {
    if (!fs.existsSync(filePath)) return;
    const registry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    delete registry[meshId];
    fs.writeFileSync(filePath, JSON.stringify(registry, null, 2));
  } catch {}
}

/**
 * Write a message to .ai/tx/msgs/ so the tx-start Consumer picks it up.
 * Uses the same frontmatter format as agent-written messages.
 */
function writeToMsgsDir(workDir: string, message: AgentMessage, sessionId: string): string {
  const msgsDir = path.join(workDir, '.ai', 'tx', 'msgs');
  if (!fs.existsSync(msgsDir)) fs.mkdirSync(msgsDir, { recursive: true });

  const msgId = message.msgId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = message.timestamp || Date.now();
  const safeFrom = message.from.replace(/\//g, '-');
  const safeTo = message.to.replace(/\//g, '-');
  const filename = `${timestamp}-${message.type}-${safeFrom}--${safeTo}-${msgId}.md`;
  const filepath = path.join(msgsDir, filename);

  const frontmatter = [
    `to: ${message.to}`,
    `from: ${message.from}`,
    `type: ${message.type}`,
    `msg-id: ${msgId}`,
    `timestamp: ${new Date(timestamp).toISOString()}`,
    `www-session: ${sessionId}`,
  ];
  if (message.headline) frontmatter.push(`headline: ${message.headline}`);

  const content = `---\n${frontmatter.join('\n')}\n---\n\n${message.body}\n`;
  fs.writeFileSync(filepath, content);
  log.info('server', 'Wrote message to msgs dir', { filename, to: message.to });
  return msgId;
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

      // Load agent prompts — agents is always a YAML array [{name, model, prompt, ...}]
      const agents: Record<string, { prompt: string; model?: string; maxTurns?: number }> = {};
      const rawAgents = config.agents || [];

      for (const agent of rawAgents) {
        const name = agent.name;
        if (!name) continue;
        let prompt = '';
        const candidates = [
          agent.prompt ? path.join(meshPath, agent.prompt) : null,
          path.join(meshPath, name, 'prompt.md'),
          path.join(meshPath, 'prompt.md'),
        ].filter(Boolean) as string[];
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            prompt = fs.readFileSync(p, 'utf-8');
            break;
          }
        }
        agents[name] = {
          prompt,
          model: agent.model,
          maxTurns: agent.maxTurns || agent.max_turns,
        };
      }

      return {
        mesh: config.mesh || meshId,
        entry_point: config.entry_point,
        agents,
        workspace: config.workspace?.path ? { path: config.workspace.path } : undefined,
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
export async function server(options: ServerOptions): Promise<(() => Promise<void>) | void> {
  const port = options.port || parseInt(process.env.TX_SERVER_PORT || '6000', 10);
  const host = options.host || process.env.TX_SERVER_HOST || '0.0.0.0';
  const concurrency = options.concurrency || parseInt(process.env.TX_WORKER_CONCURRENCY || '10', 10);
  const authEnabled = options.authEnabled ?? process.env.TX_AUTH_ENABLED === 'true';
  const noDb = options.noDb ?? false;
  const meshesDir = process.env.TX_ROOT
    ? path.join(process.env.TX_ROOT, 'meshes')
    : path.join(process.cwd(), 'meshes');

  // Initialize mesh controller and config loader (always needed)
  const meshController = new MeshController(meshesDir);
  const meshConfigLoaderFn = createMeshConfigLoader(meshesDir);

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

    // Initialize session manager with mesh-aware entry agent resolution
    sessionManager = new SessionManager({
      storage,
      resolveEntryAgent: (meshId: string) => {
        try {
          const yamlPath = path.join(meshesDir, meshId, 'config.yaml');
          const jsonPath = path.join(meshesDir, meshId, 'config.json');
          let raw: string | undefined;
          if (fs.existsSync(yamlPath)) raw = fs.readFileSync(yamlPath, 'utf-8');
          else if (fs.existsSync(jsonPath)) raw = fs.readFileSync(jsonPath, 'utf-8');
          if (raw) {
            const config = yamlPath && fs.existsSync(yamlPath) ? YAML.parse(raw) : JSON.parse(raw);
            if (config?.entry_point) return `${meshId}/${config.entry_point}`;
          }
        } catch {}
        return `${meshId}/worker`;
      },
    });
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
      meshConfigLoader: meshConfigLoaderFn,
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
  const statsController = new StatsController(workDir, meshesDir, noDb);

  const deps: ServerDeps = {
    storage,
    sessionManager,
    workerPool,
    quotaManager,
    rateLimiter,
    meshController,
    workspaceController,
    logsController,
    sessionsController,
    statsController,
    meshConfigLoader: meshConfigLoaderFn,
    workDir,
    serverPort: port,
  };

  // Create HTTP server
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const method = req.method || 'GET';
    const reqPath = url.pathname;

    process.stdout.write(`[tx-server] ${method} ${reqPath}\n`);

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

    // Auth bypass for internal forward endpoint (tx-start → tx-serve)
    const isForwardEndpoint = /^\/v1\/sessions\/[^/]+\/forward$/.test(reqPath) && method === 'POST';
    if (isForwardEndpoint) {
      tenant = {
        tenantId: 'system',
        name: 'System (internal)',
        tier: 'enterprise' as const,
        quotas: {
          maxSessions: 999,
          maxMessagesPerMinute: 999,
          maxConcurrentWorkers: 999,
        },
      };
    } else if (!noDb) {
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
        tier: 'enterprise' as const,
        quotas: {
          maxSessions: 999,
          maxMessagesPerMinute: 999,
          maxConcurrentWorkers: 999,
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

  // Create persistent core WebSocket handler (handles /v1/core/stream)
  const coreWsHandler = new CoreWebSocketHandler({
    coreConfig: {
      workDir: workDir,
      msgsDir: path.join(workDir, '.ai', 'tx', 'msgs'),
      meshesDir: meshesDir,
      model: 'sonnet',
    },
  });
  coreWsHandler.attach(httpServer);
  log.info('server', 'Core WebSocket handler attached', { path: '/v1/core/stream' });

  // Create WebSocket server for session streams (handles /v1/sessions/:id/stream)
  const wss = new WebSocketServer({ noServer: true });

  // Track connected session WS clients for worker status broadcasting
  const sessionClients = new Map<WebSocket, { sessionId: string; meshId: string }>();

  // Watch workers.json and push status to connected session clients
  const workersJsonPath = path.join(workDir, '.ai', 'tx', 'data', 'workers.json');
  let workersWatcher: fs.FSWatcher | null = null;
  let workersBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

  function broadcastWorkerStatus(): void {
    if (sessionClients.size === 0) return;

    let allWorkers: Array<{ id: string; agentId: string; status: string; startedAt: number; messagesProcessed: number; duration: number }> = [];
    try {
      if (fs.existsSync(workersJsonPath)) {
        const data = JSON.parse(fs.readFileSync(workersJsonPath, 'utf-8'));
        allWorkers = data.workers || [];
      }
    } catch {
      return; // File mid-write, skip this cycle
    }

    for (const [ws, info] of sessionClients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const meshWorkers = allWorkers
        .filter(w => w.agentId.startsWith(`${info.meshId}/`))
        .map(w => ({
          agent: w.agentId.split('/')[1],
          status: w.status,
          startedAt: w.startedAt,
          messagesProcessed: w.messagesProcessed,
          duration: w.duration,
        }));
      ws.send(JSON.stringify({ type: 'workers', workers: meshWorkers }));
    }
  }

  function startWorkersWatcher(): void {
    const dir = path.dirname(workersJsonPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      workersWatcher = fs.watch(workersJsonPath, () => {
        // Debounce rapid writes
        if (workersBroadcastTimer) clearTimeout(workersBroadcastTimer);
        workersBroadcastTimer = setTimeout(broadcastWorkerStatus, 100);
      });
      workersWatcher.on('error', () => {
        // File may not exist yet — retry after delay
        workersWatcher?.close();
        setTimeout(startWorkersWatcher, 5000);
      });
    } catch {
      setTimeout(startWorkersWatcher, 5000);
    }
  }

  startWorkersWatcher();

  // Upgrade HTTP requests to WebSocket for session streams
  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/stream$/);

    // If it matches session stream path, handle with wss
    if (match) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, match[1]); // Pass sessionId as third arg
      });
    }
    // If not a session stream and not handled by core handler, close the socket
    // Note: core handler uses its own WebSocketServer which has its own upgrade handler
  });

  wss.on('connection', async (ws, req, sessionIdParam?: string) => {
    // Check if session management is available (WebSocket requires full mode)
    if (!sessionManager || !storage || !quotaManager) {
      ws.close(4503, 'Session management not available in no-db mode');
      return;
    }

    const sessionId = sessionIdParam as string;

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

    // Register for worker status broadcasts
    sessionClients.set(ws, { sessionId, meshId: session.config.meshId });
    // Send initial worker status immediately
    broadcastWorkerStatus();

    // Subscribe to messages — each connection gets its own independent subscription
    const subscription = storage.subscribeMessages(sessionId) as AsyncIterable<any> & { close?: () => void };

    (async () => {
      try {
        for await (const event of subscription) {
          if (ws.readyState !== WebSocket.OPEN) break;
          ws.send(JSON.stringify(event));
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
            from: 'core/core',
            to: payload.to || session.config.entryAgent || `${session.meshId}/worker`,
            type: payload.messageType || 'task',
            body: payload.body,
            headline: payload.headline,
            timestamp: Date.now(),
          };

          // Write to session storage (for message history/WebSocket)
          await storage.writeMessage(sessionId, message);

          // Write to .ai/tx/msgs/ so tx-start Consumer picks it up
          const workDir = process.env.TX_CWD || process.cwd();
          const msgId = writeToMsgsDir(workDir, message, sessionId);

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
      sessionClients.delete(ws);
      if (subscription.close) subscription.close();  // Stop this connection's watcher
    });
  });

  // Graceful shutdown (exported for embedded use)
  const shutdown = async () => {
    log.info('server', 'Shutting down...');

    // Shutdown core WebSocket handler
    await coreWsHandler.shutdown();

    workersWatcher?.close();
    if (workersBroadcastTimer) clearTimeout(workersBroadcastTimer);
    sessionClients.clear();
    wss.close();
    httpServer.close();

    if (!noDb) {
      await workerPool!.stop();
      await quotaManager!.stop();
      rateLimiter!.stop();
      sessionManager!.stop();
      await storage!.close();
    }
  };

  // Only set up signal handlers if running standalone
  if (!options.embedded) {
    const standaloneShutdown = async () => {
      await shutdown();
      process.exit(0);
    };
    process.on('SIGINT', standaloneShutdown);
    process.on('SIGTERM', standaloneShutdown);
  }

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

    const coreEndpoints = `
  Core Agent (Persistent):
    WS     /v1/core/stream           Persistent core agent WebSocket
    WEB    /core                     Web interface for core agent
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
${sessionEndpoints}${coreEndpoints}
  Mesh Management:
    GET    /v1/meshes                List all meshes
    GET    /v1/meshes/:name          Get mesh config
    PUT    /v1/meshes/:name          Update mesh config
    POST   /v1/meshes/:name/validate Validate mesh config
${config}`);
  });

  // Return shutdown function for embedded mode
  if (options.embedded) {
    return shutdown;
  }
}

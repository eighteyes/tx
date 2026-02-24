/**
 * SessionManager - Manages session lifecycle for tx-server
 *
 * Responsibilities:
 * - Create sessions with mesh configuration
 * - Track active sessions and their state
 * - Hibernate sessions (hot → cold storage)
 * - Resume hibernated sessions
 * - Cleanup expired/destroyed sessions
 * - Emit lifecycle events for other components
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { StorageProvider, SessionState } from '../storage/index.ts';
import { log } from '../shared/logger.ts';

export interface SessionConfig {
  meshId: string;
  tenantId?: string;
  entryAgent?: string;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface SessionInfo extends SessionState {
  config: SessionConfig;
  messageCount: number;
  workerCount: number;
}

export interface SessionManagerConfig {
  storage: StorageProvider;
  defaultTtlSeconds?: number;
  hibernateAfterIdleSeconds?: number;
  cleanupIntervalSeconds?: number;
  /** Resolve entry agent for a mesh from its config. Falls back to meshId/worker if not provided. */
  resolveEntryAgent?: (meshId: string) => string;
}

export interface SessionManagerEvents {
  'session:created': (session: SessionInfo) => void;
  'session:resumed': (session: SessionInfo) => void;
  'session:hibernated': (sessionId: string) => void;
  'session:destroyed': (sessionId: string) => void;
  'session:expired': (sessionId: string) => void;
  'session:activity': (sessionId: string) => void;
}

export class SessionManager extends EventEmitter {
  private storage: StorageProvider;
  private sessions: Map<string, SessionInfo> = new Map();
  private defaultTtl: number;
  private hibernateAfterIdle: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private cleanupIntervalSeconds: number;
  private resolveEntryAgent: (meshId: string) => string;

  constructor(config: SessionManagerConfig) {
    super();
    this.storage = config.storage;
    this.defaultTtl = config.defaultTtlSeconds || 3600; // 1 hour
    this.hibernateAfterIdle = config.hibernateAfterIdleSeconds || 1800; // 30 min
    this.cleanupIntervalSeconds = config.cleanupIntervalSeconds || 60;
    this.resolveEntryAgent = config.resolveEntryAgent || ((meshId) => `${meshId}/worker`);
  }

  /**
   * Start the session manager (begins cleanup loop)
   */
  start(): void {
    this.cleanupInterval = setInterval(
      () => this.runCleanup(),
      this.cleanupIntervalSeconds * 1000
    );
    log.info('session-manager', 'Started', {
      defaultTtl: this.defaultTtl,
      hibernateAfterIdle: this.hibernateAfterIdle,
    });
  }

  /**
   * Stop the session manager
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    log.info('session-manager', 'Stopped');
  }

  /**
   * Create a new session
   */
  async create(config: SessionConfig): Promise<SessionInfo> {
    const sessionState = await this.storage.createSession(config.meshId, config.tenantId);

    const session: SessionInfo = {
      ...sessionState,
      config: {
        ...config,
        ttlSeconds: config.ttlSeconds || this.defaultTtl,
        entryAgent: config.entryAgent || this.resolveEntryAgent(config.meshId),
      },
      messageCount: 0,
      workerCount: 0,
    };

    this.sessions.set(session.sessionId, session);

    log.info('session-manager', 'Session created', {
      sessionId: session.sessionId,
      meshId: config.meshId,
      tenantId: config.tenantId,
    });

    this.emit('session:created', session);
    return session;
  }

  /**
   * Get session by ID (from cache or storage)
   */
  async get(sessionId: string): Promise<SessionInfo | null> {
    // Check cache first
    const cached = this.sessions.get(sessionId);
    if (cached) {
      return cached;
    }

    // Load from storage
    const stored = await this.storage.getSession(sessionId);
    if (!stored) {
      return null;
    }

    // Reconstruct SessionInfo (config may be partial)
    const session: SessionInfo = {
      ...stored,
      config: {
        meshId: stored.meshId,
        tenantId: stored.tenantId,
        entryAgent: this.resolveEntryAgent(stored.meshId),
        ttlSeconds: this.defaultTtl,
        metadata: stored.metadata,
      },
      messageCount: 0,
      workerCount: 0,
    };

    // Cache if active
    if (stored.status === 'active') {
      this.sessions.set(sessionId, session);
    }

    return session;
  }

  /**
   * Record activity on a session (resets idle timer)
   */
  async touch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
      await this.storage.updateSession(sessionId, {
        metadata: { ...session.config.metadata, lastActivityAt: session.lastActivityAt }
      });
      this.emit('session:activity', sessionId);
    }
  }

  /**
   * Increment message count for a session
   */
  incrementMessageCount(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messageCount++;
    }
  }

  /**
   * Track worker count for a session
   */
  setWorkerCount(sessionId: string, count: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.workerCount = count;
    }
  }

  /**
   * Hibernate a session (move to cold storage)
   */
  async hibernate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status === 'hibernated') {
      return; // Already hibernated
    }

    await this.storage.hibernateSession(sessionId);
    session.status = 'hibernated';
    this.sessions.delete(sessionId); // Remove from hot cache

    log.info('session-manager', 'Session hibernated', { sessionId });
    this.emit('session:hibernated', sessionId);
  }

  /**
   * Resume a hibernated session
   */
  async resume(sessionId: string): Promise<SessionInfo> {
    let session = this.sessions.get(sessionId);

    if (session && session.status === 'active') {
      return session; // Already active
    }

    const stored = await this.storage.resumeSession(sessionId);

    session = {
      ...stored,
      config: {
        meshId: stored.meshId,
        tenantId: stored.tenantId,
        entryAgent: this.resolveEntryAgent(stored.meshId),
        ttlSeconds: this.defaultTtl,
        metadata: stored.metadata,
      },
      messageCount: 0,
      workerCount: 0,
    };

    this.sessions.set(sessionId, session);

    log.info('session-manager', 'Session resumed', { sessionId });
    this.emit('session:resumed', session);
    return session;
  }

  /**
   * Destroy a session completely
   */
  async destroy(sessionId: string): Promise<void> {
    await this.storage.destroySession(sessionId);
    this.sessions.delete(sessionId);

    log.info('session-manager', 'Session destroyed', { sessionId });
    this.emit('session:destroyed', sessionId);
  }

  /**
   * List sessions for a tenant
   */
  async listByTenant(tenantId: string): Promise<SessionInfo[]> {
    const stored = await this.storage.listSessions(tenantId);

    return stored.map(s => {
      // Check cache for enriched info
      const cached = this.sessions.get(s.sessionId);
      if (cached) return cached;

      return {
        ...s,
        config: {
          meshId: s.meshId,
          tenantId: s.tenantId,
          entryAgent: this.resolveEntryAgent(s.meshId),
          ttlSeconds: this.defaultTtl,
        },
        messageCount: 0,
        workerCount: 0,
      };
    });
  }

  /**
   * Get all active sessions (from cache)
   */
  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  /**
   * Run cleanup: hibernate idle sessions, expire old ones
   */
  private async runCleanup(): Promise<void> {
    const now = Date.now();
    const toHibernate: string[] = [];
    const toExpire: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const idleTime = (now - session.lastActivityAt) / 1000;
      const totalTime = (now - session.createdAt) / 1000;

      // Check for expiration (TTL exceeded)
      if (totalTime > (session.config.ttlSeconds || this.defaultTtl)) {
        toExpire.push(sessionId);
        continue;
      }

      // Check for hibernation (idle too long, no active workers)
      if (idleTime > this.hibernateAfterIdle && session.workerCount === 0) {
        toHibernate.push(sessionId);
      }
    }

    // Hibernate idle sessions
    for (const sessionId of toHibernate) {
      try {
        await this.hibernate(sessionId);
      } catch (err) {
        log.error('session-manager', 'Failed to hibernate session', {
          sessionId,
          error: (err as Error).message,
        });
      }
    }

    // Expire old sessions
    for (const sessionId of toExpire) {
      try {
        await this.destroy(sessionId);
        this.emit('session:expired', sessionId);
        log.info('session-manager', 'Session expired', { sessionId });
      } catch (err) {
        log.error('session-manager', 'Failed to expire session', {
          sessionId,
          error: (err as Error).message,
        });
      }
    }

    if (toHibernate.length > 0 || toExpire.length > 0) {
      log.debug('session-manager', 'Cleanup completed', {
        hibernated: toHibernate.length,
        expired: toExpire.length,
        active: this.sessions.size,
      });
    }
  }
}

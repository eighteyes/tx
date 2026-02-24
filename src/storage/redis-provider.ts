/**
 * RedisStorageProvider - Redis-based storage for production
 *
 * Implements StorageProvider using:
 * - Redis Streams for message queuing
 * - Redis hashes for session state
 * - Redis pub/sub for real-time message subscriptions
 *
 * Responsibilities:
 * - Multi-tenant session isolation via key prefixing
 * - Horizontal scaling via consumer groups
 * - Session hibernation (hot → cold via TTL)
 */

import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type {
  StorageProvider,
  StorageConfig,
  AgentMessage,
  QueueEntry,
  SessionState,
  MessageFilter,
  MessageEvent,
} from './interface.ts';

export class RedisStorageProvider implements StorageProvider {
  private redis: Redis;
  private subscriber: Redis;
  private prefix: string;
  private emitters: Map<string, EventEmitter> = new Map();
  private consumerName: string;

  constructor(config: StorageConfig) {
    const redisUrl = config.redisUrl || 'redis://localhost:6379';
    this.prefix = config.redisPrefix || 'tx';
    this.consumerName = `worker-${randomUUID().slice(0, 8)}`;

    this.redis = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
  }

  // ─────────────────────────────────────────────────────────────
  // Key Helpers
  // ─────────────────────────────────────────────────────────────

  private key(...parts: string[]): string {
    return [this.prefix, ...parts].join(':');
  }

  private sessionKey(sessionId: string, ...parts: string[]): string {
    return this.key('session', sessionId, ...parts);
  }

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    // Test connection
    await this.redis.ping();
  }

  async close(): Promise<void> {
    // Close all emitters
    for (const emitter of Array.from(this.emitters.values())) {
      emitter.emit('close');
    }
    this.emitters.clear();

    // Close Redis connections
    await this.subscriber.quit();
    await this.redis.quit();
  }

  // ─────────────────────────────────────────────────────────────
  // Message Operations
  // ─────────────────────────────────────────────────────────────

  async writeMessage(sessionId: string, message: AgentMessage): Promise<string> {
    const msgId = message.msgId || randomUUID();
    const timestamp = message.timestamp || Date.now();

    const fullMessage: AgentMessage = {
      ...message,
      msgId,
      timestamp,
    };

    // Store message in hash
    const messageKey = this.sessionKey(sessionId, 'msgs', msgId);
    await this.redis.hset(messageKey, {
      data: JSON.stringify(fullMessage),
      timestamp: String(timestamp),
    });

    // Add to stream for consumption
    const streamKey = this.sessionKey(sessionId, 'stream');
    await this.redis.xadd(streamKey, '*', 'msgId', msgId, 'data', JSON.stringify(fullMessage));

    // Publish for real-time subscribers
    const pubChannel = this.sessionKey(sessionId, 'pub');
    await this.redis.publish(pubChannel, JSON.stringify({ type: 'new', message: fullMessage }));

    return msgId;
  }

  async *subscribeMessages(sessionId: string): AsyncIterable<MessageEvent> {
    const emitter = new EventEmitter();
    this.emitters.set(sessionId, emitter);

    const pubChannel = this.sessionKey(sessionId, 'pub');

    // Subscribe to channel
    await this.subscriber.subscribe(pubChannel);

    const messageHandler = (channel: string, message: string) => {
      if (channel === pubChannel) {
        try {
          const event = JSON.parse(message) as MessageEvent;
          emitter.emit('message', event);
        } catch {
          // Ignore malformed messages
        }
      }
    };

    this.subscriber.on('message', messageHandler);

    // Yield events
    try {
      while (true) {
        const event = await new Promise<MessageEvent | null>((resolve) => {
          const handler = (event: MessageEvent) => {
            emitter.removeListener('message', handler);
            emitter.removeListener('close', closeHandler);
            resolve(event);
          };
          const closeHandler = () => {
            emitter.removeListener('message', handler);
            resolve(null);
          };
          emitter.once('message', handler);
          emitter.once('close', closeHandler);
        });

        if (event === null) break;
        yield event;
      }
    } finally {
      this.subscriber.off('message', messageHandler);
      await this.subscriber.unsubscribe(pubChannel);
      this.emitters.delete(sessionId);
    }
  }

  unsubscribeMessages(sessionId: string): void {
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.emit('close');
      this.emitters.delete(sessionId);
    }
  }

  async getMessage(sessionId: string, messageId: string): Promise<AgentMessage | null> {
    const messageKey = this.sessionKey(sessionId, 'msgs', messageId);
    const data = await this.redis.hget(messageKey, 'data');
    if (!data) return null;
    return JSON.parse(data) as AgentMessage;
  }

  async listMessages(sessionId: string, filter?: MessageFilter): Promise<AgentMessage[]> {
    // Get all message keys for session
    const pattern = this.sessionKey(sessionId, 'msgs', '*');
    const keys = await this.redis.keys(pattern);

    const messages: AgentMessage[] = [];

    for (const key of keys) {
      const data = await this.redis.hget(key, 'data');
      if (!data) continue;

      const message = JSON.parse(data) as AgentMessage;

      // Apply filters
      if (filter?.type && message.type !== filter.type) continue;
      if (filter?.from && message.from !== filter.from) continue;
      if (filter?.to && message.to !== filter.to) continue;

      messages.push(message);
    }

    // Sort by timestamp descending
    messages.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    if (filter?.limit) {
      return messages.slice(0, filter.limit);
    }

    return messages;
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<boolean> {
    const messageKey = this.sessionKey(sessionId, 'msgs', messageId);
    const deleted = await this.redis.del(messageKey);
    return deleted > 0;
  }

  // ─────────────────────────────────────────────────────────────
  // Queue Operations (using Redis Streams)
  // ─────────────────────────────────────────────────────────────

  async queueInsert(
    sessionId: string,
    message: AgentMessage,
    sourceFile?: string
  ): Promise<string | null> {
    // Check for duplicate via source file
    if (sourceFile) {
      const dedupKey = this.sessionKey(sessionId, 'dedup', sourceFile);
      const exists = await this.redis.exists(dedupKey);
      if (exists) return null;
      await this.redis.setex(dedupKey, 3600, '1'); // 1 hour TTL
    }

    const entryId = randomUUID();
    const streamKey = this.sessionKey(sessionId, 'queue', message.to);

    // Create consumer group if not exists
    try {
      await this.redis.xgroup('CREATE', streamKey, 'workers', '0', 'MKSTREAM');
    } catch (err) {
      // Group already exists - that's fine
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) {
        throw err;
      }
    }

    // Add to stream
    await this.redis.xadd(
      streamKey,
      '*',
      'id',
      entryId,
      'data',
      JSON.stringify(message),
      'sourceFile',
      sourceFile || '',
      'status',
      'pending',
      'createdAt',
      String(Date.now())
    );

    return entryId;
  }

  async queuePoll(sessionId: string, recipient: string): Promise<QueueEntry[]> {
    const streamKey = this.sessionKey(sessionId, 'queue', recipient);

    // Read from consumer group
    const results = await this.redis.xreadgroup(
      'GROUP',
      'workers',
      this.consumerName,
      'COUNT',
      100,
      'STREAMS',
      streamKey,
      '>'
    );

    if (!results || (results as unknown[]).length === 0) return [];

    const entries: QueueEntry[] = [];
    const idsToAck: string[] = [];

    // Type the results as array of [streamName, messages] tuples
    type StreamResult = [string, Array<[string, string[]]>];
    for (const [, messages] of results as StreamResult[]) {
      for (const [streamId, fields] of messages as Array<[string, string[]]>) {
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]] = fields[i + 1];
        }

        entries.push({
          id: data.id || streamId,
          message: JSON.parse(data.data) as AgentMessage,
          status: 'delivered',
          sourceFile: data.sourceFile || undefined,
          createdAt: parseInt(data.createdAt, 10),
          deliveredAt: Date.now(),
        });

        idsToAck.push(streamId);
      }
    }

    // Acknowledge processed messages
    if (idsToAck.length > 0) {
      await this.redis.xack(streamKey, 'workers', ...idsToAck);
    }

    return entries;
  }

  async queuePollOne(sessionId: string, recipient: string): Promise<QueueEntry | null> {
    const streamKey = this.sessionKey(sessionId, 'queue', recipient);

    const results = await this.redis.xreadgroup(
      'GROUP',
      'workers',
      this.consumerName,
      'COUNT',
      1,
      'STREAMS',
      streamKey,
      '>'
    );

    if (!results || results.length === 0) return null;

    const [[, messages]] = results as Array<[string, Array<[string, string[]]>]>;
    if (messages.length === 0) return null;

    const [streamId, fields] = messages[0];
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    // Acknowledge
    await this.redis.xack(streamKey, 'workers', streamId);

    return {
      id: data.id || streamId,
      message: JSON.parse(data.data) as AgentMessage,
      status: 'delivered',
      sourceFile: data.sourceFile || undefined,
      createdAt: parseInt(data.createdAt, 10),
      deliveredAt: Date.now(),
    };
  }

  async queuePeek(sessionId: string, recipient: string): Promise<QueueEntry[]> {
    const streamKey = this.sessionKey(sessionId, 'queue', recipient);

    // Read pending entries (without consuming)
    const results = await this.redis.xpending(streamKey, 'workers', '-', '+', 100);

    if (!results || results.length === 0) return [];

    // For peek, we just return the count - full data requires xrange
    const entries: QueueEntry[] = [];

    // Use xrange to get actual data
    const rangeResults = await this.redis.xrange(streamKey, '-', '+', 'COUNT', 100);

    for (const [streamId, fields] of rangeResults) {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }

      if (data.status === 'pending') {
        entries.push({
          id: data.id || streamId,
          message: JSON.parse(data.data) as AgentMessage,
          status: 'pending',
          sourceFile: data.sourceFile || undefined,
          createdAt: parseInt(data.createdAt, 10),
        });
      }
    }

    return entries;
  }

  async queueQuery(sessionId: string, filter?: MessageFilter): Promise<QueueEntry[]> {
    // For querying, scan all recipient queues
    const pattern = this.sessionKey(sessionId, 'queue', '*');
    const streamKeys = await this.redis.keys(pattern);

    const entries: QueueEntry[] = [];

    for (const streamKey of streamKeys) {
      const results = await this.redis.xrange(streamKey, '-', '+', 'COUNT', filter?.limit || 100);

      for (const [streamId, fields] of results) {
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]] = fields[i + 1];
        }

        const message = JSON.parse(data.data) as AgentMessage;

        // Apply filters
        if (filter?.type && message.type !== filter.type) continue;
        if (filter?.from && message.from !== filter.from) continue;
        if (filter?.to && message.to !== filter.to) continue;
        if (filter?.status && data.status !== filter.status) continue;

        entries.push({
          id: data.id || streamId,
          message,
          status: data.status as 'pending' | 'delivered' | 'failed',
          sourceFile: data.sourceFile || undefined,
          createdAt: parseInt(data.createdAt, 10),
          deliveredAt: data.deliveredAt ? parseInt(data.deliveredAt, 10) : undefined,
        });
      }
    }

    // Sort by createdAt descending
    entries.sort((a, b) => b.createdAt - a.createdAt);

    // Apply limit
    if (filter?.limit) {
      return entries.slice(0, filter.limit);
    }

    return entries;
  }

  async queueMarkProcessed(sessionId: string, entryId: string | number): Promise<void> {
    // In Redis Streams, acknowledging handles this
    // The entry is already acked in queuePoll/queuePollOne
    // This is a no-op for Redis but kept for interface compatibility
  }

  async queueStats(
    sessionId: string
  ): Promise<{ pending: number; delivered: number; total: number; byAgent: Record<string, number> }> {
    const pattern = this.sessionKey(sessionId, 'queue', '*');
    const streamKeys = await this.redis.keys(pattern);

    let pending = 0;
    let total = 0;
    const byAgent: Record<string, number> = {};

    for (const streamKey of streamKeys) {
      const info = await this.redis.xinfo('STREAM', streamKey) as unknown[];
      const infoObj: Record<string, unknown> = {};
      for (let i = 0; i < info.length; i += 2) {
        infoObj[info[i] as string] = info[i + 1];
      }

      const length = infoObj.length as number;
      total += length;

      // Get pending count from consumer group
      try {
        const groups = (await this.redis.xinfo('GROUPS', streamKey)) as unknown[];
        for (const group of groups) {
          const groupArr = group as unknown[];
          const groupObj: Record<string, unknown> = {};
          for (let i = 0; i < groupArr.length; i += 2) {
            groupObj[groupArr[i] as string] = groupArr[i + 1];
          }
          pending += groupObj.pending as number;
        }
      } catch {
        // No consumer groups yet
      }

      // Extract agent from key
      const agent = streamKey.split(':').pop() || '';
      byAgent[agent] = length;
    }

    return {
      pending,
      delivered: total - pending,
      total,
      byAgent,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Session Operations
  // ─────────────────────────────────────────────────────────────

  async createSession(meshId: string, tenantId?: string): Promise<SessionState> {
    const sessionId = randomUUID();
    const now = Date.now();

    const session: SessionState = {
      sessionId,
      agentId: '',
      meshId,
      tenantId,
      status: 'active',
      createdAt: now,
      lastActivityAt: now,
    };

    const sessionKey = this.sessionKey(sessionId, 'meta');
    await this.redis.hset(sessionKey, {
      meshId,
      tenantId: tenantId || '',
      status: 'active',
      createdAt: String(now),
      lastActivityAt: String(now),
    });

    // Index by tenant
    if (tenantId) {
      const tenantKey = this.key('tenant', tenantId, 'sessions');
      await this.redis.sadd(tenantKey, sessionId);
    }

    return session;
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    const sessionKey = this.sessionKey(sessionId, 'meta');
    const data = await this.redis.hgetall(sessionKey);

    if (!data || Object.keys(data).length === 0) return null;

    return {
      sessionId,
      agentId: '',
      meshId: data.meshId,
      tenantId: data.tenantId || undefined,
      status: data.status as 'active' | 'hibernated' | 'destroyed',
      createdAt: parseInt(data.createdAt, 10),
      lastActivityAt: parseInt(data.lastActivityAt, 10),
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    };
  }

  async updateSession(sessionId: string, updates: Partial<SessionState>): Promise<void> {
    const sessionKey = this.sessionKey(sessionId, 'meta');

    const fields: Record<string, string> = {
      lastActivityAt: String(Date.now()),
    };

    if (updates.status) fields.status = updates.status;
    if (updates.metadata) fields.metadata = JSON.stringify(updates.metadata);

    await this.redis.hset(sessionKey, fields);
  }

  async hibernateSession(sessionId: string): Promise<void> {
    await this.updateSession(sessionId, { status: 'hibernated' });

    // Close emitter
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.emit('close');
      this.emitters.delete(sessionId);
    }

    // Set TTL on session keys for eventual cleanup (7 days)
    const pattern = this.sessionKey(sessionId, '*');
    const keys = await this.redis.keys(pattern);
    for (const key of keys) {
      await this.redis.expire(key, 7 * 24 * 60 * 60);
    }
  }

  async resumeSession(sessionId: string): Promise<SessionState> {
    await this.updateSession(sessionId, { status: 'active' });

    // Remove TTLs
    const pattern = this.sessionKey(sessionId, '*');
    const keys = await this.redis.keys(pattern);
    for (const key of keys) {
      await this.redis.persist(key);
    }

    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session;
  }

  async destroySession(sessionId: string): Promise<void> {
    // Close emitter
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.emit('close');
      this.emitters.delete(sessionId);
    }

    // Get tenant for cleanup
    const session = await this.getSession(sessionId);
    if (session?.tenantId) {
      const tenantKey = this.key('tenant', session.tenantId, 'sessions');
      await this.redis.srem(tenantKey, sessionId);
    }

    // Delete all session keys
    const pattern = this.sessionKey(sessionId, '*');
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async listSessions(tenantId: string): Promise<SessionState[]> {
    const tenantKey = this.key('tenant', tenantId, 'sessions');
    const sessionIds = await this.redis.smembers(tenantKey);

    const sessions: SessionState[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session) sessions.push(session);
    }

    // Sort by last activity descending
    sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    return sessions;
  }

  // ─────────────────────────────────────────────────────────────
  // Conversation State
  // ─────────────────────────────────────────────────────────────

  async getConversationId(sessionId: string, agentId: string): Promise<string | null> {
    const key = this.sessionKey(sessionId, 'conv', agentId);
    return await this.redis.get(key);
  }

  async setConversationId(sessionId: string, agentId: string, conversationId: string): Promise<void> {
    const key = this.sessionKey(sessionId, 'conv', agentId);
    await this.redis.set(key, conversationId);
  }

  async clearConversationId(sessionId: string, agentId: string): Promise<void> {
    const key = this.sessionKey(sessionId, 'conv', agentId);
    await this.redis.del(key);
  }
}

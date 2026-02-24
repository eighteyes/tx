/**
 * StorageProvider Interface
 *
 * Abstracts storage operations for tx-server to support multiple backends:
 * - LocalStorageProvider: File-based (dev mode, current behavior)
 * - RedisStorageProvider: Redis Streams + Redis hashes (production)
 *
 * Responsibilities:
 * - Message persistence and retrieval
 * - Message subscription (file watch or pub/sub)
 * - Queue operations (insert, poll, query)
 * - Session state management
 */

/**
 * Message structure for inter-agent communication
 */
export interface AgentMessage {
  id?: string;
  from: string;
  to: string;
  type: string;
  body: string;
  headline?: string;
  msgId?: string;
  refMsgId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Queue entry (enriched message with queue metadata)
 */
export interface QueueEntry {
  id: number | string;
  message: AgentMessage;
  status: 'pending' | 'delivered' | 'failed';
  sourceFile?: string;
  createdAt: number;
  deliveredAt?: number;
}

/**
 * Session state for an agent
 */
export interface SessionState {
  sessionId: string;
  agentId: string;
  meshId: string;
  tenantId?: string;
  conversationId?: string;
  status: 'active' | 'hibernated' | 'destroyed';
  createdAt: number;
  lastActivityAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Filter options for querying messages
 */
export interface MessageFilter {
  type?: string;
  from?: string;
  to?: string;
  status?: 'pending' | 'delivered' | 'failed';
  sinceId?: number | string;
  limit?: number;
}

/**
 * Message event emitted by subscription
 */
export interface MessageEvent {
  type: 'new' | 'revision';
  message: AgentMessage;
  filepath?: string;
}

/**
 * Storage provider interface
 * Implementations: LocalStorageProvider, RedisStorageProvider
 */
export interface StorageProvider {
  /**
   * Initialize the storage provider
   */
  init(): Promise<void>;

  /**
   * Shutdown and cleanup resources
   */
  close(): Promise<void>;

  // ─────────────────────────────────────────────────────────────
  // Message Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Write a message to storage
   * In local mode: writes .md file to msgs directory
   * In Redis mode: publishes to stream
   */
  writeMessage(sessionId: string, message: AgentMessage): Promise<string>;

  /**
   * Subscribe to new messages for a session
   * Returns async iterator that yields message events
   */
  subscribeMessages(sessionId: string): AsyncIterable<MessageEvent>;

  /**
   * Unsubscribe from messages for a session (closes watcher, stops iterator)
   */
  unsubscribeMessages(sessionId: string): void;

  /**
   * Read a specific message by ID
   */
  getMessage(sessionId: string, messageId: string): Promise<AgentMessage | null>;

  /**
   * List messages with optional filtering
   */
  listMessages(sessionId: string, filter?: MessageFilter): Promise<AgentMessage[]>;

  /**
   * Delete a message
   */
  deleteMessage(sessionId: string, messageId: string): Promise<boolean>;

  // ─────────────────────────────────────────────────────────────
  // Queue Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Insert message into queue
   * Returns queue entry ID, or null if duplicate
   */
  queueInsert(sessionId: string, message: AgentMessage, sourceFile?: string): Promise<string | null>;

  /**
   * Poll messages for a recipient (consumes them)
   */
  queuePoll(sessionId: string, recipient: string): Promise<QueueEntry[]>;

  /**
   * Poll single message for a recipient (consumes it)
   */
  queuePollOne(sessionId: string, recipient: string): Promise<QueueEntry | null>;

  /**
   * Peek at pending messages without consuming
   */
  queuePeek(sessionId: string, recipient: string): Promise<QueueEntry[]>;

  /**
   * Query messages with filters
   */
  queueQuery(sessionId: string, filter?: MessageFilter): Promise<QueueEntry[]>;

  /**
   * Mark message as processed
   */
  queueMarkProcessed(sessionId: string, entryId: string | number): Promise<void>;

  /**
   * Get queue statistics
   */
  queueStats(sessionId: string): Promise<{
    pending: number;
    delivered: number;
    total: number;
    byAgent: Record<string, number>;
  }>;

  // ─────────────────────────────────────────────────────────────
  // Session Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new session
   */
  createSession(meshId: string, tenantId?: string): Promise<SessionState>;

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Promise<SessionState | null>;

  /**
   * Update session state
   */
  updateSession(sessionId: string, updates: Partial<SessionState>): Promise<void>;

  /**
   * Hibernate session (move to cold storage)
   */
  hibernateSession(sessionId: string): Promise<void>;

  /**
   * Resume hibernated session
   */
  resumeSession(sessionId: string): Promise<SessionState>;

  /**
   * Destroy session and cleanup
   */
  destroySession(sessionId: string): Promise<void>;

  /**
   * List sessions by tenant
   */
  listSessions(tenantId: string): Promise<SessionState[]>;

  // ─────────────────────────────────────────────────────────────
  // Conversation State (for Claude SDK resume)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get stored conversation ID for an agent
   */
  getConversationId(sessionId: string, agentId: string): Promise<string | null>;

  /**
   * Store conversation ID for an agent
   */
  setConversationId(sessionId: string, agentId: string, conversationId: string): Promise<void>;

  /**
   * Clear conversation ID for an agent
   */
  clearConversationId(sessionId: string, agentId: string): Promise<void>;
}

/**
 * Configuration for storage providers
 */
export interface StorageConfig {
  type: 'local' | 'redis';

  // Local-specific config
  baseDir?: string;  // Base directory for file storage

  // Redis-specific config
  redisUrl?: string;
  redisPrefix?: string;  // Key prefix for namespacing
}

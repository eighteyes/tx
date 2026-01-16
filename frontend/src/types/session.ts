/**
 * Session types for tx-web-platform interactive sessions
 */

/**
 * Session status values
 */
export type SessionStatus = 'active' | 'hibernated';

/**
 * Session configuration
 */
export interface SessionConfig {
  meshId: string;
  entryAgent: string;
  ttlSeconds: number;
}

/**
 * Session information returned by the API
 */
export interface SessionInfo {
  sessionId: string;
  meshId: string;
  status: SessionStatus;
  createdAt: string;
  lastActivityAt: string;
  config: SessionConfig;
}

/**
 * Message exchanged between agents in a session
 */
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  body: string;
  headline?: string;
  timestamp: number;
}

/**
 * Message event for real-time updates
 */
export type MessageEvent = {
  type: 'new' | 'revision';
  message: AgentMessage;
};

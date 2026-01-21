/**
 * Session Awareness - Type Definitions
 *
 * Core types for tracking and searching agent sessions
 */

/**
 * Session metadata stored in the database
 */
export interface SessionMetadata {
  id: string;
  agentId: string;
  meshId: string;
  startedAt: number;
  endedAt?: number;
  durationSeconds?: number;
  transcriptPath: string;
  messageCount?: number;
  toolCalls?: number;
  finalStatus?: 'success' | 'error' | 'abandoned';
  headline?: string;
  tags?: string[];
  createdAt: number;
}

/**
 * Search result with optional relevance data
 */
export interface SessionSearchResult extends SessionMetadata {
  snippet?: string;
  score?: number;
}

/**
 * Types of summaries that can be cached
 */
export type SummaryType = 'summary' | 'final-answer' | 'full' | 'split-summary';

/**
 * Cached session summary for quick retrieval
 */
export interface CachedSummary {
  sessionId: string;
  summaryType: SummaryType;
  content: string;
  generatedAt: number;
}

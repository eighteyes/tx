import axios from 'axios';

const API_BASE = '/v1';

/**
 * Session summary for listing
 */
export interface SessionSummary {
  sessionId: string;
  meshId: string;
  status: 'active' | 'completed' | 'failed';
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  artifacts?: string[];
}

/**
 * Sessions listing response
 */
export interface SessionsListing {
  sessions: SessionSummary[];
  total: number;
}

/**
 * Session artifact
 */
export interface SessionArtifact {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

/**
 * Sessions filter options
 */
export interface SessionsFilter {
  meshId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const sessionsListAPI = {
  /**
   * List all sessions with optional filters
   * @param filter - Filter options
   */
  async listSessions(filter: SessionsFilter = {}): Promise<SessionsListing> {
    const response = await axios.get(`${API_BASE}/sessions-list`, {
      params: filter,
    });
    return response.data;
  },

  /**
   * Get artifacts for a specific session
   * @param sessionId - Session identifier
   */
  async getSessionArtifacts(sessionId: string): Promise<SessionArtifact[]> {
    const response = await axios.get(`${API_BASE}/sessions-list/${sessionId}/artifacts`);
    return response.data.artifacts;
  },
};

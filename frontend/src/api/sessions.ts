import axios from 'axios';
import type { SessionInfo, AgentMessage } from '../types/session';

const API_BASE = '/v1';

export const sessionAPI = {
  /**
   * Create a new session for a mesh
   * @param meshId - The mesh identifier to create a session for
   * @param entryAgent - Optional entry agent override
   * @returns The created session information
   */
  async createSession(meshId: string, entryAgent?: string): Promise<SessionInfo> {
    const response = await axios.post(`${API_BASE}/sessions`, {
      meshId,
      entryAgent,
    });
    return response.data;
  },

  /**
   * Get session information by ID
   * @param sessionId - The session identifier
   * @returns Session information
   */
  async getSession(sessionId: string): Promise<SessionInfo> {
    const response = await axios.get(`${API_BASE}/sessions/${sessionId}`);
    return response.data;
  },

  /**
   * Send a message to a session
   * @param sessionId - The session identifier
   * @param body - The message body content
   * @param to - Optional target agent
   * @returns The message ID and created message
   */
  async sendMessage(
    sessionId: string,
    body: string,
    to?: string
  ): Promise<{ msgId: string; message: AgentMessage }> {
    const response = await axios.post(`${API_BASE}/sessions/${sessionId}/messages`, {
      body,
      to,
    });
    return response.data;
  },

  /**
   * List messages for a session
   * @param sessionId - The session identifier
   * @param limit - Maximum number of messages to return (default: 50)
   * @returns Array of agent messages
   */
  async listMessages(sessionId: string, limit = 50): Promise<AgentMessage[]> {
    const response = await axios.get(`${API_BASE}/sessions/${sessionId}/messages`, {
      params: { limit },
    });
    return response.data.messages || [];
  },

  /**
   * Destroy a session
   * @param sessionId - The session identifier to destroy
   */
  async destroySession(sessionId: string): Promise<void> {
    await axios.delete(`${API_BASE}/sessions/${sessionId}`);
  },
};

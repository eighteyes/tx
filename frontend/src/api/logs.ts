import axios from 'axios';

const API_BASE = '/v1';

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Logs listing response
 */
export interface LogsListing {
  entries: LogEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * Logs filter options
 */
export interface LogsFilter {
  level?: string;
  component?: string;
  search?: string;
  limit?: number;
  offset?: number;
  last?: boolean;
}

export const logsAPI = {
  /**
   * List log entries with optional filters
   * @param filter - Filter options
   */
  async listLogs(filter: LogsFilter = {}): Promise<LogsListing> {
    const response = await axios.get(`${API_BASE}/logs`, {
      params: {
        ...filter,
        last: filter.last ? 'true' : undefined,
      },
    });
    return response.data;
  },

  /**
   * Get list of unique components
   */
  async getComponents(): Promise<string[]> {
    const response = await axios.get(`${API_BASE}/logs/components`);
    return response.data.components;
  },

  /**
   * Clear all log files
   */
  async clearLogs(): Promise<void> {
    await axios.delete(`${API_BASE}/logs`);
  },
};

import axios from 'axios';

const API_BASE = '/v1';

/**
 * Server mode information
 */
export interface ServerMode {
  mode: 'full' | 'no-db';
  features: {
    sessions: boolean;
    workers: boolean;
    stats: boolean;
    meshCrud: boolean;
    workspace: boolean;
    logs: boolean;
    coreAgent: boolean;
  };
}

/**
 * System statistics
 */
export interface SystemStats {
  uptime: number;
  memory: {
    total: number;
    used: number;
    free: number;
  };
  cpu: {
    cores: number;
    model: string;
  };
  platform: string;
  nodeVersion: string;
}

/**
 * Mesh statistics
 */
export interface MeshStats {
  total: number;
  meshes: Array<{
    name: string;
    agents: number;
  }>;
}

/**
 * Session statistics
 */
export interface SessionStats {
  active: number;
  completed: number;
  failed: number;
  total: number;
}

/**
 * Recent activity item
 */
export interface ActivityItem {
  timestamp: string;
  type: string;
  description: string;
}

/**
 * Dashboard statistics
 */
export interface DashboardStats {
  server?: ServerMode;
  system: SystemStats;
  meshes: MeshStats;
  sessions: SessionStats;
  recentActivity: ActivityItem[];
}

export const dashboardAPI = {
  /**
   * Get dashboard statistics
   */
  async getStats(): Promise<DashboardStats> {
    const response = await axios.get(`${API_BASE}/dashboard/stats`);
    return response.data;
  },
};

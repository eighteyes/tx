/**
 * Stats Controller
 *
 * Provides system statistics for the dashboard.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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
 * Dashboard statistics
 */
export interface DashboardStats {
  system: SystemStats;
  meshes: MeshStats;
  sessions: SessionStats;
  recentActivity: Array<{
    timestamp: string;
    type: string;
    description: string;
  }>;
}

/**
 * Stats Controller class
 */
export class StatsController {
  private workDir: string;
  private meshesDir: string;

  constructor(workDir: string, meshesDir: string) {
    this.workDir = workDir;
    this.meshesDir = meshesDir;
  }

  /**
   * Get system statistics
   */
  async getSystemStats(): Promise<SystemStats> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();

    return {
      uptime: os.uptime(),
      memory: {
        total: totalMem,
        used: totalMem - freeMem,
        free: freeMem,
      },
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model || 'Unknown',
      },
      platform: os.platform(),
      nodeVersion: process.version,
    };
  }

  /**
   * Get mesh statistics
   */
  async getMeshStats(): Promise<MeshStats> {
    try {
      const entries = await fs.readdir(this.meshesDir, { withFileTypes: true });
      const meshes: Array<{ name: string; agents: number }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const configPath = path.join(this.meshesDir, entry.name, 'config.yaml');
        try {
          const content = await fs.readFile(configPath, 'utf-8');
          // Simple regex to count agents
          const agentsMatch = content.match(/agents:/);
          let agentCount = 0;
          if (agentsMatch) {
            // Count indented items after agents:
            const lines = content.split('\n');
            let inAgents = false;
            for (const line of lines) {
              if (line.match(/^agents:/)) {
                inAgents = true;
                continue;
              }
              if (inAgents && line.match(/^  - /)) {
                agentCount++;
              } else if (inAgents && line.match(/^[a-z]/)) {
                break;
              }
            }
          }

          meshes.push({ name: entry.name, agents: agentCount || 1 });
        } catch {
          // Try JSON
          const jsonPath = path.join(this.meshesDir, entry.name, 'config.json');
          try {
            const content = await fs.readFile(jsonPath, 'utf-8');
            const config = JSON.parse(content);
            meshes.push({
              name: entry.name,
              agents: Array.isArray(config.agents) ? config.agents.length : 1,
            });
          } catch {
            // Skip this mesh
          }
        }
      }

      return {
        total: meshes.length,
        meshes,
      };
    } catch {
      return { total: 0, meshes: [] };
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<SessionStats> {
    const sessionsDir = path.join(this.workDir, '.ai/tx/sessions');

    try {
      await fs.access(sessionsDir);
    } catch {
      return { active: 0, completed: 0, failed: 0, total: 0 };
    }

    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      let active = 0;
      let completed = 0;
      let failed = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const metaPath = path.join(sessionsDir, entry.name, 'meta.json');
        try {
          const content = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(content);
          switch (meta.status) {
            case 'active':
              active++;
              break;
            case 'failed':
              failed++;
              break;
            default:
              completed++;
          }
        } catch {
          completed++; // Assume completed if no meta
        }
      }

      return {
        active,
        completed,
        failed,
        total: active + completed + failed,
      };
    } catch {
      return { active: 0, completed: 0, failed: 0, total: 0 };
    }
  }

  /**
   * Get recent activity from logs
   */
  async getRecentActivity(limit: number = 10): Promise<DashboardStats['recentActivity']> {
    const logPath = path.join(this.workDir, '.ai/tx/logs/v4.jsonl');

    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);

      // Get last N lines
      const recentLines = lines.slice(-limit * 2);
      const activity: DashboardStats['recentActivity'] = [];

      for (const line of recentLines.reverse()) {
        try {
          const entry = JSON.parse(line);
          // Filter for interesting events
          if (
            entry.component === 'worker' ||
            entry.component === 'session' ||
            entry.component === 'dispatcher' ||
            entry.level === 'error'
          ) {
            activity.push({
              timestamp: entry.timestamp,
              type: entry.component,
              description: entry.message,
            });

            if (activity.length >= limit) break;
          }
        } catch {
          // Skip invalid JSON
        }
      }

      return activity;
    } catch {
      return [];
    }
  }

  /**
   * Get complete dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const [system, meshes, sessions, recentActivity] = await Promise.all([
      this.getSystemStats(),
      this.getMeshStats(),
      this.getSessionStats(),
      this.getRecentActivity(),
    ]);

    return {
      system,
      meshes,
      sessions,
      recentActivity,
    };
  }
}

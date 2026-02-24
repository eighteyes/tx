/**
 * Sessions Controller
 *
 * Handles listing all sessions across meshes for the web dashboard.
 * Provides APIs for viewing session history and artifacts.
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../shared/logger.ts';

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
  workspace?: string;
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

/**
 * Sessions Controller class
 *
 * Provides methods for managing session views:
 * - listSessions: Get all sessions across meshes
 * - getSessionArtifacts: Get files created by a session
 */
export class SessionsController {
  private sessionsDir: string;
  private outputDir: string;

  constructor(workDir: string) {
    this.sessionsDir = path.join(workDir, '.ai/tx/sessions');
    this.outputDir = path.join(workDir, '.ai/output');
  }

  /**
   * List all sessions with optional filters
   *
   * @param filter - Filter options
   * @returns Paginated session summaries
   */
  async listSessions(filter: SessionsFilter = {}): Promise<SessionsListing> {
    const { meshId, status, limit = 50, offset = 0 } = filter;

    try {
      // Check if sessions directory exists
      try {
        await fs.access(this.sessionsDir);
      } catch {
        return { sessions: [], total: 0 };
      }

      const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true });
      const sessions: SessionSummary[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const sessionId = entry.name;
        const sessionPath = path.join(this.sessionsDir, sessionId);

        try {
          // Read session metadata
          const metaPath = path.join(sessionPath, 'meta.json');
          let meta: {
            meshId?: string;
            status?: string;
            createdAt?: string;
            lastActivityAt?: string;
            workspace?: string;
          } = {};

          try {
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            meta = JSON.parse(metaContent);
          } catch {
            // No meta file, try to infer from directory
          }

          // Count messages
          const msgsPath = path.join(sessionPath, 'msgs');
          let messageCount = 0;
          try {
            const msgEntries = await fs.readdir(msgsPath);
            messageCount = msgEntries.filter(f => f.endsWith('.md') || f.endsWith('.json')).length;
          } catch {
            // No messages directory
          }

          // Check for artifacts
          const artifactsPath = path.join(this.outputDir, sessionId);
          let artifacts: string[] = [];
          try {
            const artifactEntries = await fs.readdir(artifactsPath);
            artifacts = artifactEntries.slice(0, 5); // First 5 artifact names
          } catch {
            // No artifacts
          }

          // Get directory stats for timestamps
          const dirStat = await fs.stat(sessionPath);

          const session: SessionSummary = {
            sessionId,
            meshId: meta.meshId || 'unknown',
            status: (meta.status as 'active' | 'completed' | 'failed') || 'completed',
            createdAt: meta.createdAt || dirStat.birthtime.toISOString(),
            lastActivityAt: meta.lastActivityAt || dirStat.mtime.toISOString(),
            messageCount,
            artifacts: artifacts.length > 0 ? artifacts : undefined,
            workspace: meta.workspace || undefined,
          };

          sessions.push(session);
        } catch (error) {
          log.debug('sessions-controller', `Failed to read session ${sessionId}`, {
            error: (error as Error).message,
          });
        }
      }

      // Apply filters
      let filtered = sessions;

      if (meshId) {
        filtered = filtered.filter(s => s.meshId === meshId);
      }

      if (status) {
        filtered = filtered.filter(s => s.status === status);
      }

      // Sort by lastActivityAt descending (most recent first)
      filtered.sort(
        (a, b) =>
          new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
      );

      const total = filtered.length;

      // Apply pagination
      const paginated = filtered.slice(offset, offset + limit);

      return {
        sessions: paginated,
        total,
      };
    } catch (error) {
      log.error('sessions-controller', 'Failed to list sessions', {
        error: (error as Error).message,
      });
      return { sessions: [], total: 0 };
    }
  }

  /**
   * Get artifacts for a specific session
   *
   * @param sessionId - Session identifier
   * @returns Array of session artifacts
   */
  async getSessionArtifacts(sessionId: string): Promise<SessionArtifact[]> {
    const artifactsPath = path.join(this.outputDir, sessionId);

    try {
      await fs.access(artifactsPath);
    } catch {
      return [];
    }

    const entries = await fs.readdir(artifactsPath, { withFileTypes: true });
    const artifacts: SessionArtifact[] = [];

    for (const entry of entries) {
      const entryPath = path.join(artifactsPath, entry.name);

      try {
        const stat = await fs.stat(entryPath);

        artifacts.push({
          name: entry.name,
          path: path.join(sessionId, entry.name),
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      } catch {
        // Skip entries we can't stat
      }
    }

    // Sort: directories first, then alphabetically
    return artifacts.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
}

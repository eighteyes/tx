/**
 * Logs Controller
 *
 * Handles reading and streaming system logs for the web dashboard.
 */

import fs from 'fs/promises';
import path from 'path';

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
  last?: boolean; // Use last session's logs
}

/**
 * Read JSONL log file and parse entries
 */
async function readJSONLFile(filePath: string): Promise<LogEntry[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry): entry is LogEntry => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Logs Controller class
 *
 * Provides methods for reading and filtering logs:
 * - listLogs: Get paginated log entries with filters
 * - getComponents: Get list of unique components
 * - clearLogs: Clear all log files
 */
export class LogsController {
  private logsDir: string;

  constructor(workDir: string) {
    this.logsDir = path.join(workDir, '.ai/tx/logs');
  }

  /**
   * List log entries with optional filters
   *
   * @param filter - Filter options
   * @returns Paginated log entries
   */
  async listLogs(filter: LogsFilter = {}): Promise<LogsListing> {
    const { level, component, search, limit = 100, offset = 0, last = false } = filter;

    const logSuffix = last ? '.last.jsonl' : '.jsonl';

    // Read all log files
    const [v4Logs, debugLogs, errorLogs] = await Promise.all([
      readJSONLFile(path.join(this.logsDir, `v4${logSuffix}`)),
      readJSONLFile(path.join(this.logsDir, `debug${logSuffix}`)),
      readJSONLFile(path.join(this.logsDir, `error${logSuffix}`)),
    ]);

    // Merge and sort by timestamp
    let allLogs = [...v4Logs, ...debugLogs, ...errorLogs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Apply filters
    if (level) {
      allLogs = allLogs.filter(log => log.level === level);
    }

    if (component) {
      allLogs = allLogs.filter(log => log.component.includes(component));
    }

    if (search) {
      const searchLower = search.toLowerCase();
      allLogs = allLogs.filter(
        log =>
          log.message.toLowerCase().includes(searchLower) ||
          log.component.toLowerCase().includes(searchLower)
      );
    }

    const total = allLogs.length;

    // Apply pagination (from end of array for newest first)
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedLogs = allLogs.slice(startIndex, endIndex).reverse();

    return {
      entries: paginatedLogs,
      total,
      hasMore: startIndex > 0,
    };
  }

  /**
   * Get list of unique components from logs
   *
   * @returns Array of component names
   */
  async getComponents(): Promise<string[]> {
    const { entries } = await this.listLogs({ limit: 1000 });

    const components = new Set<string>();
    entries.forEach(log => components.add(log.component));

    return Array.from(components).sort();
  }

  /**
   * Clear all log files
   */
  async clearLogs(): Promise<void> {
    const files = ['v4.jsonl', 'debug.jsonl', 'error.jsonl'];

    await Promise.all(
      files.map(async file => {
        const filePath = path.join(this.logsDir, file);
        try {
          await fs.writeFile(filePath, '');
        } catch {
          // Ignore errors if file doesn't exist
        }
      })
    );
  }
}

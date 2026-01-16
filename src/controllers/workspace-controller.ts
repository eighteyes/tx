/**
 * Workspace Controller
 *
 * Handles file browser operations for the workspace directory.
 * Provides APIs for listing, reading, and editing workspace files.
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../shared/logger.ts';

/**
 * File/directory entry metadata
 */
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  extension?: string;
}

/**
 * Directory listing response
 */
export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
  parent: string | null;
}

/**
 * File content response
 */
export interface FileContent {
  path: string;
  content: string;
  size: number;
  modified: string;
  language?: string;
}

/**
 * Error thrown when path is not found
 */
export class PathNotFoundError extends Error {
  constructor(filePath: string) {
    super(`Path not found: ${filePath}`);
    this.name = 'PathNotFoundError';
  }
}

/**
 * Error thrown when path is outside workspace
 */
export class PathSecurityError extends Error {
  constructor(filePath: string) {
    super(`Path outside workspace: ${filePath}`);
    this.name = 'PathSecurityError';
  }
}

/**
 * Map file extensions to language identifiers for Monaco editor
 */
function getLanguage(ext: string): string | undefined {
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.css': 'css',
    '.html': 'html',
    '.py': 'python',
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.sql': 'sql',
    '.rs': 'rust',
    '.go': 'go',
    '.rb': 'ruby',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.xml': 'xml',
    '.toml': 'toml',
    '.ini': 'ini',
    '.env': 'plaintext',
    '.txt': 'plaintext',
    '.log': 'plaintext',
  };
  return languageMap[ext.toLowerCase()];
}

/**
 * Workspace Controller class
 *
 * Provides methods for browsing and managing workspace files:
 * - listDirectory: Get directory contents
 * - readFile: Read file content
 * - writeFile: Write file content
 * - createFile: Create new file
 * - createDirectory: Create new directory
 * - deleteEntry: Delete file or directory
 */
export class WorkspaceController {
  constructor(private workspaceRoot: string) {}

  /**
   * Validate and resolve a path within the workspace
   * Prevents path traversal attacks
   */
  private resolvePath(relativePath: string): string {
    // Normalize and resolve the path
    const resolved = path.resolve(this.workspaceRoot, relativePath);

    // Ensure path is within workspace
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new PathSecurityError(relativePath);
    }

    return resolved;
  }

  /**
   * Get relative path from workspace root
   */
  private getRelativePath(absolutePath: string): string {
    return path.relative(this.workspaceRoot, absolutePath);
  }

  /**
   * List directory contents
   *
   * @param dirPath - Relative path from workspace root (empty string for root)
   * @returns Directory listing with entries
   */
  async listDirectory(dirPath: string = ''): Promise<DirectoryListing> {
    const absolutePath = this.resolvePath(dirPath || '.');

    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${dirPath}`);
      }

      const entries = await fs.readdir(absolutePath, { withFileTypes: true });

      const fileEntriesPromises = entries
        .filter(entry => !entry.name.startsWith('.') || entry.name === '.ai')
        .map(async (entry): Promise<FileEntry | null> => {
          const entryPath = path.join(absolutePath, entry.name);
          const relativePath = this.getRelativePath(entryPath);

          try {
            const entryStat = await fs.stat(entryPath);
            const ext = path.extname(entry.name);

            return {
              name: entry.name,
              path: relativePath,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: entryStat.size,
              modified: entryStat.mtime.toISOString(),
              extension: entry.isFile() ? ext : undefined,
            } as FileEntry;
          } catch {
            // Skip entries we can't stat
            return null;
          }
        });

      const fileEntries = await Promise.all(fileEntriesPromises);

      // Filter out nulls and sort: directories first, then alphabetically
      const sortedEntries = fileEntries
        .filter((entry): entry is FileEntry => entry !== null)
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      // Calculate parent path
      const parent = dirPath ? path.dirname(dirPath) || null : null;

      return {
        path: dirPath || '',
        entries: sortedEntries,
        parent,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PathNotFoundError(dirPath);
      }
      throw error;
    }
  }

  /**
   * Read file content
   *
   * @param filePath - Relative path from workspace root
   * @returns File content with metadata
   */
  async readFile(filePath: string): Promise<FileContent> {
    const absolutePath = this.resolvePath(filePath);

    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        throw new Error(`Cannot read directory as file: ${filePath}`);
      }

      // Check file size limit (10MB)
      const maxSize = 10 * 1024 * 1024;
      if (stat.size > maxSize) {
        throw new Error(`File too large: ${stat.size} bytes (max ${maxSize})`);
      }

      const content = await fs.readFile(absolutePath, 'utf-8');
      const ext = path.extname(filePath);

      return {
        path: filePath,
        content,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        language: getLanguage(ext),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PathNotFoundError(filePath);
      }
      throw error;
    }
  }

  /**
   * Write file content
   *
   * @param filePath - Relative path from workspace root
   * @param content - File content to write
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const absolutePath = this.resolvePath(filePath);

    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    await fs.mkdir(parentDir, { recursive: true });

    // Atomic write
    const tmpPath = `${absolutePath}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, absolutePath);

    log.info('workspace-controller', 'File written', { path: filePath });
  }

  /**
   * Create new file
   *
   * @param filePath - Relative path from workspace root
   * @param content - Optional initial content
   */
  async createFile(filePath: string, content: string = ''): Promise<void> {
    const absolutePath = this.resolvePath(filePath);

    // Check if file already exists
    try {
      await fs.access(absolutePath);
      throw new Error(`File already exists: ${filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await this.writeFile(filePath, content);
  }

  /**
   * Create new directory
   *
   * @param dirPath - Relative path from workspace root
   */
  async createDirectory(dirPath: string): Promise<void> {
    const absolutePath = this.resolvePath(dirPath);

    await fs.mkdir(absolutePath, { recursive: true });

    log.info('workspace-controller', 'Directory created', { path: dirPath });
  }

  /**
   * Delete file or directory
   *
   * @param entryPath - Relative path from workspace root
   */
  async deleteEntry(entryPath: string): Promise<void> {
    const absolutePath = this.resolvePath(entryPath);

    try {
      const stat = await fs.stat(absolutePath);

      if (stat.isDirectory()) {
        await fs.rm(absolutePath, { recursive: true });
      } else {
        await fs.unlink(absolutePath);
      }

      log.info('workspace-controller', 'Entry deleted', { path: entryPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PathNotFoundError(entryPath);
      }
      throw error;
    }
  }
}

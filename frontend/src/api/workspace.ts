import axios from 'axios';

const API_BASE = '/v1';

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

export const workspaceAPI = {
  /**
   * List directory contents
   * @param dirPath - Relative path from workspace root (empty for root)
   */
  async listDirectory(dirPath: string = ''): Promise<DirectoryListing> {
    const response = await axios.get(`${API_BASE}/workspace`, {
      params: { path: dirPath },
    });
    return response.data;
  },

  /**
   * Read file content
   * @param filePath - Relative path from workspace root
   */
  async readFile(filePath: string): Promise<FileContent> {
    const response = await axios.get(`${API_BASE}/workspace/file`, {
      params: { path: filePath },
    });
    return response.data;
  },

  /**
   * Write file content
   * @param filePath - Relative path from workspace root
   * @param content - File content
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    await axios.put(`${API_BASE}/workspace/file`, {
      path: filePath,
      content,
    });
  },

  /**
   * Create new file
   * @param filePath - Relative path from workspace root
   * @param content - Optional initial content
   */
  async createFile(filePath: string, content: string = ''): Promise<void> {
    await axios.post(`${API_BASE}/workspace/file`, {
      path: filePath,
      content,
    });
  },

  /**
   * Create new directory
   * @param dirPath - Relative path from workspace root
   */
  async createDirectory(dirPath: string): Promise<void> {
    await axios.post(`${API_BASE}/workspace/directory`, {
      path: dirPath,
    });
  },

  /**
   * Delete file or directory
   * @param entryPath - Relative path from workspace root
   */
  async deleteEntry(entryPath: string): Promise<void> {
    await axios.delete(`${API_BASE}/workspace/entry`, {
      params: { path: entryPath },
    });
  },
};

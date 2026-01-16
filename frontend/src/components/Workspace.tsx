/**
 * Workspace.tsx
 * File browser and editor for the workspace directory.
 */

import { useState, useEffect, useCallback } from 'react';
import { workspaceAPI, type FileEntry, type DirectoryListing, type FileContent } from '../api/workspace';
import './Workspace.css';

// Simple text editor (we could integrate Monaco later)
function FileEditor({
  file,
  onSave,
  onClose,
}: {
  file: FileContent;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const [content, setContent] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);

  useEffect(() => {
    setContent(file.content);
    setModified(false);
  }, [file]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(content);
      setModified(false);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="file-editor">
      <div className="file-editor__header">
        <span className="file-editor__path">
          {file.path}
          {modified && <span className="file-editor__modified">*</span>}
        </span>
        <div className="file-editor__actions">
          <span className="file-editor__language">{file.language || 'text'}</span>
          <button
            className="btn btn--sm btn--primary"
            onClick={handleSave}
            disabled={saving || !modified}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button className="btn btn--sm btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <textarea
        className="file-editor__textarea"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setModified(true);
        }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(entry: FileEntry): string {
  if (entry.type === 'directory') return '📁';

  const iconMap: Record<string, string> = {
    '.ts': '📘',
    '.tsx': '📘',
    '.js': '📒',
    '.jsx': '📒',
    '.json': '📋',
    '.yaml': '📋',
    '.yml': '📋',
    '.md': '📝',
    '.css': '🎨',
    '.html': '🌐',
    '.py': '🐍',
    '.sh': '⚙️',
    '.env': '🔐',
    '.log': '📜',
    '.txt': '📄',
  };

  return iconMap[entry.extension || ''] || '📄';
}

export function Workspace() {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await workspaceAPI.listDirectory(dirPath);
      setListing(data);
      setCurrentPath(dirPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory('');
  }, [loadDirectory]);

  const handleEntryClick = async (entry: FileEntry) => {
    if (entry.type === 'directory') {
      loadDirectory(entry.path);
    } else {
      setLoadingFile(true);
      try {
        const fileContent = await workspaceAPI.readFile(entry.path);
        setSelectedFile(fileContent);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
      } finally {
        setLoadingFile(false);
      }
    }
  };

  const handleNavigateUp = () => {
    if (listing?.parent !== null) {
      loadDirectory(listing?.parent || '');
    }
  };

  const handleSaveFile = async (content: string) => {
    if (!selectedFile) return;
    await workspaceAPI.writeFile(selectedFile.path, content);
    // Refresh to show updated modified time
    const updated = await workspaceAPI.readFile(selectedFile.path);
    setSelectedFile(updated);
  };

  const handleCloseFile = () => {
    setSelectedFile(null);
  };

  const handleRefresh = () => {
    loadDirectory(currentPath);
  };

  // Breadcrumb path parts
  const pathParts = currentPath ? currentPath.split('/') : [];

  return (
    <div className="workspace">
      <div className="workspace__sidebar">
        {/* Toolbar */}
        <div className="workspace__toolbar">
          <h2>Workspace</h2>
          <button
            className="btn btn--icon btn--ghost"
            onClick={handleRefresh}
            title="Refresh"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="workspace__breadcrumb">
          <button
            className={`workspace__breadcrumb-item ${currentPath === '' ? 'workspace__breadcrumb-item--active' : ''}`}
            onClick={() => loadDirectory('')}
          >
            ~
          </button>
          {pathParts.map((part, i) => (
            <span key={i}>
              <span className="workspace__breadcrumb-sep">/</span>
              <button
                className={`workspace__breadcrumb-item ${i === pathParts.length - 1 ? 'workspace__breadcrumb-item--active' : ''}`}
                onClick={() => loadDirectory(pathParts.slice(0, i + 1).join('/'))}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* File List */}
        <div className="workspace__list">
          {loading ? (
            <div className="workspace__loading">Loading...</div>
          ) : error ? (
            <div className="workspace__error">
              <p>{error}</p>
              <button onClick={handleRefresh}>Retry</button>
            </div>
          ) : (
            <>
              {listing?.parent !== null && (
                <div className="workspace__entry workspace__entry--parent" onClick={handleNavigateUp}>
                  <span className="workspace__entry-icon">📁</span>
                  <span className="workspace__entry-name">..</span>
                </div>
              )}
              {listing?.entries.map((entry) => (
                <div
                  key={entry.path}
                  className={`workspace__entry workspace__entry--${entry.type} ${
                    selectedFile?.path === entry.path ? 'workspace__entry--selected' : ''
                  }`}
                  onClick={() => handleEntryClick(entry)}
                >
                  <span className="workspace__entry-icon">{getFileIcon(entry)}</span>
                  <span className="workspace__entry-name">{entry.name}</span>
                  <span className="workspace__entry-meta">
                    {entry.type === 'file' && formatSize(entry.size)}
                  </span>
                </div>
              ))}
              {listing?.entries.length === 0 && (
                <div className="workspace__empty">Empty directory</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Editor Panel */}
      <div className="workspace__editor">
        {loadingFile ? (
          <div className="workspace__editor-loading">Loading file...</div>
        ) : selectedFile ? (
          <FileEditor file={selectedFile} onSave={handleSaveFile} onClose={handleCloseFile} />
        ) : (
          <div className="workspace__editor-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p>Select a file to view or edit</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Workspace;

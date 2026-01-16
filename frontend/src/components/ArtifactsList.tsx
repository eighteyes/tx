/**
 * ArtifactsList.tsx
 * Live list of files created during a session.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessionsListAPI, type SessionArtifact } from '../api/sessionsList';
import './ArtifactsList.css';

interface ArtifactsListProps {
  sessionId: string | null;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(artifact: SessionArtifact): string {
  if (artifact.type === 'directory') return '📁';

  const ext = artifact.name.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    'ts': '📘',
    'tsx': '📘',
    'js': '📒',
    'jsx': '📒',
    'json': '📋',
    'yaml': '📋',
    'yml': '📋',
    'md': '📝',
    'css': '🎨',
    'html': '🌐',
    'py': '🐍',
    'sh': '⚙️',
    'env': '🔐',
    'log': '📜',
    'txt': '📄',
  };

  return iconMap[ext] || '📄';
}

export function ArtifactsList({ sessionId }: ArtifactsListProps) {
  const [artifacts, setArtifacts] = useState<SessionArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!sessionId) {
      setArtifacts([]);
      return;
    }

    let mounted = true;

    const loadArtifacts = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await sessionsListAPI.getSessionArtifacts(sessionId);
        if (mounted) {
          setArtifacts(data);
        }
      } catch (err) {
        if (mounted) {
          // Don't show error if artifacts simply don't exist yet
          const errMsg = err instanceof Error ? err.message : 'Failed to load artifacts';
          if (!errMsg.includes('404') && !errMsg.includes('not found')) {
            setError(errMsg);
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadArtifacts();

    // Poll for new artifacts every 5 seconds
    const interval = setInterval(loadArtifacts, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [sessionId]);

  const handleOpenFile = (path: string) => {
    navigate(`/workspace?path=${encodeURIComponent(path)}`);
  };

  if (!sessionId) {
    return <div className="artifacts-empty">No session active</div>;
  }

  if (loading && artifacts.length === 0) {
    return <div className="artifacts-loading">Loading artifacts...</div>;
  }

  if (error) {
    return <div className="artifacts-error">{error}</div>;
  }

  if (artifacts.length === 0) {
    return <div className="artifacts-empty">No files created yet</div>;
  }

  return (
    <ul className="artifacts-list">
      {artifacts.map((artifact) => (
        <li key={artifact.path} className="artifact-item">
          <span className="artifact-icon">{getFileIcon(artifact)}</span>
          <div className="artifact-info">
            <span className="artifact-name" title={artifact.path}>
              {artifact.name}
            </span>
            <span className="artifact-meta">
              {artifact.type === 'file' && formatSize(artifact.size)}
              {artifact.modified && ` · ${formatTime(artifact.modified)}`}
            </span>
          </div>
          <div className="artifact-actions">
            {artifact.type === 'file' && (
              <>
                <button
                  className="btn btn--ghost btn--xs"
                  onClick={() => handleOpenFile(artifact.path)}
                  title="Open in Workspace"
                >
                  Open
                </button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default ArtifactsList;

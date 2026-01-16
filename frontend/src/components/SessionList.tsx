/**
 * SessionList.tsx
 * Display and manage sessions for a mesh.
 * Responsibilities:
 * - Show list of stored sessions
 * - Create new session button
 * - Resume/delete session actions
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StoredSession } from '../hooks/useSessionStorage';
import './SessionList.css';

interface SessionListProps {
  meshName: string;
  sessions: StoredSession[];
  onCreateNew: () => void;
  onDelete: (sessionId: string) => void;
  loading?: boolean;
}

export function SessionList({
  meshName,
  sessions,
  onCreateNew,
  onDelete,
  loading,
}: SessionListProps) {
  const navigate = useNavigate();

  const handleResume = useCallback(
    (sessionId: string) => {
      navigate(`/meshes/${meshName}/run/${sessionId}`);
    },
    [meshName, navigate]
  );

  const handleDelete = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm('Delete this session? This cannot be undone.')) {
        onDelete(sessionId);
      }
    },
    [onDelete]
  );

  return (
    <div className="session-list">
      <div className="session-list__header">
        <h3>Sessions</h3>
        <button
          className="btn btn--primary btn--sm"
          onClick={onCreateNew}
          disabled={loading}
        >
          {loading ? 'Creating...' : 'New Session'}
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="session-list__empty">
          <p>No sessions yet.</p>
          <p className="hint">Click "New Session" to start.</p>
        </div>
      ) : (
        <ul className="session-list__items">
          {sessions.map(session => (
            <li
              key={session.sessionId}
              className="session-card"
              onClick={() => handleResume(session.sessionId)}
            >
              <div className="session-card__info">
                <span className="session-card__id">
                  {session.sessionId.slice(0, 8)}...
                </span>
                <span className="session-card__time">
                  {formatRelativeTime(session.lastActivityAt)}
                </span>
              </div>
              <button
                className="session-card__delete"
                onClick={(e) => handleDelete(session.sessionId, e)}
                title="Delete session"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Format timestamp as relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default SessionList;

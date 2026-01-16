/**
 * SessionSidebar.tsx
 * Left sidebar for SessionRunner with session info and history.
 * Responsibilities:
 * - Display current session info
 * - Show session list for quick switching
 * - Provide session controls
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionInfo } from '../types/session';
import type { ConnectionStatus } from '../hooks/useWebSocket';
import type { StoredSession } from '../hooks/useSessionStorage';
import './SessionSidebar.css';

interface SessionSidebarProps {
  meshName: string;
  currentSession: SessionInfo | null;
  connectionStatus: ConnectionStatus;
  storedSessions: StoredSession[];
  onNewSession: () => void;
  onStopSession: () => void;
  onDeleteSession: (sessionId: string) => void;
}

export function SessionSidebar({
  meshName,
  currentSession,
  connectionStatus,
  storedSessions,
  onNewSession,
  onStopSession,
  onDeleteSession,
}: SessionSidebarProps) {
  const navigate = useNavigate();

  const statusColor = {
    connected: '#22c55e',
    connecting: '#eab308',
    disconnected: '#ef4444',
  }[connectionStatus];

  const handleSwitchSession = useCallback((sessionId: string) => {
    if (currentSession?.sessionId !== sessionId) {
      navigate(`/meshes/${meshName}/run/${sessionId}`);
    }
  }, [currentSession, meshName, navigate]);

  const handleDeleteClick = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this session from history?')) {
      onDeleteSession(sessionId);
    }
  }, [onDeleteSession]);

  // Filter out current session from history list
  const otherSessions = storedSessions.filter(
    s => s.sessionId !== currentSession?.sessionId
  );

  return (
    <aside className="session-sidebar">
      {/* Current Session Info */}
      <div className="session-sidebar__current">
        <h2 className="session-sidebar__mesh">{meshName}</h2>

        <div className="session-sidebar__status">
          <span
            className="session-sidebar__dot"
            style={{ backgroundColor: statusColor }}
          />
          <span>{connectionStatus}</span>
        </div>

        {currentSession && (
          <div className="session-sidebar__details">
            <div className="session-sidebar__detail">
              <span className="label">Session</span>
              <span className="value monospace">
                {currentSession.sessionId.slice(0, 8)}...
              </span>
            </div>
            <div className="session-sidebar__detail">
              <span className="label">Status</span>
              <span className="value">{currentSession.status}</span>
            </div>
            <div className="session-sidebar__detail">
              <span className="label">Entry</span>
              <span className="value">{currentSession.config.entryAgent}</span>
            </div>
          </div>
        )}

        <div className="session-sidebar__actions">
          <button
            className="btn btn--success btn--block"
            onClick={onNewSession}
          >
            New Session
          </button>
          {currentSession && (
            <button
              className="btn btn--danger btn--block"
              onClick={onStopSession}
            >
              Stop Session
            </button>
          )}
        </div>
      </div>

      {/* Session History */}
      {otherSessions.length > 0 && (
        <div className="session-sidebar__history">
          <h3 className="session-sidebar__history-title">
            Recent Sessions ({otherSessions.length})
          </h3>
          <ul className="session-sidebar__history-list">
            {otherSessions.slice(0, 5).map(session => (
              <li
                key={session.sessionId}
                className="session-sidebar__history-item"
                onClick={() => handleSwitchSession(session.sessionId)}
              >
                <div className="session-sidebar__history-info">
                  <span className="monospace">
                    {session.sessionId.slice(0, 8)}...
                  </span>
                  <span className="session-sidebar__history-time">
                    {formatRelativeTime(session.lastActivityAt)}
                  </span>
                </div>
                <button
                  className="session-sidebar__history-delete"
                  onClick={(e) => handleDeleteClick(session.sessionId, e)}
                  title="Remove from history"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Back to Editor */}
      <div className="session-sidebar__footer">
        <button
          className="btn btn--ghost btn--block"
          onClick={() => navigate(`/meshes/${meshName}`)}
        >
          ← Back to Editor
        </button>
      </div>
    </aside>
  );
}

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

export default SessionSidebar;

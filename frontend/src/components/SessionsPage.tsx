/**
 * SessionsPage.tsx
 * List all sessions across meshes with filtering and artifacts preview.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessionsListAPI, type SessionSummary, type SessionArtifact } from '../api/sessionsList';
import { meshAPI } from '../api/meshes';
import './SessionsPage.css';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(isoString);
}

function SessionRow({
  session,
  onViewArtifacts,
  expanded,
  artifacts,
}: {
  session: SessionSummary;
  onViewArtifacts: (sessionId: string) => void;
  expanded: boolean;
  artifacts: SessionArtifact[] | null;
}) {
  const navigate = useNavigate();

  const statusColors: Record<string, string> = {
    active: '#34d399',
    completed: '#60a5fa',
    failed: '#f87171',
  };

  return (
    <>
      <tr className="sessions-page__row" onClick={() => navigate(`/meshes/${session.meshId}/run/${session.sessionId}`)}>
        <td className="sessions-page__cell sessions-page__cell--id">
          <code>{session.sessionId.substring(0, 8)}</code>
        </td>
        <td className="sessions-page__cell sessions-page__cell--mesh">
          {session.meshId}
        </td>
        <td className="sessions-page__cell sessions-page__cell--status">
          <span
            className="sessions-page__status"
            style={{ color: statusColors[session.status] }}
          >
            <span className="sessions-page__status-dot" style={{ background: statusColors[session.status] }} />
            {session.status}
          </span>
        </td>
        <td className="sessions-page__cell sessions-page__cell--messages">
          {session.messageCount}
        </td>
        <td className="sessions-page__cell sessions-page__cell--time">
          {formatRelativeTime(session.lastActivityAt)}
        </td>
        <td className="sessions-page__cell sessions-page__cell--actions">
          {session.artifacts && session.artifacts.length > 0 && (
            <button
              className="btn btn--sm btn--ghost"
              onClick={(e) => {
                e.stopPropagation();
                onViewArtifacts(session.sessionId);
              }}
            >
              {expanded ? 'Hide' : 'Artifacts'}
            </button>
          )}
        </td>
      </tr>
      {expanded && artifacts && (
        <tr className="sessions-page__artifacts-row">
          <td colSpan={6}>
            <div className="sessions-page__artifacts">
              <h4>Session Artifacts</h4>
              <ul>
                {artifacts.map((artifact) => (
                  <li key={artifact.path}>
                    <span className="sessions-page__artifact-icon">
                      {artifact.type === 'directory' ? '📁' : '📄'}
                    </span>
                    <span className="sessions-page__artifact-name">{artifact.name}</span>
                    <span className="sessions-page__artifact-size">
                      {artifact.type === 'file' && `${Math.ceil(artifact.size / 1024)}KB`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [meshFilter, setMeshFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [meshOptions, setMeshOptions] = useState<string[]>([]);

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Expanded artifacts
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<SessionArtifact[] | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sessionsListAPI.listSessions({
        meshId: meshFilter || undefined,
        status: statusFilter || undefined,
        limit,
        offset,
      });
      setSessions(data.sessions);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [meshFilter, statusFilter, offset]);

  // Load mesh options for filter
  useEffect(() => {
    meshAPI.listMeshes().then((data) => {
      setMeshOptions(data.meshes.map((m) => m.name));
    }).catch(() => {
      // Ignore errors
    });
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleViewArtifacts = async (sessionId: string) => {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      setArtifacts(null);
      return;
    }

    try {
      const data = await sessionsListAPI.getSessionArtifacts(sessionId);
      setArtifacts(data);
      setExpandedSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artifacts');
    }
  };

  const handleFilterChange = () => {
    setOffset(0);
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="sessions-page">
      <header className="sessions-page__header">
        <div>
          <h1>Sessions</h1>
          <p className="sessions-page__subtitle">
            {total} total sessions
          </p>
        </div>
        <button className="btn btn--ghost" onClick={loadSessions}>
          Refresh
        </button>
      </header>

      {/* Filters */}
      <div className="sessions-page__filters">
        <div className="sessions-page__filter">
          <label>Mesh</label>
          <select
            value={meshFilter}
            onChange={(e) => {
              setMeshFilter(e.target.value);
              handleFilterChange();
            }}
          >
            <option value="">All meshes</option>
            {meshOptions.map((mesh) => (
              <option key={mesh} value={mesh}>{mesh}</option>
            ))}
          </select>
        </div>
        <div className="sessions-page__filter">
          <label>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              handleFilterChange();
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="sessions-page__loading">Loading sessions...</div>
      ) : error ? (
        <div className="sessions-page__error">
          <p>{error}</p>
          <button onClick={loadSessions}>Retry</button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="sessions-page__empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <p>No sessions found</p>
        </div>
      ) : (
        <>
          <div className="sessions-page__table-wrapper">
            <table className="sessions-page__table">
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Mesh</th>
                  <th>Status</th>
                  <th>Messages</th>
                  <th>Last Activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <SessionRow
                    key={session.sessionId}
                    session={session}
                    onViewArtifacts={handleViewArtifacts}
                    expanded={expandedSession === session.sessionId}
                    artifacts={expandedSession === session.sessionId ? artifacts : null}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="sessions-page__pagination">
              <button
                className="btn btn--sm btn--ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <span className="sessions-page__page-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn--sm btn--ghost"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SessionsPage;

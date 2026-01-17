/**
 * MeshActivity.tsx
 * Page showing all activity for a specific mesh.
 * User lands here when clicking on recent activity from dashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionsListAPI, type SessionSummary, type SessionArtifact } from '../api/sessionsList';
import './MeshActivity.css';

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

function SessionCard({
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
    <div className="mesh-activity__card">
      <div
        className="mesh-activity__card-main"
        onClick={() => navigate(`/meshes/${session.meshId}/run/${session.sessionId}`)}
      >
        <div className="mesh-activity__card-header">
          <code className="mesh-activity__session-id">{session.sessionId.substring(0, 8)}</code>
          <span
            className="mesh-activity__status"
            style={{ color: statusColors[session.status] }}
          >
            <span
              className="mesh-activity__status-dot"
              style={{ background: statusColors[session.status] }}
            />
            {session.status}
          </span>
        </div>

        <div className="mesh-activity__card-body">
          <div className="mesh-activity__stat">
            <span className="mesh-activity__stat-value">{session.messageCount}</span>
            <span className="mesh-activity__stat-label">messages</span>
          </div>
          <div className="mesh-activity__stat">
            <span className="mesh-activity__stat-value">{formatRelativeTime(session.lastActivityAt)}</span>
            <span className="mesh-activity__stat-label">last activity</span>
          </div>
        </div>

        <div className="mesh-activity__card-footer">
          <span className="mesh-activity__created">
            Created {formatDate(session.createdAt)}
          </span>
          <div className="mesh-activity__actions">
            {session.artifacts && session.artifacts.length > 0 && (
              <button
                className="btn btn--sm btn--ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewArtifacts(session.sessionId);
                }}
              >
                {expanded ? 'Hide Artifacts' : `${session.artifacts.length} Artifacts`}
              </button>
            )}
            <button
              className="btn btn--sm btn--primary"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/meshes/${session.meshId}/run/${session.sessionId}`);
              }}
            >
              Open
            </button>
          </div>
        </div>
      </div>

      {expanded && artifacts && (
        <div className="mesh-activity__artifacts">
          <h4>Session Artifacts</h4>
          <ul>
            {artifacts.map((artifact) => (
              <li key={artifact.path}>
                <span className="mesh-activity__artifact-icon">
                  {artifact.type === 'directory' ? '📁' : '📄'}
                </span>
                <span className="mesh-activity__artifact-name">{artifact.name}</span>
                <span className="mesh-activity__artifact-size">
                  {artifact.type === 'file' && `${Math.ceil(artifact.size / 1024)}KB`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function MeshActivity() {
  const { meshName } = useParams<{ meshName: string }>();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Expanded artifacts
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<SessionArtifact[] | null>(null);

  const loadSessions = useCallback(async () => {
    if (!meshName) return;

    setLoading(true);
    setError(null);
    try {
      const data = await sessionsListAPI.listSessions({
        meshId: meshName,
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
  }, [meshName, statusFilter, offset]);

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

  // Count sessions by status
  const activeSessions = sessions.filter(s => s.status === 'active').length;
  const completedSessions = sessions.filter(s => s.status === 'completed').length;
  const failedSessions = sessions.filter(s => s.status === 'failed').length;

  return (
    <div className="mesh-activity">
      <header className="mesh-activity__header">
        <div className="mesh-activity__header-left">
          <button
            className="mesh-activity__back"
            onClick={() => navigate(`/meshes/${meshName}`)}
          >
            ← Back to {meshName}
          </button>
          <h1>{meshName} Activity</h1>
          <p className="mesh-activity__subtitle">
            {total} sessions
          </p>
        </div>
        <div className="mesh-activity__header-actions">
          <button
            className="btn btn--primary"
            onClick={() => navigate(`/meshes/${meshName}/run`)}
          >
            New Session
          </button>
          <button className="btn btn--ghost" onClick={loadSessions}>
            Refresh
          </button>
        </div>
      </header>

      {/* Quick Stats */}
      <section className="mesh-activity__stats">
        <div
          className={`mesh-activity__stat-card ${statusFilter === 'active' ? 'mesh-activity__stat-card--selected' : ''}`}
          onClick={() => { setStatusFilter(statusFilter === 'active' ? '' : 'active'); handleFilterChange(); }}
        >
          <span className="mesh-activity__stat-card-value" style={{ color: '#34d399' }}>{activeSessions}</span>
          <span className="mesh-activity__stat-card-label">Active</span>
        </div>
        <div
          className={`mesh-activity__stat-card ${statusFilter === 'completed' ? 'mesh-activity__stat-card--selected' : ''}`}
          onClick={() => { setStatusFilter(statusFilter === 'completed' ? '' : 'completed'); handleFilterChange(); }}
        >
          <span className="mesh-activity__stat-card-value" style={{ color: '#60a5fa' }}>{completedSessions}</span>
          <span className="mesh-activity__stat-card-label">Completed</span>
        </div>
        <div
          className={`mesh-activity__stat-card ${statusFilter === 'failed' ? 'mesh-activity__stat-card--selected' : ''}`}
          onClick={() => { setStatusFilter(statusFilter === 'failed' ? '' : 'failed'); handleFilterChange(); }}
        >
          <span className="mesh-activity__stat-card-value" style={{ color: '#f87171' }}>{failedSessions}</span>
          <span className="mesh-activity__stat-card-label">Failed</span>
        </div>
      </section>

      {/* Filters */}
      <div className="mesh-activity__filters">
        <div className="mesh-activity__filter">
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

      {/* Sessions Grid */}
      {loading ? (
        <div className="mesh-activity__loading">Loading sessions...</div>
      ) : error ? (
        <div className="mesh-activity__error">
          <p>{error}</p>
          <button onClick={loadSessions}>Retry</button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="mesh-activity__empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <h3>No sessions found</h3>
          <p>
            {statusFilter
              ? `No ${statusFilter} sessions for this mesh.`
              : 'This mesh has no session history yet.'}
          </p>
          <button
            className="btn btn--primary"
            onClick={() => navigate(`/meshes/${meshName}/run`)}
          >
            Start First Session
          </button>
        </div>
      ) : (
        <>
          <div className="mesh-activity__grid">
            {sessions.map((session) => (
              <SessionCard
                key={session.sessionId}
                session={session}
                onViewArtifacts={handleViewArtifacts}
                expanded={expandedSession === session.sessionId}
                artifacts={expandedSession === session.sessionId ? artifacts : null}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mesh-activity__pagination">
              <button
                className="btn btn--sm btn--ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Previous
              </button>
              <span className="mesh-activity__page-info">
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

export default MeshActivity;

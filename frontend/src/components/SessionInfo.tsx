/**
 * SessionInfo.tsx
 * Display session metadata in sidebar.
 * Responsibilities:
 * - Show session ID, status, entry agent
 * - Show connection status
 */

import type { SessionInfo as SessionInfoType } from '../types/session';
import type { ConnectionStatus } from '../hooks/useWebSocket';
import './SessionInfo.css';

interface SessionInfoProps {
  session: SessionInfoType | null;
  connectionStatus: ConnectionStatus;
  meshName: string;
}

export function SessionInfo({
  session,
  connectionStatus,
  meshName,
}: SessionInfoProps) {
  const statusColor = {
    connected: '#22c55e',
    connecting: '#eab308',
    disconnected: '#ef4444',
  }[connectionStatus];

  return (
    <div className="session-info">
      <h2 className="session-info__mesh">{meshName}</h2>

      <div className="session-info__status">
        <span
          className="session-info__dot"
          style={{ backgroundColor: statusColor }}
        />
        <span className="session-info__status-text">
          {connectionStatus}
        </span>
      </div>

      {session && (
        <dl className="session-info__details">
          <dt>Session</dt>
          <dd className="monospace">{session.sessionId.slice(0, 8)}...</dd>

          <dt>Status</dt>
          <dd>{session.status}</dd>

          <dt>Entry Agent</dt>
          <dd>{session.config.entryAgent}</dd>

          <dt>Created</dt>
          <dd>{new Date(session.createdAt).toLocaleString()}</dd>
        </dl>
      )}
    </div>
  );
}

export default SessionInfo;

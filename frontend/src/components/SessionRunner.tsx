/**
 * SessionRunner.tsx
 * Main component for running interactive mesh sessions.
 * Responsibilities:
 * - Create or resume sessions
 * - Display real-time message stream
 * - Handle user input
 * - Show connection status
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI } from '../api/sessions';
import { useWebSocket } from '../hooks/useWebSocket';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type { SessionInfo } from '../types/session';
import './SessionRunner.css';

export function SessionRunner() {
  const { meshName, sessionId: urlSessionId } = useParams<{
    meshName: string;
    sessionId?: string;
  }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WebSocket connection (messages sent via REST API, WebSocket for receiving only)
  const { status, messages } = useWebSocket(
    session?.sessionId ?? null
  );

  // Initialize session (create new or resume existing)
  useEffect(() => {
    async function initSession() {
      if (!meshName) return;

      setLoading(true);
      setError(null);

      try {
        if (urlSessionId) {
          // Resume existing session
          const existingSession = await sessionAPI.getSession(urlSessionId);
          setSession(existingSession);
        } else {
          // Create new session
          const newSession = await sessionAPI.createSession(meshName);
          setSession(newSession);
          // Update URL with session ID (replace to avoid back-button issues)
          navigate(`/meshes/${meshName}/run/${newSession.sessionId}`, { replace: true });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize session');
      } finally {
        setLoading(false);
      }
    }

    initSession();
  }, [meshName, urlSessionId, navigate]);

  // Send message handler (called by MessageInput with message body)
  const handleSend = useCallback(async (body: string): Promise<void> => {
    if (!session) return;

    try {
      // Send via REST API (WebSocket will receive the response)
      await sessionAPI.sendMessage(session.sessionId, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      throw err; // Re-throw so MessageInput can handle it
    }
  }, [session]);

  // Stop session
  const handleStop = useCallback(async () => {
    if (!session) return;

    try {
      await sessionAPI.destroySession(session.sessionId);
      navigate(`/meshes/${meshName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop session');
    }
  }, [session, meshName, navigate]);

  // Connection status indicator
  const statusColor = {
    connected: '#22c55e',
    connecting: '#eab308',
    disconnected: '#ef4444',
  }[status];

  if (loading) {
    return (
      <div className="session-runner session-runner--loading">
        <div className="loading-spinner">Initializing session...</div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="session-runner session-runner--error">
        <div className="error-message">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => navigate(`/meshes/${meshName}`)}>
            Back to Mesh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-runner">
      {/* Left Sidebar - Session Info */}
      <aside className="session-sidebar">
        <div className="session-info">
          <h2>{meshName}</h2>
          <div className="session-status">
            <span
              className="status-dot"
              style={{ backgroundColor: statusColor }}
            />
            <span className="status-text">{status}</span>
          </div>
          {session && (
            <div className="session-details">
              <p><strong>Session:</strong> {session.sessionId.slice(0, 8)}...</p>
              <p><strong>Status:</strong> {session.status}</p>
              <p><strong>Entry:</strong> {session.config.entryAgent}</p>
            </div>
          )}
        </div>
        <div className="session-controls">
          <button
            className="btn btn--danger"
            onClick={handleStop}
          >
            Stop Session
          </button>
        </div>
      </aside>

      {/* Main Content - Messages */}
      <main className="message-area">
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <MessageList messages={messages} />

        <MessageInput
          onSend={handleSend}
          connectionStatus={status}
          placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
        />
      </main>

      {/* Right Sidebar - Context (placeholder) */}
      <aside className="context-sidebar">
        <h3>Context</h3>
        <p className="placeholder-text">
          Game state and context will appear here.
        </p>
      </aside>
    </div>
  );
}

export default SessionRunner;

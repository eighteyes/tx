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
import type { SessionInfo, AgentMessage } from '../types/session';
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
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // WebSocket connection
  const { status, messages, sendMessage: wsSendMessage } = useWebSocket(
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

  // Send message handler
  const handleSend = useCallback(async () => {
    if (!input.trim() || !session || sending) return;

    const messageBody = input.trim();
    setInput('');
    setSending(true);

    try {
      // Send via REST API (WebSocket will receive the response)
      await sessionAPI.sendMessage(session.sessionId, messageBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setInput(messageBody); // Restore input on error
    } finally {
      setSending(false);
    }
  }, [input, session, sending]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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

        <div className="message-list">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>No messages yet. Send a message to start the session.</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          )}
        </div>

        <div className="message-input-container">
          <textarea
            className="message-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
            rows={3}
            disabled={sending || status !== 'connected'}
          />
          <button
            className="btn btn--primary send-btn"
            onClick={handleSend}
            disabled={!input.trim() || sending || status !== 'connected'}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
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

// Message bubble sub-component
function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.from === 'user' || message.to === 'core/core';
  const isSystem = message.type === 'system';

  return (
    <div
      className={`message-bubble ${
        isUser ? 'message-bubble--user' :
        isSystem ? 'message-bubble--system' :
        'message-bubble--agent'
      }`}
    >
      <div className="message-header">
        <span className="message-from">{message.from}</span>
        {message.headline && (
          <span className="message-headline">{message.headline}</span>
        )}
      </div>
      <div className="message-body">{message.body}</div>
      <div className="message-meta">
        <span className="message-type">{message.type}</span>
        <span className="message-time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

export default SessionRunner;

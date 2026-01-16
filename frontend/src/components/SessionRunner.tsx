/**
 * SessionRunner.tsx
 * Main component for running interactive mesh sessions.
 * Responsibilities:
 * - Create or resume sessions
 * - Display real-time message stream
 * - Handle user input
 * - Show connection status
 * - Support narrative-engine mesh features
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sessionAPI } from '../api/sessions';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSessionStorage } from '../hooks/useSessionStorage';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { SessionSidebar } from './SessionSidebar';
import { NarrativeControls } from './NarrativeControls';
import { ArtifactsList } from './ArtifactsList';
import type { SessionInfo as SessionInfoType } from '../types/session';
import './SessionRunner.css';

export function SessionRunner() {
  const { meshName, sessionId: urlSessionId } = useParams<{
    meshName: string;
    sessionId?: string;
  }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionInfoType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  // Track whether we've validated this session already
  const validatedSessionRef = useRef<string | null>(null);

  // Session storage for localStorage persistence
  const {
    saveSession,
    removeSession,
    updateActivity,
    getSessionsForMesh,
    validateSession,
  } = useSessionStorage();

  // Get stored sessions for this mesh
  const storedSessions = getSessionsForMesh(meshName || '');

  // WebSocket connection (messages sent via REST API, WebSocket for receiving only)
  const { status, messages } = useWebSocket(
    session?.sessionId ?? null
  );

  // Detect if this is narrative-engine mesh
  const isNarrativeMesh = meshName === 'narrative-engine';

  // Validate session on resume (if session exists in URL)
  useEffect(() => {
    async function validateOnResume() {
      if (urlSessionId && validatedSessionRef.current !== urlSessionId) {
        validatedSessionRef.current = urlSessionId;
        const isValid = await validateSession(urlSessionId);
        if (!isValid) {
          // Session no longer exists, create new one
          setError('Session expired. Creating new session...');
          navigate(`/meshes/${meshName}/run`, { replace: true });
        }
      }
    }
    validateOnResume();
  }, [urlSessionId, validateSession, meshName, navigate]);

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

          // Show restore message
          setRestoreMessage('Session restored');
          setTimeout(() => setRestoreMessage(null), 2000);
        } else {
          // Create new session
          const newSession = await sessionAPI.createSession(meshName);
          setSession(newSession);

          // Save to localStorage
          saveSession({
            sessionId: newSession.sessionId,
            meshId: newSession.meshId,
            meshName: meshName,
            createdAt: newSession.createdAt,
            lastActivityAt: newSession.createdAt,
          });

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
  }, [meshName, urlSessionId, navigate, saveSession]);

  // Send message handler (called by MessageInput with message body)
  const handleSend = useCallback(async (body: string): Promise<void> => {
    if (!session) return;

    try {
      // Send via REST API (WebSocket will receive the response)
      await sessionAPI.sendMessage(session.sessionId, body);
      // Update lastActivityAt in localStorage
      updateActivity(session.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      throw err; // Re-throw so MessageInput can handle it
    }
  }, [session, updateActivity]);

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

  // Create new session (for sidebar)
  const handleNewSession = useCallback(() => {
    navigate(`/meshes/${meshName}/run`);
  }, [meshName, navigate]);

  // Delete stored session from history
  const handleDeleteStoredSession = useCallback((sessionId: string) => {
    removeSession(sessionId);
  }, [removeSession]);

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
      {/* Restore Message Toast */}
      {restoreMessage && (
        <div className="restore-message">{restoreMessage}</div>
      )}

      {/* Left Sidebar - Session Info */}
      <SessionSidebar
        meshName={meshName || ''}
        currentSession={session}
        connectionStatus={status}
        storedSessions={storedSessions}
        onNewSession={handleNewSession}
        onStopSession={handleStop}
        onDeleteSession={handleDeleteStoredSession}
      />

      {/* Main Content - Messages */}
      <main className="message-area" role="main" aria-label="Chat messages">
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <MessageList messages={messages} onRespond={handleSend} />

        <MessageInput
          onSend={handleSend}
          connectionStatus={status}
          placeholder="Type your message... (Enter to send, Shift+Enter for newline)"
        />
      </main>

      {/* Right Sidebar - Context + Artifacts */}
      <aside className="context-sidebar" role="complementary" aria-label="Session context">
        {/* Top: Context */}
        <div className="context-panel">
          <h3>Context</h3>

          {isNarrativeMesh ? (
            <NarrativeControls
              onCommand={(cmd) => handleSend(cmd)}
              disabled={status !== 'connected'}
              hasMessages={messages.length > 0}
            />
          ) : (
            <p className="placeholder-text">
              Game state and context will appear here.
            </p>
          )}
        </div>

        {/* Bottom: Artifacts */}
        <div className="artifacts-panel">
          <h3>Artifacts</h3>
          <ArtifactsList sessionId={session?.sessionId || null} />
        </div>
      </aside>
    </div>
  );
}

export default SessionRunner;

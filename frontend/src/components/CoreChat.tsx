/**
 * CoreChat.tsx
 * Main component for interacting with the persistent core agent.
 *
 * This is the web-based alternative to the tmux CLI experience.
 * Provides real-time bidirectional communication with the core agent.
 *
 * Responsibilities:
 * - Display core agent output stream
 * - Accept user input
 * - Handle HITL (ask-human) patterns
 * - Show connection and agent status
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCoreWebSocket, type CoreOutputMessage, type CoreStatus } from '../hooks/useCoreWebSocket';
import './CoreChat.css';

interface CoreMessageBubbleProps {
  message: CoreOutputMessage;
}

function CoreMessageBubble({ message }: CoreMessageBubbleProps) {
  const getMessageClass = () => {
    switch (message.type) {
      case 'text':
        return 'core-message core-message--text';
      case 'tool-use':
        return 'core-message core-message--tool';
      case 'ask-human':
        return 'core-message core-message--ask-human';
      case 'complete':
        return 'core-message core-message--complete';
      case 'error':
        return 'core-message core-message--error';
      case 'status':
        return 'core-message core-message--status';
      default:
        return 'core-message';
    }
  };

  const getIcon = () => {
    switch (message.type) {
      case 'tool-use':
        return '\u{1f527}'; // wrench
      case 'ask-human':
        return '\u{1f914}'; // thinking face
      case 'complete':
        return '\u{2705}'; // check mark
      case 'error':
        return '\u{274c}'; // cross
      case 'status':
        return '\u{1f4e1}'; // satellite
      default:
        return null;
    }
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  return (
    <div className={getMessageClass()}>
      {getIcon() && <span className="core-message__icon">{getIcon()}</span>}
      <div className="core-message__content">
        <pre className="core-message__text">{message.content}</pre>
        {message.toolName && (
          <span className="core-message__tool-name">Tool: {message.toolName}</span>
        )}
      </div>
      <span className="core-message__time">{formatTimestamp(message.timestamp)}</span>
    </div>
  );
}

interface HITLPromptProps {
  msgId: string;
  question: string;
  onRespond: (msgId: string, response: string) => void;
}

function HITLPrompt({ msgId, question, onRespond }: HITLPromptProps) {
  const [response, setResponse] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (response.trim()) {
      onRespond(msgId, response.trim());
      setResponse('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="hitl-prompt">
      <div className="hitl-prompt__header">
        <span className="hitl-prompt__icon" role="img" aria-label="thinking">&#x1F914;</span>
        <span className="hitl-prompt__title">Agent needs your input</span>
      </div>
      <div className="hitl-prompt__question">
        <pre>{question}</pre>
      </div>
      <div className="hitl-prompt__input">
        <textarea
          ref={inputRef}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your response..."
          rows={3}
        />
        <button
          onClick={handleSubmit}
          disabled={!response.trim()}
          className="hitl-prompt__submit"
        >
          Respond
        </button>
      </div>
      <div className="hitl-prompt__hint">
        Press Enter to submit, Shift+Enter for newline
      </div>
    </div>
  );
}

interface StatusIndicatorProps {
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  coreStatus: CoreStatus;
  sessionId: string | null;
}

function StatusIndicator({ connectionStatus, coreStatus, sessionId }: StatusIndicatorProps) {
  const getConnectionColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'status-dot--connected';
      case 'connecting':
        return 'status-dot--connecting';
      default:
        return 'status-dot--disconnected';
    }
  };

  const getCoreStatusText = () => {
    switch (coreStatus) {
      case 'thinking':
        return 'Thinking...';
      case 'using-tool':
        return 'Using tool...';
      case 'waiting-for-human':
        return 'Waiting for input';
      default:
        return 'Ready';
    }
  };

  return (
    <div className="status-indicator">
      <div className="status-indicator__connection">
        <span className={`status-dot ${getConnectionColor()}`} />
        <span className="status-text">{connectionStatus}</span>
      </div>
      <div className="status-indicator__core">
        <span className="status-label">Core:</span>
        <span className={`status-value status-value--${coreStatus}`}>
          {getCoreStatusText()}
        </span>
      </div>
      {sessionId && (
        <div className="status-indicator__session">
          <span className="status-label">Session:</span>
          <span className="status-value">{sessionId.slice(0, 8)}...</span>
        </div>
      )}
    </div>
  );
}

export function CoreChat() {
  const {
    connectionStatus,
    coreStatus,
    sessionId,
    outputs,
    pendingQuestion,
    sendMessage,
    respondToHITL,
    connect,
    disconnect,
    clearOutputs,
  } = useCoreWebSocket({
    autoConnect: true,
  });

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [outputs]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || connectionStatus !== 'connected') return;

    sendMessage(trimmed);
    setInput('');
    inputRef.current?.focus();
  }, [input, connectionStatus, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isInputDisabled = connectionStatus !== 'connected' ||
                          coreStatus === 'waiting-for-human' ||
                          coreStatus === 'thinking' ||
                          coreStatus === 'using-tool';

  return (
    <div className="core-chat">
      {/* Header */}
      <header className="core-chat__header">
        <div className="core-chat__title">
          <h1>TX Core Agent</h1>
          <span className="core-chat__subtitle">Web Interface</span>
        </div>
        <StatusIndicator
          connectionStatus={connectionStatus}
          coreStatus={coreStatus}
          sessionId={sessionId}
        />
        <div className="core-chat__actions">
          <button
            onClick={clearOutputs}
            className="core-chat__clear-btn"
            title="Clear output"
          >
            Clear
          </button>
          {connectionStatus === 'disconnected' ? (
            <button onClick={connect} className="core-chat__connect-btn">
              Connect
            </button>
          ) : (
            <button onClick={disconnect} className="core-chat__disconnect-btn">
              Disconnect
            </button>
          )}
        </div>
      </header>

      {/* Messages Area */}
      <main className="core-chat__messages">
        {outputs.length === 0 ? (
          <div className="core-chat__empty">
            <p>No messages yet.</p>
            <p className="core-chat__empty-hint">
              Send a message to start interacting with the core agent.
            </p>
          </div>
        ) : (
          outputs.map((msg, idx) => (
            <CoreMessageBubble key={`${msg.timestamp}-${idx}`} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} className="scroll-anchor" />
      </main>

      {/* HITL Prompt */}
      {pendingQuestion && (
        <HITLPrompt
          msgId={pendingQuestion.msgId}
          question={pendingQuestion.question}
          onRespond={respondToHITL}
        />
      )}

      {/* Input Area */}
      <footer className="core-chat__input">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            connectionStatus !== 'connected'
              ? 'Disconnected...'
              : coreStatus === 'waiting-for-human'
              ? 'Respond to the question above...'
              : 'Type your message... (Enter to send)'
          }
          rows={3}
          disabled={isInputDisabled}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isInputDisabled}
          className="core-chat__send-btn"
        >
          Send
        </button>
      </footer>
    </div>
  );
}

export default CoreChat;

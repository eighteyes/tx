/**
 * MessageInput.tsx
 * Text input for composing and sending messages.
 * Responsibilities:
 * - Multiline text input
 * - Enter to send, Shift+Enter for newline
 * - Disabled state when sending or disconnected
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ConnectionStatus } from '../hooks/useWebSocket';
import './MessageInput.css';

interface MessageInputProps {
  onSend: (body: string) => void;
  disabled?: boolean;
  connectionStatus?: ConnectionStatus;
  placeholder?: string;
}

export function MessageInput({
  onSend,
  disabled = false,
  connectionStatus = 'connected',
  placeholder = 'Type your message...',
}: MessageInputProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDisabled = disabled || sending || connectionStatus !== 'connected';

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isDisabled) return;

    setSending(true);
    try {
      await onSend(trimmed);
      setInput('');
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [input, isDisabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Ctrl/Cmd+Enter also sends
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const statusMessage = {
    connected: null,
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
  }[connectionStatus];

  return (
    <div className="message-input">
      {statusMessage && (
        <div className="message-input__status">{statusMessage}</div>
      )}
      <div className="message-input__container">
        <textarea
          ref={textareaRef}
          className="message-input__textarea"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          disabled={isDisabled}
        />
        <button
          className="message-input__send"
          onClick={handleSend}
          disabled={!input.trim() || isDisabled}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
      <div className="message-input__hint">
        Enter to send • Shift+Enter for newline
      </div>
    </div>
  );
}

export default MessageInput;

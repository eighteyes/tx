/**
 * MessageList.tsx
 * Scrollable list of chat messages with auto-scroll.
 * Responsibilities:
 * - Display messages in chronological order
 * - Auto-scroll to bottom on new messages
 * - Handle empty state
 * - Pass HITL response handler to message bubbles
 */

import { useEffect, useRef } from 'react';
import type { AgentMessage } from '../types/session';
import { MessageBubble } from './MessageBubble';
import './MessageList.css';

interface MessageListProps {
  messages: AgentMessage[];
  loading?: boolean;
  onRespond?: (response: string) => void;
}

export function MessageList({ messages, loading, onRespond }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (loading) {
    return (
      <div className="message-list message-list--loading">
        <div className="loading-indicator">Loading messages...</div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="message-list message-list--empty">
        <div className="empty-state">
          <p>No messages yet.</p>
          <p className="empty-hint">Send a message to start the session.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="message-list"
      ref={listRef}
      role="log"
      aria-live="polite"
      aria-label="Message history"
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onRespond={onRespond} />
      ))}
      <div ref={endRef} className="scroll-anchor" />
    </div>
  );
}

export default MessageList;

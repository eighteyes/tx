/**
 * MessageBubble.tsx
 * Individual message display with role-based styling.
 * Responsibilities:
 * - Render message with appropriate styling (user/agent/system)
 * - Show metadata (from, type, timestamp)
 * - Handle long messages gracefully
 */

import type { AgentMessage } from '../types/session';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: AgentMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const role = getMessageRole(message);

  return (
    <div className={`message-bubble message-bubble--${role}`}>
      <div className="message-bubble__header">
        <span className="message-bubble__from">{message.from}</span>
        {message.headline && (
          <span className="message-bubble__headline">{message.headline}</span>
        )}
      </div>
      <div className="message-bubble__body">
        {message.body}
      </div>
      <div className="message-bubble__footer">
        <span className="message-bubble__type">{message.type}</span>
        <span className="message-bubble__time">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

/**
 * Determine message role for styling
 */
function getMessageRole(message: AgentMessage): 'user' | 'agent' | 'system' {
  // User messages: from user or directed to core
  if (message.from === 'user' || message.from.startsWith('user/')) {
    return 'user';
  }
  // System messages: type is system or from system agents
  if (message.type === 'system' || message.from === 'system') {
    return 'system';
  }
  // Everything else is agent
  return 'agent';
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default MessageBubble;

/**
 * useWebSocket.ts
 * Real-time WebSocket connection hook for session message streaming.
 * Responsibilities:
 * - Establish and maintain WebSocket connection
 * - Auto-reconnect with exponential backoff
 * - Queue messages while disconnected
 * - Track connection status
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentMessage, MessageEvent } from '../types/session';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface UseWebSocketOptions {
  onMessage?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  maxReconnectAttempts?: number;
  baseReconnectDelay?: number;
}

interface UseWebSocketReturn {
  status: ConnectionStatus;
  messages: AgentMessage[];
  sendMessage: (body: string, to?: string) => void;
  connect: () => void;
  disconnect: () => void;
  clearMessages: () => void;
}

export function useWebSocket(
  sessionId: string | null,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const {
    onMessage,
    onError,
    onStatusChange,
    maxReconnectAttempts = 5,
    baseReconnectDelay = 1000,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueue = useRef<Array<{ body: string; to?: string }>>([]);
  const connectRef = useRef<(() => void) | null>(null);

  // Store callbacks in refs to avoid stale closures and unnecessary reconnects
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onStatusChangeRef = useRef(onStatusChange);

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onStatusChangeRef.current = onStatusChange;
  }, [onMessage, onError, onStatusChange]);

  // Update status and notify
  const updateStatus = useCallback((newStatus: ConnectionStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!sessionId || wsRef.current?.readyState === WebSocket.OPEN) return;

    updateStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/v1/sessions/${sessionId}/stream`;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts.current = 0;
      updateStatus('connected');

      // Flush queued messages
      while (messageQueue.current.length > 0) {
        const msg = messageQueue.current.shift()!;
        ws.send(JSON.stringify({ type: 'message', ...msg }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: MessageEvent = JSON.parse(event.data as string);
        if (data.type === 'new' || data.type === 'revision') {
          setMessages(prev => [...prev, data.message]);
          onMessageRef.current?.(data);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = (event) => {
      onErrorRef.current?.(event);
    };

    ws.onclose = () => {
      updateStatus('disconnected');
      wsRef.current = null;

      // Auto-reconnect with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts.current);
        reconnectAttempts.current++;

        reconnectTimeout.current = setTimeout(() => {
          connectRef.current?.();
        }, delay);
      }
    };

    wsRef.current = ws;
  }, [sessionId, updateStatus, maxReconnectAttempts, baseReconnectDelay]);

  // Keep connectRef in sync with connect function for recursive calls
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    reconnectAttempts.current = maxReconnectAttempts; // Prevent auto-reconnect
    wsRef.current?.close();
    wsRef.current = null;
    updateStatus('disconnected');
  }, [maxReconnectAttempts, updateStatus]);

  // Send message (queue if disconnected)
  const sendMessage = useCallback((body: string, to?: string) => {
    const msg = { body, to };

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', ...msg }));
    } else {
      // Queue for later
      messageQueue.current.push(msg);
    }
  }, []);

  // Clear messages
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Auto-connect when sessionId changes
  useEffect(() => {
    if (sessionId) {
      // Schedule connect for next tick to avoid synchronous setState in effect
      const timeoutId = setTimeout(connect, 0);
      return () => {
        clearTimeout(timeoutId);
        disconnect();
      };
    }
    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  return {
    status,
    messages,
    sendMessage,
    connect,
    disconnect,
    clearMessages,
  };
}

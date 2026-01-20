/**
 * useCoreWebSocket.ts
 * WebSocket hook for connecting to the persistent core agent.
 *
 * Unlike useWebSocket (session-based), this connects to the single persistent core.
 *
 * Responsibilities:
 * - Establish and maintain WebSocket connection to /v1/core/stream
 * - Auto-reconnect with exponential backoff
 * - Handle HITL (ask-human) patterns
 * - Track connection and core status
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type CoreStatus = 'idle' | 'thinking' | 'using-tool' | 'waiting-for-human';

/**
 * Output message from core
 */
export interface CoreOutputMessage {
  type: 'text' | 'tool-use' | 'tool-result' | 'ask-human' | 'complete' | 'error' | 'status';
  content: string;
  msgId?: string;
  toolName?: string;
  status?: CoreStatus;
  timestamp: number;
}

/**
 * Server message structure
 */
interface ServerMessage {
  type: 'output' | 'ask-human' | 'status' | 'error' | 'pong' | 'connected';
  data?: CoreOutputMessage;
  question?: string;
  msgId?: string;
  status?: CoreStatus;
  sessionId?: string | null;
  error?: string;
  timestamp: number;
}

interface UseCoreWebSocketOptions {
  autoConnect?: boolean;
  onOutput?: (msg: CoreOutputMessage) => void;
  onAskHuman?: (msgId: string, question: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: CoreStatus) => void;
  onReconnecting?: (attempt: number, delay: number) => void;
  baseReconnectDelay?: number;
  maxReconnectDelay?: number;
}

interface UseCoreWebSocketReturn {
  connectionStatus: ConnectionStatus;
  coreStatus: CoreStatus;
  sessionId: string | null;
  outputs: CoreOutputMessage[];
  pendingQuestion: { msgId: string; question: string } | null;
  sendMessage: (content: string) => void;
  respondToHITL: (msgId: string, response: string) => void;
  connect: () => void;
  disconnect: () => void;
  clearOutputs: () => void;
}

export function useCoreWebSocket(
  options: UseCoreWebSocketOptions = {}
): UseCoreWebSocketReturn {
  const {
    autoConnect = true,
    onOutput,
    onAskHuman,
    onError,
    onStatusChange,
    onReconnecting,
    baseReconnectDelay = 1000,
    maxReconnectDelay = 30000,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [coreStatus, setCoreStatus] = useState<CoreStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<CoreOutputMessage[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<{ msgId: string; question: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const manualDisconnect = useRef(false);

  // Store callbacks in refs
  const onOutputRef = useRef(onOutput);
  const onAskHumanRef = useRef(onAskHuman);
  const onErrorRef = useRef(onError);
  const onStatusChangeRef = useRef(onStatusChange);
  const onReconnectingRef = useRef(onReconnecting);

  useEffect(() => {
    onOutputRef.current = onOutput;
    onAskHumanRef.current = onAskHuman;
    onErrorRef.current = onError;
    onStatusChangeRef.current = onStatusChange;
    onReconnectingRef.current = onReconnecting;
  }, [onOutput, onAskHuman, onError, onStatusChange, onReconnecting]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Reset manual disconnect flag when explicitly connecting
    manualDisconnect.current = false;
    setConnectionStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/v1/core/stream`;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      reconnectAttempts.current = 0;
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data as string);

        switch (msg.type) {
          case 'connected':
            if (msg.sessionId) {
              setSessionId(msg.sessionId);
            }
            if (msg.status) {
              setCoreStatus(msg.status);
              onStatusChangeRef.current?.(msg.status);
            }
            break;

          case 'output':
            if (msg.data) {
              setOutputs(prev => [...prev, msg.data!]);
              onOutputRef.current?.(msg.data);
            }
            break;

          case 'ask-human':
            if (msg.msgId && msg.question) {
              setPendingQuestion({ msgId: msg.msgId, question: msg.question });
              onAskHumanRef.current?.(msg.msgId, msg.question);
            }
            if (msg.status) {
              setCoreStatus(msg.status);
              onStatusChangeRef.current?.(msg.status);
            }
            break;

          case 'status':
            if (msg.status) {
              setCoreStatus(msg.status);
              onStatusChangeRef.current?.(msg.status);
            }
            if (msg.sessionId !== undefined) {
              setSessionId(msg.sessionId);
            }
            break;

          case 'error':
            if (msg.error) {
              onErrorRef.current?.(msg.error);
              setOutputs(prev => [...prev, {
                type: 'error',
                content: msg.error!,
                timestamp: msg.timestamp,
              }]);
            }
            break;

          case 'pong':
            // Heartbeat response, no action needed
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      wsRef.current = null;

      // Don't auto-reconnect if manually disconnected
      if (manualDisconnect.current) {
        return;
      }

      // Auto-reconnect with exponential backoff (no hard limit)
      // Delay: 1s, 2s, 4s, 8s, 16s, then capped at maxReconnectDelay (30s)
      const delay = Math.min(
        baseReconnectDelay * Math.pow(2, reconnectAttempts.current),
        maxReconnectDelay
      );
      reconnectAttempts.current++;

      // Notify callback about reconnection attempt
      onReconnectingRef.current?.(reconnectAttempts.current, delay);

      reconnectTimeout.current = setTimeout(() => {
        connectRef.current?.();
      }, delay);
    };

    wsRef.current = ws;
  }, [baseReconnectDelay, maxReconnectDelay]);

  // Keep connectRef in sync
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    // Set flag to prevent auto-reconnect
    manualDisconnect.current = true;
    reconnectAttempts.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus('disconnected');
  }, []);

  // Send a user message
  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'user',
        content,
      }));
    }
  }, []);

  // Respond to HITL question
  const respondToHITL = useCallback((msgId: string, response: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'hitl-response',
        content: response,
        refMsgId: msgId,
      }));
      setPendingQuestion(null);
    }
  }, []);

  // Clear outputs
  const clearOutputs = useCallback(() => {
    setOutputs([]);
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      const timeoutId = setTimeout(connect, 0);
      return () => {
        clearTimeout(timeoutId);
        disconnect();
      };
    }
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
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
  };
}

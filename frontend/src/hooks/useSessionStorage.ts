/**
 * useSessionStorage.ts
 * LocalStorage-based session metadata persistence.
 * Responsibilities:
 * - Store session metadata in localStorage
 * - Retrieve sessions by mesh
 * - Remove stale sessions
 * - Validate sessions against backend
 */

import { useState, useCallback, useEffect } from 'react';
import { sessionAPI } from '../api/sessions';

const STORAGE_KEY = 'tx-sessions';

export interface StoredSession {
  sessionId: string;
  meshId: string;
  meshName: string;
  createdAt: string;
  lastActivityAt: string;
}

interface UseSessionStorageReturn {
  sessions: StoredSession[];
  saveSession: (session: StoredSession) => void;
  removeSession: (sessionId: string) => void;
  updateActivity: (sessionId: string) => void;
  getSessionsForMesh: (meshId: string) => StoredSession[];
  cleanupStaleSessions: (maxAgeDays?: number) => void;
  validateSession: (sessionId: string) => Promise<boolean>;
}

export function useSessionStorage(): UseSessionStorageReturn {
  const [sessions, setSessions] = useState<StoredSession[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persist to localStorage whenever sessions change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const saveSession = useCallback((session: StoredSession) => {
    setSessions(prev => {
      // Don't duplicate
      const exists = prev.some(s => s.sessionId === session.sessionId);
      if (exists) {
        return prev.map(s =>
          s.sessionId === session.sessionId ? session : s
        );
      }
      return [...prev, session];
    });
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
  }, []);

  const updateActivity = useCallback((sessionId: string) => {
    setSessions(prev =>
      prev.map(s =>
        s.sessionId === sessionId
          ? { ...s, lastActivityAt: new Date().toISOString() }
          : s
      )
    );
  }, []);

  const getSessionsForMesh = useCallback(
    (meshId: string) => {
      return sessions
        .filter(s => s.meshId === meshId || s.meshName === meshId)
        .sort((a, b) =>
          new Date(b.lastActivityAt).getTime() -
          new Date(a.lastActivityAt).getTime()
        );
    },
    [sessions]
  );

  /**
   * Remove sessions older than specified days
   */
  const cleanupStaleSessions = useCallback((maxAgeDays: number = 7) => {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    setSessions(prev =>
      prev.filter(s => new Date(s.lastActivityAt).getTime() > cutoff)
    );
  }, []);

  /**
   * Check if a session still exists on the backend
   */
  const validateSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      await sessionAPI.getSession(sessionId);
      return true;
    } catch {
      // Session doesn't exist on backend, remove from localStorage
      removeSession(sessionId);
      return false;
    }
  }, [removeSession]);

  // Run cleanup on mount
  useEffect(() => {
    cleanupStaleSessions(7);
  }, [cleanupStaleSessions]);

  return {
    sessions,
    saveSession,
    removeSession,
    updateActivity,
    getSessionsForMesh,
    cleanupStaleSessions,
    validateSession,
  };
}

export default useSessionStorage;

/**
 * LogsViewer.tsx
 * Interactive log viewer with filtering and search.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { logsAPI, type LogEntry, type LogsFilter } from '../api/logs';
import './LogsViewer.css';

const LEVEL_COLORS: Record<string, string> = {
  info: '#60a5fa',
  warn: '#fbbf24',
  error: '#f87171',
  debug: '#888',
};

const COMPONENT_COLORS: Record<string, string> = {
  worker: '#a78bfa',
  dispatcher: '#60a5fa',
  consumer: '#34d399',
  queue: '#38bdf8',
  core: '#fbbf24',
  watcher: '#f472b6',
  quality: '#c084fc',
  session: '#2dd4bf',
};

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = entry.data && Object.keys(entry.data).length > 0;

  const levelColor = LEVEL_COLORS[entry.level] || LEVEL_COLORS.info;
  const componentColor = COMPONENT_COLORS[entry.component] || '#888';

  return (
    <div
      className={`log-entry log-entry--${entry.level} ${expanded ? 'log-entry--expanded' : ''}`}
      onClick={() => hasData && setExpanded(!expanded)}
    >
      <span className="log-entry__badge" style={{ color: levelColor }}>
        {entry.level === 'error' ? '✗' : entry.level === 'warn' ? '⚠' : entry.level === 'debug' ? '·' : ' '}
      </span>
      <span className="log-entry__time">{formatTimestamp(entry.timestamp)}</span>
      <span className="log-entry__component" style={{ color: componentColor }}>
        {entry.component}
      </span>
      <span className="log-entry__message">{entry.message}</span>
      {hasData && (
        <span className="log-entry__expand">{expanded ? '▼' : '▶'}</span>
      )}
      {expanded && hasData && (
        <div className="log-entry__data">
          <pre>{JSON.stringify(entry.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export function LogsViewer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [level, setLevel] = useState<string>('');
  const [component, setComponent] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [showLastSession, setShowLastSession] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Components list
  const [components, setComponents] = useState<string[]>([]);

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 100;

  // Auto-scroll
  const logsEndRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filter: LogsFilter = {
        level: level || undefined,
        component: component || undefined,
        search: search || undefined,
        limit,
        offset,
        last: showLastSession,
      };
      const data = await logsAPI.listLogs(filter);
      setEntries(data.entries);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [level, component, search, offset, showLastSession]);

  // Load components for filter
  useEffect(() => {
    logsAPI.getComponents().then(setComponents).catch(() => {});
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadLogs, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadLogs]);

  // Scroll to bottom on new entries when auto-refresh is on
  useEffect(() => {
    if (autoRefresh && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoRefresh]);

  const handleClearLogs = async () => {
    if (!confirm('Clear all logs? This cannot be undone.')) return;
    try {
      await logsAPI.clearLogs();
      loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear logs');
    }
  };

  const handleFilterReset = () => {
    setLevel('');
    setComponent('');
    setSearch('');
    setOffset(0);
  };

  const hasFilters = level || component || search;

  return (
    <div className="logs-viewer">
      <header className="logs-viewer__header">
        <div>
          <h1>Logs</h1>
          <p className="logs-viewer__subtitle">
            {total} entries {hasFilters && '(filtered)'}
          </p>
        </div>
        <div className="logs-viewer__actions">
          <label className="logs-viewer__toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <label className="logs-viewer__toggle">
            <input
              type="checkbox"
              checked={showLastSession}
              onChange={(e) => {
                setShowLastSession(e.target.checked);
                setOffset(0);
              }}
            />
            Previous session
          </label>
          <button className="btn btn--ghost" onClick={loadLogs}>
            Refresh
          </button>
          <button className="btn btn--danger btn--sm" onClick={handleClearLogs}>
            Clear
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="logs-viewer__filters">
        <div className="logs-viewer__filter">
          <label>Level</label>
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        <div className="logs-viewer__filter">
          <label>Component</label>
          <select
            value={component}
            onChange={(e) => {
              setComponent(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All</option>
            {components.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="logs-viewer__filter logs-viewer__filter--search">
          <label>Search</label>
          <input
            type="text"
            placeholder="Filter by message..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        {hasFilters && (
          <button className="btn btn--sm btn--ghost" onClick={handleFilterReset}>
            Clear filters
          </button>
        )}
      </div>

      {/* Logs list */}
      <div className="logs-viewer__list">
        {loading && entries.length === 0 ? (
          <div className="logs-viewer__loading">Loading logs...</div>
        ) : error ? (
          <div className="logs-viewer__error">
            <p>{error}</p>
            <button onClick={loadLogs}>Retry</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="logs-viewer__empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p>No logs found</p>
          </div>
        ) : (
          <>
            {entries.map((entry, i) => (
              <LogEntryRow key={`${entry.timestamp}-${i}`} entry={entry} />
            ))}
            <div ref={logsEndRef} />
          </>
        )}
      </div>

      {/* Pagination */}
      {!loading && entries.length > 0 && (
        <div className="logs-viewer__pagination">
          <button
            className="btn btn--sm btn--ghost"
            disabled={!hasMore}
            onClick={() => setOffset(offset + limit)}
          >
            Load older
          </button>
          <span className="logs-viewer__count">
            Showing {entries.length} of {total}
          </span>
          {offset > 0 && (
            <button
              className="btn btn--sm btn--ghost"
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Load newer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default LogsViewer;

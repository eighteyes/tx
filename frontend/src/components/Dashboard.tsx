/**
 * Dashboard.tsx
 * Home page with system overview and quick actions.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI, type DashboardStats } from '../api/dashboard';
import './Dashboard.css';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadStats();
    // Refresh every 30 seconds
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadStats() {
    try {
      setError(null);
      const data = await dashboardAPI.getStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard">
        <div className="dashboard__loading">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="dashboard__error">
          <p>Error: {error}</p>
          <button onClick={loadStats}>Retry</button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const memoryPercent = Math.round((stats.system.memory.used / stats.system.memory.total) * 100);

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1>TX Dashboard</h1>
        <p className="dashboard__subtitle">Multi-agent mesh orchestration platform</p>
      </header>

      {/* Quick Stats */}
      <section className="dashboard__stats">
        <div className="stat-card stat-card--meshes" onClick={() => navigate('/meshes')}>
          <div className="stat-card__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="stat-card__content">
            <span className="stat-card__value">{stats.meshes.total}</span>
            <span className="stat-card__label">Meshes</span>
          </div>
        </div>

        <div className="stat-card stat-card--sessions" onClick={() => navigate('/sessions')}>
          <div className="stat-card__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div className="stat-card__content">
            <span className="stat-card__value">{stats.sessions.total}</span>
            <span className="stat-card__label">Sessions</span>
            <span className="stat-card__detail">
              {stats.sessions.active} active
            </span>
          </div>
        </div>

        <div className="stat-card stat-card--workspace" onClick={() => navigate('/workspace')}>
          <div className="stat-card__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="stat-card__content">
            <span className="stat-card__value">Browse</span>
            <span className="stat-card__label">Workspace</span>
          </div>
        </div>

        <div className="stat-card stat-card--logs" onClick={() => navigate('/logs')}>
          <div className="stat-card__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <div className="stat-card__content">
            <span className="stat-card__value">View</span>
            <span className="stat-card__label">Logs</span>
          </div>
        </div>
      </section>

      {/* Main Content Grid */}
      <div className="dashboard__grid">
        {/* Meshes Panel */}
        <section className="dashboard__panel dashboard__panel--meshes">
          <h2>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Available Meshes
          </h2>
          <div className="dashboard__mesh-list">
            {stats.meshes.meshes.length === 0 ? (
              <p className="dashboard__empty">No meshes configured</p>
            ) : (
              stats.meshes.meshes.map((mesh) => (
                <div
                  key={mesh.name}
                  className="dashboard__mesh-item"
                  onClick={() => navigate(`/meshes/${mesh.name}`)}
                >
                  <span className="dashboard__mesh-name">{mesh.name}</span>
                  <span className="dashboard__mesh-agents">{mesh.agents} agents</span>
                  <button
                    className="btn btn--sm btn--success"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/meshes/${mesh.name}/run`);
                    }}
                  >
                    Run
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Recent Activity Panel */}
        <section className="dashboard__panel dashboard__panel--activity">
          <h2>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Recent Activity
          </h2>
          <div className="dashboard__activity-list">
            {stats.recentActivity.length === 0 ? (
              <p className="dashboard__empty">No recent activity</p>
            ) : (
              stats.recentActivity.map((activity, i) => (
                <div key={i} className="dashboard__activity-item">
                  <span className={`dashboard__activity-type dashboard__activity-type--${activity.type}`}>
                    {activity.type}
                  </span>
                  <span className="dashboard__activity-desc">{activity.description}</span>
                  <span className="dashboard__activity-time">{formatTime(activity.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* System Panel */}
        <section className="dashboard__panel dashboard__panel--system">
          <h2>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
            System
          </h2>
          <div className="dashboard__system-stats">
            <div className="dashboard__system-stat">
              <span className="dashboard__system-label">Uptime</span>
              <span className="dashboard__system-value">{formatUptime(stats.system.uptime)}</span>
            </div>
            <div className="dashboard__system-stat">
              <span className="dashboard__system-label">Memory</span>
              <span className="dashboard__system-value">
                {formatBytes(stats.system.memory.used)} / {formatBytes(stats.system.memory.total)}
              </span>
              <div className="dashboard__progress">
                <div
                  className="dashboard__progress-bar"
                  style={{ width: `${memoryPercent}%` }}
                />
              </div>
            </div>
            <div className="dashboard__system-stat">
              <span className="dashboard__system-label">CPU</span>
              <span className="dashboard__system-value">
                {stats.system.cpu.cores} cores
              </span>
            </div>
            <div className="dashboard__system-stat">
              <span className="dashboard__system-label">Platform</span>
              <span className="dashboard__system-value">
                {stats.system.platform} / Node {stats.system.nodeVersion}
              </span>
            </div>
          </div>
        </section>

        {/* Session Stats Panel */}
        <section className="dashboard__panel dashboard__panel--session-stats">
          <h2>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            Session Overview
          </h2>
          <div className="dashboard__session-stats">
            <div className="dashboard__session-stat dashboard__session-stat--active">
              <span className="dashboard__session-count">{stats.sessions.active}</span>
              <span className="dashboard__session-label">Active</span>
            </div>
            <div className="dashboard__session-stat dashboard__session-stat--completed">
              <span className="dashboard__session-count">{stats.sessions.completed}</span>
              <span className="dashboard__session-label">Completed</span>
            </div>
            <div className="dashboard__session-stat dashboard__session-stat--failed">
              <span className="dashboard__session-count">{stats.sessions.failed}</span>
              <span className="dashboard__session-label">Failed</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;

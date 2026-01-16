import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { meshAPI } from '../api/meshes';
import type { MeshMetadata } from '../types/mesh';
import './MeshList.css';

export function MeshList() {
  const [meshes, setMeshes] = useState<MeshMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadMeshes();
  }, []);

  async function loadMeshes() {
    try {
      setLoading(true);
      setError(null);
      const data = await meshAPI.listMeshes();
      setMeshes(data.meshes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meshes');
    } finally {
      setLoading(false);
    }
  }

  function handleMeshClick(meshName: string) {
    navigate(`/meshes/${meshName}`);
  }

  if (loading) {
    return (
      <div className="mesh-list">
        <div className="mesh-list-header">
          <h2>Meshes</h2>
        </div>
        <div className="mesh-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="mesh-card skeleton">
              <div className="skeleton-text skeleton-title"></div>
              <div className="skeleton-text skeleton-description"></div>
              <div className="skeleton-text skeleton-small"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mesh-list">
        <h2>Meshes</h2>
        <div className="error">
          <p>Error loading meshes: {error}</p>
          <button onClick={loadMeshes}>Retry</button>
        </div>
      </div>
    );
  }

  if (meshes.length === 0) {
    return (
      <div className="mesh-list">
        <h2>Meshes</h2>
        <div className="empty-state-large">
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="50" stroke="#dfe6e9" strokeWidth="2"/>
            <path d="M60 40v40M40 60h40" stroke="#bdc3c7" strokeWidth="2"/>
          </svg>
          <h3>No meshes found</h3>
          <p>The meshes/ directory is empty.</p>
          <p className="help-text">Create a new mesh by adding a directory with config.yaml</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mesh-list">
      <div className="mesh-list-header">
        <h2>Meshes ({meshes.length})</h2>
        <button onClick={loadMeshes} className="refresh-button">
          Refresh
        </button>
      </div>

      <div className="mesh-grid">
        {meshes.map((mesh) => (
          <div
            key={mesh.name}
            className="mesh-card"
            onClick={() => handleMeshClick(mesh.name)}
          >
            <div className="mesh-card-header">
              <h3>{mesh.name}</h3>
              <span className="mesh-badge">{mesh.configType.toUpperCase()}</span>
            </div>

            {mesh.description && (
              <p className="mesh-description">{mesh.description}</p>
            )}

            <div className="mesh-card-footer">
              <span className="mesh-stat">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/>
                </svg>
                {mesh.agents} {mesh.agents === 1 ? 'agent' : 'agents'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

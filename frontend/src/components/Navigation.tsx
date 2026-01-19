/**
 * Navigation.tsx
 * Global navigation header for the application.
 */

import { NavLink, useLocation } from 'react-router-dom';
import './Navigation.css';

export function Navigation() {
  const location = useLocation();

  // Extract current mesh name from path if present
  const meshMatch = location.pathname.match(/\/meshes\/([^/]+)/);
  const currentMesh = meshMatch ? meshMatch[1] : null;

  return (
    <nav className="nav">
      <div className="nav__brand">
        <NavLink to="/" className="nav__logo">
          TX Web
        </NavLink>
      </div>

      <div className="nav__links">
        <NavLink
          to="/"
          className={({ isActive }) => `nav__link ${isActive && location.pathname === '/' ? 'nav__link--active' : ''}`}
        >
          Dashboard
        </NavLink>

        <NavLink
          to="/meshes"
          className={({ isActive }) => `nav__link ${isActive && location.pathname.startsWith('/meshes') ? 'nav__link--active' : ''}`}
        >
          Meshes
        </NavLink>

        <NavLink
          to="/workspace"
          className={({ isActive }) => `nav__link ${isActive ? 'nav__link--active' : ''}`}
        >
          Workspace
        </NavLink>

        <NavLink
          to="/sessions"
          className={({ isActive }) => `nav__link ${isActive ? 'nav__link--active' : ''}`}
        >
          Sessions
        </NavLink>

        <NavLink
          to="/logs"
          className={({ isActive }) => `nav__link ${isActive ? 'nav__link--active' : ''}`}
        >
          Logs
        </NavLink>

        <NavLink
          to="/core"
          className={({ isActive }) => `nav__link nav__link--core ${isActive ? 'nav__link--active' : ''}`}
        >
          Core Agent
        </NavLink>

        {/* Mesh breadcrumb when viewing a specific mesh */}
        {currentMesh && (
          <>
            <span className="nav__separator">|</span>
            <NavLink
              to={`/meshes/${currentMesh}`}
              className={() => `nav__link nav__link--mesh ${location.pathname === `/meshes/${currentMesh}` ? 'nav__link--active' : ''}`}
            >
              {currentMesh}
            </NavLink>

            <span className="nav__separator">/</span>
            <NavLink
              to={`/meshes/${currentMesh}/activity`}
              className={() => `nav__link ${location.pathname === `/meshes/${currentMesh}/activity` ? 'nav__link--active' : ''}`}
            >
              Activity
            </NavLink>

            {location.pathname.includes('/run') && (
              <>
                <span className="nav__separator">/</span>
                <span className="nav__link nav__link--active">Session</span>
              </>
            )}
          </>
        )}
      </div>

      <div className="nav__actions">
        {/* Could add user menu or settings here */}
      </div>
    </nav>
  );
}

export default Navigation;

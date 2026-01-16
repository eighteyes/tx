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
        <NavLink to="/meshes" className="nav__logo">
          TX Web
        </NavLink>
      </div>

      <div className="nav__links">
        <NavLink
          to="/meshes"
          className={({ isActive }) => `nav__link ${isActive && location.pathname === '/meshes' ? 'nav__link--active' : ''}`}
        >
          Meshes
        </NavLink>

        {currentMesh && (
          <>
            <span className="nav__separator">/</span>
            <NavLink
              to={`/meshes/${currentMesh}`}
              className={({ isActive }) => `nav__link ${isActive && !location.pathname.includes('/run') ? 'nav__link--active' : ''}`}
            >
              {currentMesh}
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
        <NavLink to="/meshes" className="btn btn--ghost btn--sm">
          All Meshes
        </NavLink>
      </div>
    </nav>
  );
}

export default Navigation;

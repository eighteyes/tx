import type { ReactNode } from 'react';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="layout">
      <header className="header">
        <h1>TX Mesh Editor</h1>
        <nav>
          <a href="/meshes">Meshes</a>
        </nav>
      </header>
      <main className="main-content">
        {children}
      </main>
      <footer className="footer">
        <p>TX CLI v4 - Web Platform Phase 1</p>
      </footer>
    </div>
  );
}

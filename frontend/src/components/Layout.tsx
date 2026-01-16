import type { ReactNode } from 'react';
import { Navigation } from './Navigation';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="layout">
      <Navigation />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

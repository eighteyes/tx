/**
 * CollapsibleSection.tsx
 * Expandable/collapsible section for grouping form fields.
 * Responsibilities:
 * - Toggle section visibility
 * - Show item count badge
 * - Persist collapsed state (optional)
 */

import { useState, useCallback, type ReactNode } from 'react';
import './CollapsibleSection.css';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
  help?: string;
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  badge,
  help,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return (
    <div className={`collapsible-section ${isOpen ? 'collapsible-section--open' : ''}`}>
      <button
        type="button"
        className="collapsible-section__header"
        onClick={toggle}
        aria-expanded={isOpen}
      >
        <span className="collapsible-section__chevron">
          {isOpen ? '▼' : '▶'}
        </span>
        <span className="collapsible-section__title">{title}</span>
        {badge !== undefined && (
          <span className="collapsible-section__badge">{badge}</span>
        )}
        {help && (
          <span className="collapsible-section__help" title={help}>?</span>
        )}
      </button>
      {isOpen && (
        <div className="collapsible-section__content">
          {children}
        </div>
      )}
    </div>
  );
}

export default CollapsibleSection;

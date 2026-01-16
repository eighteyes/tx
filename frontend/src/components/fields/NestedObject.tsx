import type { ReactNode } from 'react';
import { useState } from 'react';

interface NestedObjectProps {
  label: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}

export function NestedObject({
  label,
  children,
  defaultExpanded = false,
}: NestedObjectProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="nested-object">
      <button
        type="button"
        className="nested-object-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
        {label}
      </button>
      {isExpanded && <div className="nested-object-content">{children}</div>}
    </div>
  );
}

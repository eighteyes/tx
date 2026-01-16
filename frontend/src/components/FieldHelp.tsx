/**
 * FieldHelp.tsx
 * Tooltip help icon for form fields.
 * Responsibilities:
 * - Show help icon next to field labels
 * - Display tooltip on hover
 */

import { useState } from 'react';
import './FieldHelp.css';

interface FieldHelpProps {
  text: string;
  position?: 'top' | 'right' | 'bottom' | 'left';
}

export function FieldHelp({ text, position = 'top' }: FieldHelpProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <span
      className="field-help"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <span className="field-help__icon">?</span>
      {isVisible && (
        <span className={`field-help__tooltip field-help__tooltip--${position}`}>
          {text}
        </span>
      )}
    </span>
  );
}

export default FieldHelp;

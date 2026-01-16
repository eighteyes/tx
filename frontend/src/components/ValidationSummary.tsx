/**
 * ValidationSummary.tsx
 * Display validation errors at the top of a form.
 */

import './ValidationSummary.css';

interface ValidationError {
  field: string;
  message: string;
}

interface ValidationSummaryProps {
  errors: ValidationError[];
  onDismiss?: () => void;
}

export function ValidationSummary({ errors, onDismiss }: ValidationSummaryProps) {
  if (errors.length === 0) return null;

  return (
    <div className="validation-summary">
      <div className="validation-summary__header">
        <span className="validation-summary__icon">⚠️</span>
        <span className="validation-summary__title">
          {errors.length} validation {errors.length === 1 ? 'error' : 'errors'}
        </span>
        {onDismiss && (
          <button
            className="validation-summary__dismiss"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      <ul className="validation-summary__list">
        {errors.map((error, index) => (
          <li key={index} className="validation-summary__item">
            <strong>{error.field}:</strong> {error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ValidationSummary;

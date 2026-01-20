/**
 * ErrorBoundary.tsx
 * Catch and display React errors gracefully.
 *
 * Supports two modes:
 * - fullPage: Covers entire viewport (for app-level boundary)
 * - inline: Fits within parent container (for route-level boundaries)
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Name of the component/route for better error context */
  name?: string;
  /** Display mode: fullPage for app-level, inline for route-level */
  mode?: 'fullPage' | 'inline';
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { mode = 'fullPage', name } = this.props;

    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const containerClass = mode === 'inline'
        ? 'error-boundary error-boundary--inline'
        : 'error-boundary';

      return (
        <div className={containerClass} role="alert">
          <div className="error-boundary__content">
            <div className="error-boundary__icon">⚠️</div>
            <h2>Something went wrong{name ? ` in ${name}` : ''}</h2>
            <p className="error-boundary__message">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <div className="error-boundary__actions">
              <button
                className="btn btn--primary"
                onClick={this.handleRetry}
              >
                Try Again
              </button>
              <button
                className="btn btn--secondary"
                onClick={this.handleReload}
              >
                Reload Page
              </button>
            </div>
            {import.meta.env.DEV && this.state.error?.stack && (
              <details className="error-boundary__details">
                <summary>Error Details (Dev Only)</summary>
                <pre>{this.state.error.stack}</pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Wrapper component for creating route-level error boundaries
 */
export function RouteErrorBoundary({
  children,
  name,
}: {
  children: ReactNode;
  name: string;
}) {
  return (
    <ErrorBoundary mode="inline" name={name}>
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;

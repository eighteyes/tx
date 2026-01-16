/**
 * LoadingSkeleton.tsx
 * Skeleton loading placeholders for better perceived performance.
 */

import './LoadingSkeleton.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  variant?: 'text' | 'circle' | 'rect';
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  variant = 'text',
  className = '',
}: SkeletonProps) {
  return (
    <div
      className={`skeleton skeleton--${variant} ${className}`}
      style={{ width, height }}
    />
  );
}

export function MessageSkeleton() {
  return (
    <div className="message-skeleton">
      <div className="message-skeleton__header">
        <Skeleton width="80px" height="0.75rem" />
        <Skeleton width="60px" height="0.75rem" />
      </div>
      <Skeleton width="90%" height="1rem" />
      <Skeleton width="70%" height="1rem" />
      <Skeleton width="40%" height="0.75rem" />
    </div>
  );
}

export function SessionSkeleton() {
  return (
    <div className="session-skeleton">
      <Skeleton width="60%" height="1.5rem" />
      <Skeleton width="100px" height="1rem" />
      <div className="session-skeleton__details">
        <Skeleton width="100%" height="0.875rem" />
        <Skeleton width="100%" height="0.875rem" />
        <Skeleton width="100%" height="0.875rem" />
      </div>
    </div>
  );
}

export default Skeleton;

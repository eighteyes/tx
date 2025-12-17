/**
 * Time formatting utilities
 */

/**
 * Format ISO timestamp to HH:MM:SS
 */
export function formatTime(isoString: string | number): string {
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format duration from milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Get elapsed time string from timestamp
 */
export function getElapsedTime(timestamp: string | number): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  return formatDuration(diffMs);
}

/**
 * Format time ago string
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  } else if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m ago`;
  } else if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)}h ago`;
  } else {
    return `${Math.floor(diffSec / 86400)}d ago`;
  }
}

/**
 * Parse time filter (e.g., "1h", "30m", "2025-11-03")
 */
export function parseTimeFilter(str: string): Date {
  // Relative time: 1h, 30m, 2d
  const relativeMatch = str.match(/^(\d+)([hmd])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2];
    const now = Date.now();

    switch (unit) {
      case 'h': return new Date(now - value * 3600000);
      case 'm': return new Date(now - value * 60000);
      case 'd': return new Date(now - value * 86400000);
    }
  }

  // Absolute time
  return new Date(str);
}

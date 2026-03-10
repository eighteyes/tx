/**
 * Standalone logger for soul-mcp
 *
 * Minimal logger that writes to stderr (MCP requirement: stdout is protocol)
 * Compatible with tx-core logging patterns but standalone.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

class Logger {
  private minLevel: LogLevel = 'info';

  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.minLevel];
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    // MCP servers must use stderr for logging (stdout is protocol)
    console.error(JSON.stringify(entry));
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      component,
      message,
      data,
    });
  }

  info(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      component,
      message,
      data,
    });
  }

  warn(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      component,
      message,
      data,
    });
  }

  error(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      component,
      message,
      data,
    });
  }
}

// Singleton instance
export const log = new Logger();

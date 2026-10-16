/**
 * Structured logging utility for consistent logging across services
 * 
 * Provides:
 * - Structured log entries with timestamps, levels, and context
 * - Performance measurement capabilities
 * - Log filtering and export
 * - Configurable log levels
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  operation: string;
  message: string;
  context?: Record<string, any>;
  duration?: number; // milliseconds
}

interface LogFilter {
  level?: LogLevel;
  service?: string;
  operation?: string;
  since?: Date;
}

export class StructuredLogger {
  private static enabled = true;
  private static minLevel = LogLevel.INFO;
  private static logs: LogEntry[] = [];
  private static maxLogs = 1000; // Keep last 1000 logs in memory

  /**
   * Set minimum log level (logs below this level will be ignored)
   */
  static setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Enable logging
   */
  static enable(): void {
    this.enabled = true;
  }

  /**
   * Disable logging (useful for production or testing)
   */
  static disable(): void {
    this.enabled = false;
  }

  /**
   * Check if a log level should be logged
   */
  private static shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;
    
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const minIndex = levels.indexOf(this.minLevel);
    const currentIndex = levels.indexOf(level);
    return currentIndex >= minIndex;
  }

  /**
   * Internal log method
   */
  private static log(
    level: LogLevel,
    service: string,
    operation: string,
    message: string,
    context?: Record<string, any>,
    duration?: number
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      operation,
      message,
      context,
      duration
    };

    // Store in memory
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }

    // Output to console with structured format
    const prefix = `[${entry.timestamp}] [${level}] [${service}] [${operation}]`;
    const logMethod = level === LogLevel.ERROR ? 'error' :
                     level === LogLevel.WARN ? 'warn' :
                     level === LogLevel.DEBUG ? 'debug' : 'log';

    if (context || duration !== undefined) {
      const metadata: Record<string, any> = {};
      if (context) metadata.context = context;
      if (duration !== undefined) metadata.duration = `${duration}ms`;
      
      console[logMethod](prefix, message, metadata);
    } else {
      console[logMethod](prefix, message);
    }
  }

  /**
   * Log debug message
   */
  static debug(service: string, operation: string, message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, service, operation, message, context);
  }

  /**
   * Log info message
   */
  static info(service: string, operation: string, message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, service, operation, message, context);
  }

  /**
   * Log warning message
   */
  static warn(service: string, operation: string, message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, service, operation, message, context);
  }

  /**
   * Log error message
   */
  static error(service: string, operation: string, message: string, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, service, operation, message, context);
  }

  /**
   * Measure execution time of an async operation
   * 
   * @param service - Service name
   * @param operation - Operation name
   * @param fn - Async function to measure
   * @returns Result of the function
   */
  static async measure<T>(
    service: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = Math.round(performance.now() - start);
      this.info(service, operation, 'Operation completed', { duration });
      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      this.error(service, operation, 'Operation failed', {
        error: error instanceof Error ? error.message : String(error),
        duration
      });
      throw error;
    }
  }

  /**
   * Measure execution time of a synchronous operation
   */
  static measureSync<T>(
    service: string,
    operation: string,
    fn: () => T
  ): T {
    const start = performance.now();
    try {
      const result = fn();
      const duration = Math.round(performance.now() - start);
      this.info(service, operation, 'Operation completed', { duration });
      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      this.error(service, operation, 'Operation failed', {
        error: error instanceof Error ? error.message : String(error),
        duration
      });
      throw error;
    }
  }

  /**
   * Export all logs for analysis
   */
  static exportLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by criteria
   */
  static getLogs(filter: LogFilter): LogEntry[] {
    return this.logs.filter(entry => {
      if (filter.level && entry.level !== filter.level) return false;
      if (filter.service && entry.service !== filter.service) return false;
      if (filter.operation && entry.operation !== filter.operation) return false;
      if (filter.since && new Date(entry.timestamp) < filter.since) return false;
      return true;
    });
  }

  /**
   * Clear all logs
   */
  static clear(): void {
    this.logs = [];
  }

  /**
   * Get log statistics
   */
  static getStats(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byService: Record<string, number>;
  } {
    const byLevel: Record<LogLevel, number> = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 0,
      [LogLevel.WARN]: 0,
      [LogLevel.ERROR]: 0
    };
    
    const byService: Record<string, number> = {};

    this.logs.forEach(entry => {
      byLevel[entry.level]++;
      byService[entry.service] = (byService[entry.service] || 0) + 1;
    });

    return {
      total: this.logs.length,
      byLevel,
      byService
    };
  }
}


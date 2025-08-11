// lib/common/logger.ts
// Centralized logging utility with log levels and configurable output

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  timestamp?: boolean;
  colorize?: boolean;
}

class Logger {
  private level: LogLevel;
  private prefix: string;
  private timestamp: boolean;
  private colorize: boolean;

  // ANSI color codes for terminal output
  private colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    gray: '\x1b[90m',
    green: '\x1b[32m',
    magenta: '\x1b[35m'
  };

  constructor(config?: Partial<LoggerConfig>) {
    // Get log level from environment or use INFO as default
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    const defaultLevel = envLevel ? (LogLevel[envLevel as keyof typeof LogLevel] ?? LogLevel.INFO) : LogLevel.INFO;
    
    this.level = config?.level ?? defaultLevel;
    this.prefix = config?.prefix || '';
    this.timestamp = config?.timestamp ?? true;
    this.colorize = config?.colorize ?? process.env.NODE_ENV !== 'production';
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const parts: string[] = [];
    
    if (this.timestamp) {
      const now = new Date().toISOString();
      parts.push(`[${now}]`);
    }
    
    parts.push(`[${level}]`);
    
    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }
    
    parts.push(message);
    
    return parts.join(' ');
  }

  private colorizeLevel(level: string, color: string): string {
    if (!this.colorize) return level;
    return `${color}${level}${this.colors.reset}`;
  }

  private log(level: LogLevel, levelName: string, color: string, message: string, ...args: any[]): void {
    if (level > this.level) return;
    
    const coloredLevel = this.colorizeLevel(levelName, color);
    const formattedMessage = this.formatMessage(coloredLevel, message);
    
    // Choose appropriate console method
    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage, ...args);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, ...args);
        break;
      default:
        console.log(formattedMessage, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, 'ERROR', this.colors.red, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, 'WARN', this.colors.yellow, message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, 'INFO', this.colors.green, message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, 'DEBUG', this.colors.blue, message, ...args);
  }

  trace(message: string, ...args: any[]): void {
    this.log(LogLevel.TRACE, 'TRACE', this.colors.gray, message, ...args);
  }

  // Create a child logger with a specific prefix
  child(prefix: string): Logger {
    const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new Logger({
      level: this.level,
      prefix: childPrefix,
      timestamp: this.timestamp,
      colorize: this.colorize
    });
  }

  // Utility method for structured logging
  json(level: LogLevel, message: string, data: any): void {
    const levelName = LogLevel[level];
    const color = level === LogLevel.ERROR ? this.colors.red :
                  level === LogLevel.WARN ? this.colors.yellow :
                  level === LogLevel.INFO ? this.colors.green :
                  level === LogLevel.DEBUG ? this.colors.blue :
                  this.colors.gray;
    
    if (level <= this.level) {
      this.log(level, levelName, color, message, JSON.stringify(data, null, 2));
    }
  }

  // Set log level dynamically
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  // Get current log level
  getLevel(): LogLevel {
    return this.level;
  }
}

// Create and export a default logger instance
const defaultLogger = new Logger();

// Export factory functions for creating specialized loggers
export function createLogger(prefix: string, config?: Partial<LoggerConfig>): Logger {
  return new Logger({
    ...config,
    prefix
  });
}

// Pre-configured loggers for different modules
export const rtmLogger = createLogger('RTM');
export const endpointLogger = createLogger('ENDPOINT');
export const conversationLogger = createLogger('CONVERSATION');
export const cacheLogger = createLogger('CACHE');
export const toolLogger = createLogger('TOOL');
export const llmLogger = createLogger('LLM');

// Export the default logger as well
export default defaultLogger;
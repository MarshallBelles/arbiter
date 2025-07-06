export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
}

export class Logger {
  private context: Record<string, any> = {};

  constructor(private name: string) {}

  withContext(context: Record<string, any>): Logger {
    const logger = new Logger(this.name);
    logger.context = { ...this.context, ...context };
    return logger;
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    this.log('error', message, context);
  }

  private log(level: LogEntry['level'], message: string, context?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context: { ...this.context, ...context, logger: this.name },
    };

    console.log(`[${entry.timestamp.toISOString()}] [${level.toUpperCase()}] [${this.name}] ${message}`, 
      entry.context ? JSON.stringify(entry.context) : '');
  }
}

export function createLogger(name: string): Logger {
  return new Logger(name);
}
interface LogContext {
  component?: string;
  turnId?: string;
  providerId?: string;
  [key: string]: any;
}

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

class Logger {
  private static instance: Logger;
  private level: number = LOG_LEVELS.INFO;
  private isDevelopment: boolean = 
    (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') || 
    (typeof window !== 'undefined' && (window as any).__DEV__ === true);

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLevel(level: LogLevel): void {
    this.level = LOG_LEVELS[level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.level;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context: LogContext = {}
  ): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const contextStr = Object.entries(context)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');

    const logMessage = `[${timestamp}] [${level}] ${message} ${contextStr}`;

    switch (level) {
      case 'ERROR':
        console.error(logMessage);
        break;
      case 'WARN':
        console.warn(logMessage);
        break;
      case 'INFO':
      case 'DEBUG':
      default:
        console.log(logMessage);
    }
  }

  public debug(message: string, context: LogContext = {}): void {
    this.formatMessage('DEBUG', message, context);
  }

  public info(message: string, context: LogContext = {}): void {
    this.formatMessage('INFO', message, context);
  }

  public warn(message: string, context: LogContext = {}): void {
    this.formatMessage('WARN', message, context);
  }

  public error(message: string, error?: Error, context: LogContext = {}): void {
    const errorContext = error
      ? { ...context, error: error.message, stack: error.stack }
      : context;
    this.formatMessage('ERROR', message, errorContext);
  }

  public async withLogging<T>(
    operation: string,
    fn: () => Promise<T>,
    context: LogContext = {}
  ): Promise<T> {
    const startTime = Date.now();
    this.info(`Starting: ${operation}`, context);

    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.info(`Completed: ${operation}`, {
        ...context,
        durationMs: duration,
        status: 'success',
      });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.error(`Failed: ${operation}`, error as Error, {
        ...context,
        durationMs: duration,
        status: 'error',
      });
      throw error;
    }
  }
}

export const logger = Logger.getInstance();

// Development helper to expose logger in console
if (typeof window !== 'undefined') {
  (window as any).logger = Logger.getInstance();
}

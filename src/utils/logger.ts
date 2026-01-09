import pino from 'pino';

// Create logger configuration based on environment
function createLoggerOptions(): pino.LoggerOptions {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const logLevel = process.env.LOG_LEVEL || 'info';

  const baseOptions: pino.LoggerOptions = {
    level: logLevel,
    // Add error serializers for both 'err' (Pino standard) and 'error' (common pattern)
    // This ensures Error objects are properly serialized with message, stack, and name
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  };

  if (isDevelopment) {
    // Pretty printing for development
    return {
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    };
  }

  // JSON output for production
  return baseOptions;
}

// Create the main logger instance
export const logger = pino(createLoggerOptions());

// Factory to create child loggers with request ID binding
export function createRequestLogger(requestId: string): pino.Logger {
  return logger.child({ requestId });
}

// Export types for use in other modules
export type Logger = pino.Logger;

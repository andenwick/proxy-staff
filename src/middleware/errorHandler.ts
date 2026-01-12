import { FastifyPluginAsync, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { createRequestLogger } from '../utils/logger.js';
import { getAlertService } from '../services/alertService.js';

// Custom application error class
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Error response shape
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

const errorHandlerPluginAsync: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler(
    async (error: FastifyError | AppError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.requestId || 'unknown';
      const logger = createRequestLogger(requestId);

      // Determine status code and error details
      let statusCode = 500;
      let code = 'INTERNAL_ERROR';
      let message = 'An internal error occurred';

      if (error instanceof AppError) {
        statusCode = error.statusCode;
        code = error.code;
        message = error.message;
      } else if ('statusCode' in error && typeof error.statusCode === 'number') {
        // Fastify validation errors or other Fastify errors
        statusCode = error.statusCode;
        code = error.code || 'REQUEST_ERROR';
        message = error.message;
      }

      // Log the error with full context
      const isProduction = process.env.NODE_ENV === 'production';
      logger.error({
        err: isProduction ? { message: error.message, code } : error,
        statusCode,
        url: request.url,
        method: request.method,
      }, `Request failed: ${message}`);

      // Alert on 500 errors (internal server errors)
      if (statusCode === 500) {
        const alertService = getAlertService();
        alertService.criticalError(
          'Internal Server Error',
          `${request.method} ${request.url} failed`,
          { error: error.message, requestId }
        ).catch(() => {}); // Fire and forget, don't block response
      }

      // Build error response
      const errorResponse: ErrorResponse = {
        success: false,
        error: {
          code,
          message: isProduction && statusCode === 500 ? 'An internal error occurred' : message,
          requestId,
        },
      };

      return reply.status(statusCode).send(errorResponse);
    }
  );
};

export const errorHandlerPlugin = fp(errorHandlerPluginAsync, {
  name: 'error-handler-plugin',
  dependencies: ['request-id-plugin'],
});

/**
 * Task Group 1 Tests: Logger Error Serialization
 *
 * Tests for:
 * - Error objects are serialized with message, stack, type properties
 * - Errors logged via logger.error({ error }, 'msg') produce readable output
 */

import pino from 'pino';

// Helper to capture log output
function createTestLogger(): { logger: pino.Logger; getOutput: () => string } {
  const output: string[] = [];

  const logger = pino({
    level: 'error',
    // Use same serializers as production logger
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  }, {
    write: (msg: string) => {
      output.push(msg);
    },
  });

  return {
    logger,
    getOutput: () => output.join(''),
  };
}

describe('Task Group 1: Logger Error Serialization', () => {
  describe('Error object serialization', () => {
    // Test 1: Error objects are serialized with message, stack, type properties
    test('Error objects are serialized with message, stack, and type properties', () => {
      const { logger, getOutput } = createTestLogger();

      const testError = new Error('Test error message');

      // Log using the 'err' key (standard Pino convention)
      logger.error({ err: testError }, 'An error occurred');

      const output = getOutput();
      const logEntry = JSON.parse(output);

      // Verify error properties are present and serialized correctly
      expect(logEntry.err).toBeDefined();
      expect(logEntry.err.message).toBe('Test error message');
      expect(logEntry.err.type).toBe('Error');
      expect(logEntry.err.stack).toBeDefined();
      expect(typeof logEntry.err.stack).toBe('string');
      expect(logEntry.err.stack).toContain('Error: Test error message');
    });

    // Test 2: Errors logged via logger.error({ error }, 'msg') produce readable output
    test('Errors logged via { error } key are also serialized (not logged as {})', () => {
      const { logger, getOutput } = createTestLogger();

      const testError = new Error('Another test error');

      // Log using the 'error' key (common developer pattern)
      logger.error({ error: testError }, 'Error happened');

      const output = getOutput();
      const logEntry = JSON.parse(output);

      // Verify the error is NOT logged as empty object {}
      expect(logEntry.error).toBeDefined();
      expect(logEntry.error).not.toEqual({});

      // Verify error properties are present
      expect(logEntry.error.message).toBe('Another test error');
      expect(logEntry.error.type).toBe('Error');
      expect(logEntry.error.stack).toBeDefined();
    });
  });
});

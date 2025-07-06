import { Logger, createLogger } from '../utils/logger';

// Mock console methods for testing
const mockConsoleLog = jest.fn();
global.console.log = mockConsoleLog;

describe('Logger', () => {
  beforeEach(() => {
    mockConsoleLog.mockClear();
  });

  describe('createLogger', () => {
    it('should create a logger with the specified name', () => {
      const logger = createLogger('test-logger');
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('logging methods', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger('test');
    });

    it('should log debug messages', () => {
      logger.debug('debug message');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [test] debug message'),
        expect.stringContaining('"logger":"test"')
      );
    });

    it('should log info messages', () => {
      logger.info('info message');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [test] info message'),
        expect.stringContaining('"logger":"test"')
      );
    });

    it('should log warn messages', () => {
      logger.warn('warn message');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] [test] warn message'),
        expect.stringContaining('"logger":"test"')
      );
    });

    it('should log error messages', () => {
      logger.error('error message');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [test] error message'),
        expect.stringContaining('"logger":"test"')
      );
    });
  });

  describe('context', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger('test');
    });

    it('should include context in log messages', () => {
      logger.info('message with context', { userId: '123', action: 'test' });
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [test] message with context'),
        expect.stringContaining('"userId":"123"')
      );
    });

    it('should support withContext method', () => {
      const contextLogger = logger.withContext({ service: 'api', version: '1.0' });
      contextLogger.info('test message');
      
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [test] test message'),
        expect.stringContaining('"service":"api"')
      );
    });

    it('should merge context from withContext and method call', () => {
      const contextLogger = logger.withContext({ service: 'api' });
      contextLogger.info('test message', { userId: '456' });
      
      const logCall = mockConsoleLog.mock.calls[0];
      expect(logCall[1]).toContain('"service":"api"');
      expect(logCall[1]).toContain('"userId":"456"');
    });

    it('should override context with method call context', () => {
      const contextLogger = logger.withContext({ key: 'original' });
      contextLogger.info('test message', { key: 'override' });
      
      const logCall = mockConsoleLog.mock.calls[0];
      expect(logCall[1]).toContain('"key":"override"');
    });
  });

  describe('log formatting', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger('formatter-test');
    });

    it('should include timestamp in ISO format', () => {
      logger.info('timestamp test');
      const logCall = mockConsoleLog.mock.calls[0][0];
      
      // Check for ISO timestamp format
      expect(logCall).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should include log level in uppercase', () => {
      logger.info('level test');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        expect.any(String)
      );
    });

    it('should include logger name', () => {
      logger.info('name test');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('[formatter-test]'),
        expect.any(String)
      );
    });

    it('should handle messages without context', () => {
      logger.info('simple message');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('simple message'),
        expect.stringContaining('"logger":"formatter-test"')
      );
    });
  });
});
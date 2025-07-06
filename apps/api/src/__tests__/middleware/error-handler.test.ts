import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../middleware/error-handler';
import { ArbiterError } from '@arbiter/core';

// Mock logger
jest.mock('@arbiter/core', () => ({
  ...jest.requireActual('@arbiter/core'),
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Error Handler Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    
    mockReq = {
      method: 'POST',
      url: '/api/test',
    };

    mockRes = {
      status: mockStatus,
      json: mockJson,
    };

    mockNext = jest.fn();

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('ArbiterError handling', () => {
    it('should handle ArbiterError with 400 status', () => {
      const error = new ArbiterError('Test error message', 'TEST_ERROR_CODE', { testContext: 'value' });

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'ArbiterError',
        message: 'Test error message',
        code: 'TEST_ERROR_CODE',
        context: { testContext: 'value' },
      });
    });

    it('should handle ArbiterError without context', () => {
      const error = new ArbiterError('Simple error', 'SIMPLE_ERROR');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'ArbiterError',
        message: 'Simple error',
        code: 'SIMPLE_ERROR',
        context: undefined,
      });
    });
  });

  describe('ValidationError handling', () => {
    it('should handle Joi validation errors with 400 status', () => {
      const error = new Error('Validation failed');
      error.name = 'ValidationError';
      (error as any).details = [
        { message: 'Field "name" is required', path: ['name'] },
        { message: 'Field "email" must be valid', path: ['email'] },
      ];

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Validation Error',
        message: 'Validation failed',
        details: [
          { message: 'Field "name" is required', path: ['name'] },
          { message: 'Field "email" must be valid', path: ['email'] },
        ],
      });
    });

    it('should handle validation errors without details', () => {
      const error = new Error('Validation error');
      error.name = 'ValidationError';

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Validation Error',
        message: 'Validation error',
        details: undefined,
      });
    });
  });

  describe('SyntaxError handling', () => {
    it('should handle JSON syntax errors with 400 status', () => {
      const error = new SyntaxError('Unexpected token } in JSON at position 1');
      (error as any).body = true; // Simulate express body parser error

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Invalid JSON',
        message: 'Request body contains invalid JSON',
      });
    });

    it('should not handle syntax errors without body property', () => {
      const error = new SyntaxError('Regular syntax error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Regular syntax error',
      });
    });
  });

  describe('Generic error handling', () => {
    it('should handle unknown errors with 500 status in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Unknown error occurred');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Unknown error occurred',
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle unknown errors with generic message in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new Error('Internal implementation details');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Something went wrong',
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle errors without message', () => {
      const error = new Error();

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: '',
      });
    });
  });

  describe('error logging', () => {
    it('should log error details with request information', () => {
      const error = new Error('Test error for logging');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      mockReq.method = 'GET';
      mockReq.url = '/api/workflows/123';

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      // Logger is mocked, but we can verify the error handler doesn't throw
      expect(mockStatus).toHaveBeenCalledWith(500);
    });

    it('should handle requests with missing method or url', () => {
      const error = new Error('Test error');
      
      mockReq.method = undefined;
      mockReq.url = undefined;

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle null error object', () => {
      const error = null as any;

      expect(() => {
        errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
      }).not.toThrow();

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Unknown error occurred',
      });
    });

    it('should handle error with circular references', () => {
      const error = new Error('Circular reference error');
      (error as any).circular = error; // Create circular reference

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalled();
    });

    it('should handle ArbiterError inheritance', () => {
      class CustomArbiterError extends ArbiterError {
        constructor(message: string) {
          super(message, 'CUSTOM_ERROR');
        }
      }

      const error = new CustomArbiterError('Custom error message');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'CustomArbiterError',
        message: 'Custom error message',
        code: 'CUSTOM_ERROR',
        context: undefined,
      });
    });

    it('should handle error with non-string message', () => {
      const error = new Error();
      (error as any).message = { complex: 'object' };

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: '[object Object]',
      });
    });
  });

  describe('response format consistency', () => {
    it('should always return JSON responses', () => {
      const errors = [
        new ArbiterError('Test', 'TEST'),
        new SyntaxError('JSON error'),
        new Error('Generic error'),
      ];

      // Add body property to syntax error
      (errors[1] as any).body = true;

      errors.forEach((error) => {
        jest.clearAllMocks();
        errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
        
        expect(mockJson).toHaveBeenCalledTimes(1);
        expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
          error: expect.any(String),
          message: expect.any(String),
        }));
      });
    });

    it('should never call next() function', () => {
      const errors = [
        new ArbiterError('Test', 'TEST'),
        new Error('Validation error'),
        new SyntaxError('JSON error'),
        new Error('Generic error'),
      ];

      errors[1].name = 'ValidationError';
      (errors[2] as any).body = true;

      errors.forEach((error) => {
        jest.clearAllMocks();
        errorHandler(error, mockReq as Request, mockRes as Response, mockNext);
        
        expect(mockNext).not.toHaveBeenCalled();
      });
    });
  });
});
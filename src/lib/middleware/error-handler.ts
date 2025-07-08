import { Request, Response, NextFunction } from 'express';
import { ArbiterError, createLogger } from '@/lib/core';

const logger = createLogger('ErrorHandler');

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Handle null/undefined errors
  if (!error) {
    error = new Error('Unknown error occurred');
  }

  // Log the error
  logger.error('Request error', {
    method: req.method,
    url: req.url,
    error: error.message,
    stack: error.stack,
  });

  // Handle specific error types
  if (error instanceof ArbiterError) {
    res.status(400).json({
      error: error.constructor.name,
      message: String(error.message),
      code: error.code,
      context: error.context,
    });
    return;
  }

  // Handle validation errors (Joi)
  if (error.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation Error',
      message: error.message,
      details: (error as any).details,
    });
    return;
  }

  // Handle syntax errors (JSON parsing)
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains invalid JSON',
    });
    return;
  }

  // Default error response
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong' 
      : String(error.message),
  });
}
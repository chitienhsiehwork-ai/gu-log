/**
 * Global Error Handler Middleware
 *
 * Catches all unhandled errors and returns a consistent JSON response.
 * Handles MetricNotFoundError specifically with 404 status.
 */

import type { ErrorHandler } from 'hono';
import { MetricNotFoundError } from '../services/metrics-reader.js';
import type { ErrorResponse } from '../types/metrics.js';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[ERROR] ${err.message}`, err.stack);

  if (err instanceof MetricNotFoundError) {
    const body: ErrorResponse = {
      error: err.message,
      code: 404,
    };
    return c.json(body, 404);
  }

  // SyntaxError from JSON.parse
  if (err instanceof SyntaxError) {
    const body: ErrorResponse = {
      error: 'Invalid data format',
      code: 500,
      details: err.message,
    };
    return c.json(body, 500);
  }

  const body: ErrorResponse = {
    error: 'Internal server error',
    code: 500,
  };
  return c.json(body, 500);
};

/**
 * Request Logger Middleware
 *
 * Logs every request with method, path, status code, and duration.
 * Uses console output — no external logging library needed.
 */

import type { MiddlewareHandler } from 'hono';

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = (performance.now() - start).toFixed(1);
  const status = c.res.status;

  const statusColor =
    status >= 500
      ? '\x1b[31m' // red
      : status >= 400
        ? '\x1b[33m' // yellow
        : '\x1b[32m'; // green
  const reset = '\x1b[0m';

  console.log(
    `${method} ${path} ${statusColor}${status}${reset} ${duration}ms`
  );
};

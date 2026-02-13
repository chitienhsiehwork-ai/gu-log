/**
 * SQAA Dashboard API — Hono Application
 *
 * Separated from the server entry point for testability.
 * All routes, middleware, and error handling are configured here.
 */

import { Hono } from 'hono';
import { requestLogger } from './middleware/logger.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import health from './routes/health.js';
import overview from './routes/overview.js';
import security from './routes/security.js';
import eslint from './routes/eslint.js';
import lighthouse from './routes/lighthouse.js';
import coverage from './routes/coverage.js';
import bundle from './routes/bundle.js';
import links from './routes/links.js';
import dependencies from './routes/dependencies.js';
import content from './routes/content.js';

const app = new Hono();

// ─── Middleware ───────────────────────────────────────────
app.use('*', corsMiddleware);
app.use('*', requestLogger);
app.onError(errorHandler);

// ─── Routes ──────────────────────────────────────────────
app.route('/api/health', health);
app.route('/api/metrics/overview', overview);
app.route('/api/metrics/security', security);
app.route('/api/metrics/eslint', eslint);
app.route('/api/metrics/lighthouse', lighthouse);
app.route('/api/metrics/coverage', coverage);
app.route('/api/metrics/bundle', bundle);
app.route('/api/metrics/links', links);
app.route('/api/metrics/dependencies', dependencies);
app.route('/api/metrics/content', content);

// ─── 404 fallback ────────────────────────────────────────
app.notFound((c) => {
  return c.json(
    {
      error: `Not found: ${c.req.path}`,
      code: 404,
    },
    404
  );
});

export default app;

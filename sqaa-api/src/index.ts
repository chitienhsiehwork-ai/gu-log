/**
 * SQAA Dashboard API — Server Entry Point
 *
 * Starts the Hono server on port 3001 (or PORT env var).
 * Uses @hono/node-server for Node.js runtime.
 */

import { serve } from '@hono/node-server';
import app from './app.js';

const port = Number(process.env['PORT'] ?? 3001);

console.log(`
┌─────────────────────────────────────────┐
│  SQAA Dashboard API                     │
│  Port: ${String(port).padEnd(33)}│
│  Endpoints: /api/health                 │
│             /api/metrics/overview        │
│             /api/metrics/security        │
│             /api/metrics/eslint          │
│             /api/metrics/lighthouse      │
│             /api/metrics/coverage        │
│             /api/metrics/bundle          │
│             /api/metrics/links           │
│             /api/metrics/dependencies    │
│             /api/metrics/content         │
└─────────────────────────────────────────┘
`);

serve(
  { fetch: app.fetch, port },
  (info) => {
    console.log(`Server listening on http://localhost:${info.port}`);
  }
);

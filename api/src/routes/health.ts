/**
 * Health Check Endpoint
 *
 * GET /api/health
 *
 * Returns server status, version, uptime, and current timestamp.
 * Used by monitoring systems and load balancers.
 */

import { Hono } from 'hono';
import type { HealthResponse } from '../types/metrics.js';

const health = new Hono();

const startTime = Date.now();

health.get('/', (c) => {
  const response: HealthResponse = {
    status: 'ok',
    version: '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  };
  return c.json(response);
});

export default health;

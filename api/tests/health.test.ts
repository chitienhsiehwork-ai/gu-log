/**
 * Tests for GET /api/health
 */

import { describe, it, expect } from 'vitest';
import app from '../src/app.js';

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.0.0');
    expect(typeof body.uptime).toBe('number');
    expect(body.timestamp).toBeDefined();
  });

  it('returns valid ISO timestamp', async () => {
    const res = await app.request('/api/health');
    const body = await res.json();
    const date = new Date(body.timestamp);
    expect(date.toISOString()).toBe(body.timestamp);
  });
});

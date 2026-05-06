/**
 * Coverage tests for the 7 untested SQAA-API metric routes.
 *
 * Uses the real quality/ data shipped in the repo (same approach as
 * tests/overview.test.ts) so we don't have to mock the metrics-reader.
 */
import { describe, it, expect } from 'vitest';
import app from '../src/app.js';

describe('GET /api/metrics/security', () => {
  it('returns 200 with current/baseline/history/trend', async () => {
    const r = await app.request('/api/metrics/security');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.current).toBeDefined();
    expect(body.baseline).toBeDefined();
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.trend).toBeDefined();
    expect(typeof body.current.total).toBe('number');
    expect(typeof body.current.hasHighOrCritical).toBe('boolean');
  });

  it('GET /history with bad limit returns 400', async () => {
    const r = await app.request('/api/metrics/security/history?limit=abc');
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBeDefined();
  });

  it('GET /history?limit=5 returns at most 5 entries', async () => {
    const r = await app.request('/api/metrics/security/history?limit=5');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBeLessThanOrEqual(5);
    expect(body.total).toBe(body.history.length);
  });
});

describe('GET /api/metrics/eslint', () => {
  it('returns 200 with baseline + current', async () => {
    const r = await app.request('/api/metrics/eslint');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.baseline).toBeDefined();
    expect(typeof body.baseline.errors).toBe('number');
    expect(typeof body.baseline.warnings).toBe('number');
  });
});

describe('GET /api/metrics/lighthouse', () => {
  it('returns 200 with current scores', async () => {
    const r = await app.request('/api/metrics/lighthouse');
    expect(r.status).toBe(200);
    const body = await r.json();
    // Either current present (after collect) or null
    expect(body).toHaveProperty('current');
  });
});

describe('GET /api/metrics/coverage', () => {
  it('returns 200 with statements/lines numbers', async () => {
    const r = await app.request('/api/metrics/coverage');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.baseline).toBeDefined();
    if (body.current) {
      expect(typeof body.current.statements).toBe('number');
    }
  });
});

describe('GET /api/metrics/bundle', () => {
  it('returns 200 with baseline shape', async () => {
    const r = await app.request('/api/metrics/bundle');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.baseline).toBeDefined();
  });
});

describe('GET /api/metrics/links', () => {
  it('returns 200 with broken-links shape', async () => {
    const r = await app.request('/api/metrics/links');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('baseline');
  });
});

describe('GET /api/metrics/dependencies', () => {
  it('returns 200 with dependency-freshness shape', async () => {
    const r = await app.request('/api/metrics/dependencies');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('baseline');
  });
});

describe('GET /api/metrics/content', () => {
  it('returns 200 with velocity shape', async () => {
    const r = await app.request('/api/metrics/content');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty('baseline');
  });
});

describe('error handling', () => {
  it('unknown route returns 404 with shaped error', async () => {
    const r = await app.request('/api/nonexistent-endpoint');
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toMatch(/Not found/);
    expect(body.code).toBe(404);
  });

  it('CORS allows localhost origin', async () => {
    const r = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:3000' },
    });
    // Hono cors() echoes the allowed origin back in ACAO
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('CORS rejects disallowed origin (no ACAO header)', async () => {
    const r = await app.request('/api/health', {
      headers: { Origin: 'https://evil.example.com' },
    });
    // Disallowed origins get an empty origin string back, which Hono either
    // omits or sets to "" — both behaviours indicate the origin is rejected.
    const aco = r.headers.get('access-control-allow-origin');
    expect(aco === null || aco === '').toBe(true);
  });
});

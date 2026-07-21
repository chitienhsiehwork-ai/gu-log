import { describe, expect, it } from 'vitest';
import { evaluateExternalScanHealth } from '../scripts/check-links.mjs';

const responseFailures = (...statusCodes: number[]) =>
  statusCodes.map((statusCode) => ({ statusCode }));

const transportFailures = (count: number) =>
  Array.from({ length: count }, () => ({ error: 'fetch failed' }));

describe('broken-link external scan health', () => {
  it('GIVEN a scan dominated by transport failures WHEN health is evaluated THEN it is rejected', () => {
    const result = evaluateExternalScanHealth({
      internalOnly: false,
      attempted: 10,
      ok: 4,
      broken: transportFailures(6),
      timedOut: 0,
    });

    expect(result).toMatchObject({
      healthy: false,
      transportFailures: 6,
      totalFailures: 6,
      failureRatio: 0.6,
    });
  });

  it('GIVEN every check receives a proxy error response WHEN health is evaluated THEN it is rejected', () => {
    const result = evaluateExternalScanHealth({
      internalOnly: false,
      attempted: 6,
      ok: 0,
      broken: responseFailures(403, 429, 503, 403, 429, 503),
      timedOut: 0,
    });

    expect(result).toMatchObject({
      healthy: false,
      responseFailures: 6,
      transportFailures: 0,
      totalFailures: 6,
      failureRatio: 1,
    });
  });

  it('GIVEN a normal scan with a small broken-link ratio WHEN health is evaluated THEN it is accepted', () => {
    const result = evaluateExternalScanHealth({
      internalOnly: false,
      attempted: 20,
      ok: 19,
      broken: responseFailures(404),
      timedOut: 0,
    });

    expect(result).toMatchObject({
      healthy: true,
      responseFailures: 1,
      totalFailures: 1,
      failureRatio: 0.05,
    });
  });

  it('GIVEN HTTP response failures exactly reach the ratio boundary WHEN health is evaluated THEN it is rejected', () => {
    const result = evaluateExternalScanHealth({
      internalOnly: false,
      attempted: 10,
      ok: 5,
      broken: responseFailures(404, 403, 429, 500, 503),
      timedOut: 0,
    });

    expect(result).toMatchObject({
      healthy: false,
      responseFailures: 5,
      totalFailures: 5,
      failureRatio: 0.5,
    });
  });

  it('GIVEN failures immediately below the ratio boundary WHEN health is evaluated THEN it is accepted', () => {
    const result = evaluateExternalScanHealth({
      internalOnly: false,
      attempted: 10,
      ok: 6,
      broken: responseFailures(404, 403, 429, 503),
      timedOut: 0,
    });

    expect(result).toMatchObject({
      healthy: true,
      totalFailures: 4,
      failureRatio: 0.4,
    });
  });

  it('GIVEN only a few broken links in a tiny scan WHEN health is evaluated THEN they are not mistaken for an outage', () => {
    const result = evaluateExternalScanHealth({
      internalOnly: false,
      attempted: 4,
      ok: 0,
      broken: responseFailures(404, 404, 404, 404),
      timedOut: 0,
    });

    expect(result).toMatchObject({
      healthy: true,
      totalFailures: 4,
      failureRatio: 1,
    });
  });

  it('GIVEN response and transport failures together reach the boundary WHEN health is evaluated THEN it is rejected', () => {
    const result = evaluateExternalScanHealth({
      internalOnly: false,
      attempted: 10,
      ok: 5,
      broken: [...responseFailures(403, 429, 503), ...transportFailures(1)],
      timedOut: 1,
    });

    expect(result).toMatchObject({
      healthy: false,
      responseFailures: 3,
      transportFailures: 2,
      totalFailures: 5,
      failureRatio: 0.5,
    });
  });

  it('GIVEN internal-only mode WHEN health is evaluated THEN skipped external checks do not fail', () => {
    expect(
      evaluateExternalScanHealth({
        internalOnly: true,
        attempted: 10,
        ok: 0,
        broken: [],
        timedOut: 0,
      })
    ).toMatchObject({ healthy: true, skipped: true });
  });
});

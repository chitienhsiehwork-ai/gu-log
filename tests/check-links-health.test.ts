import { describe, expect, it } from 'vitest';
import {
  evaluateExternalScanHealth,
  isManualCheckDomain,
  isReservedExampleUrl,
} from '../scripts/check-links.mjs';

const responseFailures = (...statusCodes: number[]) =>
  statusCodes.map((statusCode) => ({ statusCode }));

const transportFailures = (count: number) =>
  Array.from({ length: count }, () => ({ error: 'fetch failed' }));

describe('broken-link reserved example URL detection', () => {
  it.each(['https://example.com/x', 'https://docs.example.com/x', '//example.com/x'])(
    'recognizes the RFC-reserved example.com host: %s',
    (url) => {
      expect(isReservedExampleUrl(url)).toBe(true);
    }
  );

  it.each([
    'https://notexample.com/x',
    'https://example.com.evil.test/x',
    'https://evil.test/?next=https://example.com/x',
    '/posts/example.com',
  ])('does not skip a real URL that merely contains example.com: %s', (url) => {
    expect(isReservedExampleUrl(url)).toBe(false);
  });
});

describe('broken-link manual-check domain detection', () => {
  it.each([
    'https://www.deeplearning.ai/the-batch/issue-341/',
    'https://deeplearning.ai/courses/agent-skills-with-anthropic',
    'https://news.ycombinator.com/item?id=46945755',
  ])('routes a domain with stable CI anti-bot responses to manual review: %s', (url) => {
    expect(isManualCheckDomain(url)).toBe(true);
  });

  it.each([
    'https://ycombinator.com/',
    'https://news.ycombinator.com.evil.test/item?id=1',
    'https://example.com/?next=https://www.deeplearning.ai/the-batch/',
  ])('does not broaden a manual-review exception through substring matching: %s', (url) => {
    expect(isManualCheckDomain(url)).toBe(false);
  });
});

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

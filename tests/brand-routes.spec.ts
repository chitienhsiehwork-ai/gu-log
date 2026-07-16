import { test, expect } from './fixtures';

const canonicalListings = ['/gu-log-picks', '/mogu-picks', '/en/gu-log-picks', '/en/mogu-picks'];

const retiredListings = [
  '/clawd-picks',
  '/shroomdog-picks',
  '/shroom-picks',
  '/en/clawd-picks',
  '/en/shroomdog-picks',
  '/en/shroom-picks',
];

test.describe('Mogu / GP / MP breaking route contract', () => {
  test('GIVEN canonical listing routes WHEN requested THEN each serves directly', async ({
    request,
  }) => {
    for (const route of canonicalListings) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(200);
    }
  });

  test('GIVEN retired listing routes WHEN requested THEN each is a direct 404', async ({
    request,
  }) => {
    for (const route of retiredListings) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(404);
      expect(response.headers().location, route).toBeUndefined();
    }
  });

  test('GIVEN a migrated post WHEN old and new slugs are requested THEN only GP resolves', async ({
    request,
  }) => {
    const canonical = '/posts/gp-7-20260130-clawdbot-architecture-deep-dive';
    const retired = '/posts/sp-7-20260130-clawdbot-architecture-deep-dive';

    expect((await request.get(canonical)).status()).toBe(200);
    const retiredResponse = await request.get(retired, { maxRedirects: 0 });
    expect(retiredResponse.status()).toBe(404);
    expect(retiredResponse.headers().location).toBeUndefined();
  });

  test('GIVEN migrated companion artifacts WHEN requested THEN old SP paths stay retired', async ({
    request,
  }) => {
    expect((await request.get('/artifacts/gp-194-html-loop/')).status()).toBe(200);
    expect((await request.get('/artifacts/gp-245-trim-noop/')).status()).toBe(200);
    expect((await request.get('/artifacts/gp-251-unknowns/index.html')).status()).toBe(200);

    for (const route of [
      '/artifacts/sp-194-html-loop/',
      '/artifacts/sp-245-trim-noop/',
      '/artifacts/sp-251-unknowns/index.html',
    ]) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(404);
      expect(response.headers().location, route).toBeUndefined();
    }
  });

  test('GIVEN public persona assets WHEN requested THEN only the Mogu icon remains', async ({
    request,
  }) => {
    expect((await request.get('/mogu-picks-icon.png')).status()).toBe(200);
    for (const route of ['/clawd-icon.png', '/clawd-picks-icon.png']) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status(), route).toBe(404);
    }
  });
});

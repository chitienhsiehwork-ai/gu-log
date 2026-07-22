import { test, expect } from './fixtures';

// Scope boundary: local Astro never loads vercel.mjs (Vercel only evaluates
// it at its own edge), so every retired route here MUST stay a direct 404.
// The public 308 redirect contract lives in tests/vercel-routing-config.test.ts
// (config) and the deploy smoke test (real edge) — don't add 308s here.

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

  test('GIVEN an unknown public route WHEN requested THEN the branded 404 keeps readers inside gu-log', async ({
    page,
  }) => {
    for (const route of ['/missing-rebrand-route', '/en/missing-rebrand-route']) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(404);
      await expect(page.locator('#not-found-title')).toContainText('Page not found');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow'
      );
      await expect(page.locator('.recovery-links a[href="/"]')).toBeVisible();
      await expect(page.locator('[data-search-trigger]')).toBeVisible();
    }
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`GIVEN the ${theme} header WHEN navigating by keyboard THEN every control has a visible focus ring`, async ({
      page,
    }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem('theme', selectedTheme);
      }, theme);
      await page.goto('/');

      for (const selector of [
        '.site-title',
        '[data-search-trigger]',
        '.nav-icons .icon-btn',
        '.nav-icons .theme-toggle',
        '#hamburger-btn',
      ]) {
        await page.keyboard.press('Tab');
        const control = page.locator(selector);
        await expect(control).toBeFocused();
        const ring = await control.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            style: style.outlineStyle,
            width: Number.parseFloat(style.outlineWidth),
          };
        });
        expect(ring.style, selector).toBe('solid');
        expect(ring.width, selector).toBeGreaterThanOrEqual(2);
      }
    });
  }

  test('GIVEN the hamburger menu WHEN opened THEN the Mogu Picks link points directly at the canonical route per locale', async ({
    page,
  }) => {
    for (const [path, expectedHref] of [
      ['/', '/mogu-picks'],
      ['/en', '/en/mogu-picks'],
    ] as const) {
      await page.goto(path);
      await page.click('#hamburger-btn');
      await page.waitForSelector('#hamburger-menu.menu-open');

      const moguLink = page.locator('#hamburger-menu a[href$="mogu-picks"]');
      await expect(moguLink).toHaveAttribute('href', expectedHref);

      await moguLink.click();
      await page.waitForURL(`**${expectedHref}`);
      expect(new URL(page.url()).pathname).toBe(expectedHref);
    }
  });
});

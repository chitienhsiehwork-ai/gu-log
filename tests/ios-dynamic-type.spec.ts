import { test, expect } from './fixtures';

test.describe('iOS Dynamic Type layout', () => {
  test('GIVEN iPhone Safari at 200% text size WHEN key reading pages render THEN text scales without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const isMobileSafari = test.info().project.name === 'Mobile Safari';

    for (const route of ['/', '/posts/gp-245-20260624-mattpocockuk-skill-no-op/']) {
      await page.goto(route);

      if (isMobileSafari) {
        const dynamicType = await page.evaluate(() => ({
          supportsSystemBody: CSS.supports('font', '-apple-system-body'),
          usesTouchLayout: matchMedia('(hover: none)').matches,
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
        }));
        expect(dynamicType.supportsSystemBody).toBe(true);
        expect(dynamicType.usesTouchLayout).toBe(true);
        expect(
          dynamicType.rootFontSize,
          `Dynamic Type root metric did not apply on ${route}`
        ).not.toBe('16px');
      }

      await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });

      const layout = await page.evaluate(() => ({
        bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        offenders: [...document.querySelectorAll<HTMLElement>('*')]
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.right > document.documentElement.clientWidth + 1 || bounds.left < -1;
          })
          .slice(0, 8)
          .map((element) => `${element.tagName}.${element.className}`),
      }));

      expect(layout.bodyFontSize, `Body text did not scale on ${route}`).toBeGreaterThanOrEqual(32);
      expect(
        layout.scrollWidth,
        `Horizontal overflow on ${route} at 200% text size: ${layout.offenders.join(' | ')}`
      ).toBeLessThanOrEqual(layout.clientWidth);

      if (route.startsWith('/posts/')) {
        const metadataTokens = await page
          .locator('.ticket-badge, .meta-date')
          .evaluateAll((tokens) =>
            tokens.map((token) => ({
              text: token.textContent?.trim(),
              whiteSpace: getComputedStyle(token).whiteSpace,
            }))
          );
        expect(metadataTokens, 'Ticket ID and date must wrap as whole tokens').toEqual(
          metadataTokens.map((token) => ({ ...token, whiteSpace: 'nowrap' }))
        );
      }
    }
  });
});

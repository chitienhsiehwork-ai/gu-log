import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * BDD Tests for Table of Contents (TOC)
 *
 * These tests ensure TOC functionality works correctly across devices.
 * Run with: npx playwright test tests/toc.spec.ts
 */

test.describe('Table of Contents', () => {
  // Use a post that definitely has TOC (multiple h2 headings)
  const testPostUrl = '/posts/gp-24-20260204-claude-is-a-space-to-think';

  test('GIVEN a post with TOC WHEN the page loads THEN one shared external runtime owns the behavior', async ({
    page,
  }) => {
    await page.goto(testPostUrl);

    await expect(
      page.locator('script[type="module"][src*="table-of-contents-client"]')
    ).toHaveCount(1);
    const inlineScripts = await page.locator('script:not([src])').allTextContents();
    expect(inlineScripts.join('\n')).not.toContain('initTableOfContents');
  });

  async function scrollPastHeader(page: Page) {
    await page.evaluate(() => {
      const header = document.querySelector('.post-header');
      const desktopToc = document.querySelector('.toc-desktop');
      if (!(header instanceof HTMLElement) || !(desktopToc instanceof HTMLElement)) {
        throw new Error('Expected post header and desktop TOC');
      }

      const tocTop = Number.parseFloat(getComputedStyle(desktopToc).top);
      const revealScrollY = window.scrollY + header.getBoundingClientRect().bottom - tocTop + 24;
      window.scrollTo(0, revealScrollY);
    });

    await expect(page.locator('.toc-desktop')).toHaveAttribute('data-visible', 'true');
  }

  // Configure retries for flaky TOC animations
  test.describe.configure({ retries: 2 });

  test.describe('Mobile TOC (@mobile)', () => {
    test.use({ viewport: { width: 390, height: 844 } }); // iPhone 13

    test('GIVEN a post with headings WHEN page loads THEN TOC toggle should be visible', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const tocToggle = page.locator('.toc-mobile .toc-toggle-header');
      await expect(tocToggle).toBeVisible();
    });

    test('GIVEN TOC is collapsed WHEN user clicks toggle THEN TOC should expand', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const container = page.locator('.toc-mobile .toc-toggle-container');
      const toggle = page.locator('.toc-mobile .toc-toggle-header');
      const wrapper = page.locator('.toc-mobile .toc-toggle-wrapper');
      const content = page.locator('.toc-mobile .toc-content');

      // Verify initial state is collapsed
      await expect(container).toHaveAttribute('data-open', 'false');
      await expect(toggle).toHaveAttribute('aria-controls', 'toc-mobile-content');
      await expect(wrapper).toHaveAttribute('inert', '');
      await expect(content).toHaveCSS('border-left-width', '0px');
      await expect(toggle).toHaveCSS('border-left-width', '0px');

      // Click to expand
      await toggle.click();

      // Verify expanded state
      await expect(container).toHaveAttribute('data-open', 'true');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(wrapper).not.toHaveAttribute('inert', '');
      await expect(content).toHaveCSS('border-left-width', '1px');
      await expect(content).toHaveCSS('border-left-color', /rgb/);
      await expect(toggle).toHaveCSS('border-left-width', '0px');
    });

    test('GIVEN TOC is expanded WHEN user clicks toggle THEN TOC should collapse', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const container = page.locator('.toc-mobile .toc-toggle-container');
      const toggle = page.locator('.toc-mobile .toc-toggle-header');
      const wrapper = page.locator('.toc-mobile .toc-toggle-wrapper');

      // Expand first
      await toggle.click();
      await expect(container).toHaveAttribute('data-open', 'true');

      // Click to collapse
      await toggle.click();

      // Verify collapsed state
      await expect(container).toHaveAttribute('data-open', 'false');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(wrapper).toHaveAttribute('inert', '');
    });

    test('GIVEN TOC is collapsed WHEN keyboard user tabs past the toggle THEN hidden links are skipped until expanded', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const toggle = page.locator('.toc-mobile .toc-toggle-header');
      const firstLink = page.locator('.toc-mobile .toc-link').first();

      await toggle.focus();
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('.toc-mobile .toc-toggle-wrapper') === null
        )
      ).toBe(true);

      await toggle.click();
      await page.keyboard.press('Tab');
      await expect(firstLink).toBeFocused();
    });

    test('GIVEN Astro reinitializes the page WHEN the user toggles TOC once THEN one listener owns the disclosure state', async ({
      page,
    }) => {
      await page.goto(testPostUrl);
      await page.evaluate(() => document.dispatchEvent(new Event('astro:page-load')));

      const container = page.locator('.toc-mobile .toc-toggle-container');
      const toggle = page.locator('.toc-mobile .toc-toggle-header');
      await toggle.click();

      await expect(container).toHaveAttribute('data-open', 'true');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    test('GIVEN Astro reinitializes the page WHEN a collapsed TOC link is used THEN navigation and scroll each run once', async ({
      page,
    }) => {
      await page.goto(testPostUrl);
      await page.evaluate(() => {
        document.documentElement.dataset.tocPushCount = '0';
        document.documentElement.dataset.tocScrollCount = '0';
        const originalPushState = history.pushState.bind(history);
        history.pushState = (data, unused, url) => {
          const root = document.documentElement;
          root.dataset.tocPushCount = String(Number(root.dataset.tocPushCount) + 1);
          originalPushState(data, unused, url);
        };
        Object.defineProperty(window, 'scrollTo', {
          configurable: true,
          value: () => {
            const root = document.documentElement;
            root.dataset.tocScrollCount = String(Number(root.dataset.tocScrollCount) + 1);
          },
        });
        document.dispatchEvent(new Event('astro:page-load'));
      });

      await page
        .locator('.toc-mobile .toc-link')
        .first()
        .evaluate((link) => (link as HTMLElement).click());

      await expect(page.locator('html')).toHaveAttribute('data-toc-push-count', '1');
      await expect(page.locator('html')).toHaveAttribute('data-toc-scroll-count', '1');
    });

    test('GIVEN a mobile TOC scroll is pending WHEN Astro reinitializes THEN the stale timer cannot scroll the new lifecycle', async ({
      page,
    }) => {
      await page.goto(testPostUrl);
      const toggle = page.locator('.toc-mobile .toc-toggle-header');
      await toggle.click();

      await page.evaluate(() => {
        document.documentElement.dataset.tocScrollCount = '0';
        Object.defineProperty(window, 'scrollTo', {
          configurable: true,
          value: () => {
            const root = document.documentElement;
            root.dataset.tocScrollCount = String(Number(root.dataset.tocScrollCount) + 1);
          },
        });
      });

      await page.locator('.toc-mobile .toc-link').first().click();
      await page.evaluate(() => document.dispatchEvent(new Event('astro:page-load')));
      await page.waitForTimeout(450);

      await expect(page.locator('html')).toHaveAttribute('data-toc-scroll-count', '0');
    });

    test('GIVEN TOC is expanded WHEN user clicks a heading link THEN page should scroll to heading AND TOC should collapse', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const container = page.locator('.toc-mobile .toc-toggle-container');
      const toggle = page.locator('.toc-mobile .toc-toggle-header');
      const wrapper = page.locator('.toc-mobile .toc-toggle-wrapper');

      // Expand TOC
      await toggle.click();
      await expect(container).toHaveAttribute('data-open', 'true');

      // Click first heading link
      const firstLink = page.locator('.toc-mobile .toc-link').first();
      const targetId = await firstLink.getAttribute('data-heading-id');
      expect(targetId).toBeTruthy();

      await firstLink.click();

      // Wait for collapse (animation is 400ms in component)
      await expect(container).toHaveAttribute('data-open', 'false', { timeout: 5000 });
      await expect(wrapper).toHaveAttribute('inert', '');
      await expect(toggle).toBeFocused();

      // URL should have hash (use decodeURIComponent for Chinese characters)
      const currentUrl = decodeURIComponent(page.url());
      expect(currentUrl).toContain(`#${targetId}`);
    });

    test('GIVEN TOC has heading links WHEN rendered THEN all links should have valid targets', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      // Expand TOC to see links
      await page.locator('.toc-mobile .toc-toggle-header').click();

      const links = page.locator('.toc-mobile .toc-link');
      const count = await links.count();

      expect(count).toBeGreaterThan(0);

      // Check each link has a valid target
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const box = await link.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        const targetId = await link.getAttribute('data-heading-id');
        expect(targetId).toBeTruthy();

        // Verify target element exists
        const target = page.locator(`#${targetId}`);
        await expect(target).toBeAttached();
      }
    });
  });

  test('GIVEN a lookalike link outside the TOC WHEN Astro reinitializes THEN the TOC runtime does not intercept it', async ({
    page,
  }) => {
    await page.goto(testPostUrl);

    const result = await page.evaluate(() => {
      const target = document.createElement('div');
      target.id = 'outside-toc-target';
      document.body.append(target);

      const link = document.createElement('a');
      link.className = 'toc-link';
      link.href = '#outside-toc-target';
      link.textContent = 'Outside TOC';
      document.body.append(link);

      let pushCount = 0;
      const originalPushState = history.pushState.bind(history);
      history.pushState = (data, unused, url) => {
        pushCount += 1;
        originalPushState(data, unused, url);
      };

      document.dispatchEvent(new Event('astro:page-load'));
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(click);

      return { defaultPrevented: click.defaultPrevented, pushCount };
    });

    expect(result).toEqual({ defaultPrevented: false, pushCount: 0 });
  });

  test.describe('Desktop TOC (@desktop)', () => {
    test.use({ viewport: { width: 1400, height: 900 } });

    test('GIVEN the post header is in view WHEN page loads on desktop THEN sidebar TOC is hidden and inert', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const desktopToc = page.locator('.toc-desktop');
      const firstLink = desktopToc.locator('.toc-link').first();

      await expect(desktopToc).toHaveAttribute('data-visible', 'false');
      await expect(desktopToc).toHaveAttribute('aria-hidden', 'true');
      await expect(desktopToc).toHaveAttribute('inert', '');
      await expect(desktopToc).toHaveCSS('visibility', 'hidden');
      await expect(desktopToc).toHaveCSS('pointer-events', 'none');
      await expect(desktopToc).toHaveCSS('opacity', '0');
      await expect(firstLink).toBeHidden();
    });

    test('GIVEN the post header leaves the TOC top line WHEN user scrolls THEN TOC appears and tracks the current section', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const links = page.locator('.toc-desktop .toc-link');
      const count = await links.count();
      expect(count).toBeGreaterThan(0);

      const targetId = await links.nth(Math.min(1, count - 1)).getAttribute('data-heading-id');
      expect(targetId).toBeTruthy();
      await page.evaluate((id) => document.getElementById(id!)?.scrollIntoView(), targetId);

      const desktopToc = page.locator('.toc-desktop');
      await expect(desktopToc).toHaveAttribute('data-visible', 'true');
      await expect(desktopToc).toHaveAttribute('aria-hidden', 'false');
      await expect(desktopToc).not.toHaveAttribute('inert', '');
      await expect(desktopToc).toHaveCSS('visibility', 'visible');
      await expect(desktopToc).toHaveCSS('pointer-events', 'auto');
      await expect(
        page.locator(`.toc-desktop .toc-link[data-heading-id="${targetId}"]`)
      ).toHaveClass(/active/);
    });

    test('GIVEN the active section is unchanged WHEN the viewport updates THEN each heading is read once without class churn', async ({
      page,
    }) => {
      await page.goto(testPostUrl);

      const desktopLinks = page.locator('.toc-desktop .toc-link');
      const lastLink = desktopLinks.last();
      const targetId = await lastLink.getAttribute('data-heading-id');
      expect(targetId).toBeTruthy();
      await page.evaluate((id) => document.getElementById(id!)?.scrollIntoView(), targetId);
      await expect(
        page.locator(`.toc-desktop .toc-link[data-heading-id="${targetId}"]`)
      ).toHaveClass(/active/);
      await expect(page.locator(`.toc-link.active[data-heading-id="${targetId}"]`)).toHaveCount(2);
      await expect(
        page.locator(`.toc-mobile .toc-link.active[data-heading-id="${targetId}"]`)
      ).toHaveCount(1);
      await expect(
        page.locator(`.toc-desktop .toc-link.active[data-heading-id="${targetId}"]`)
      ).toHaveCount(1);

      const metrics = await page.evaluate(async () => {
        const tocLinks = Array.from(document.querySelectorAll('.toc-link'));
        const headingIds = new Set(
          tocLinks
            .map((link) => link.getAttribute('data-heading-id'))
            .filter((id): id is string => Boolean(id))
        );
        const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
        let headingReads = 0;
        let classMutations = 0;

        Element.prototype.getBoundingClientRect = function () {
          if (this instanceof HTMLElement && headingIds.has(this.id)) {
            headingReads += 1;
          }
          return originalGetBoundingClientRect.call(this);
        };

        const observer = new MutationObserver((records) => {
          classMutations += records.length;
        });
        tocLinks.forEach((link) => {
          observer.observe(link, { attributes: true, attributeFilter: ['class'] });
        });

        try {
          window.dispatchEvent(new Event('scroll'));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await Promise.resolve();

          return {
            classMutations,
            headingReads,
            uniqueHeadings: headingIds.size,
          };
        } finally {
          observer.disconnect();
          Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        }
      });

      expect(metrics.uniqueHeadings).toBeGreaterThan(1);
      expect(metrics.headingReads).toBe(metrics.uniqueHeadings);
      expect(metrics.classMutations).toBe(0);

      const firstLink = desktopLinks.first();
      const firstHeadingId = await firstLink.getAttribute('data-heading-id');
      expect(firstHeadingId).toBeTruthy();
      await page.evaluate((id) => document.getElementById(id!)?.scrollIntoView(), firstHeadingId);
      await expect(
        page.locator(`.toc-link.active[data-heading-id="${firstHeadingId}"]`)
      ).toHaveCount(2);
      await expect(page.locator(`.toc-link.active[data-heading-id="${targetId}"]`)).toHaveCount(0);
    });

    test('GIVEN the desktop TOC is visible WHEN user returns to the post header THEN it hides again', async ({
      page,
    }) => {
      await page.goto(testPostUrl);
      await scrollPastHeader(page);

      await page.evaluate(() => window.scrollTo(0, 0));

      const desktopToc = page.locator('.toc-desktop');
      await expect(desktopToc).toHaveAttribute('data-visible', 'false');
      await expect(desktopToc).toHaveAttribute('aria-hidden', 'true');
      await expect(desktopToc).toHaveAttribute('inert', '');
      await expect(desktopToc).toHaveCSS('pointer-events', 'none');
      await expect(desktopToc).toBeHidden();
    });

    test('GIVEN reduced motion is enabled WHEN desktop TOC visibility changes THEN no transition or translation is used', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(testPostUrl);

      const desktopToc = page.locator('.toc-desktop');
      await expect(desktopToc).toHaveCSS('transition-duration', '0s');
      await expect(desktopToc).toHaveCSS('transform', 'none');

      await scrollPastHeader(page);
      await expect(desktopToc).toHaveCSS('transition-duration', '0s');
      await expect(desktopToc).toHaveCSS('transform', 'none');
    });

    test('GIVEN a direct heading hash WHEN page restores the target position THEN desktop TOC reveals the matching active section', async ({
      page,
    }) => {
      await page.goto(testPostUrl);
      const targetLink = page.locator('.toc-desktop .toc-link').nth(1);
      const targetHref = await targetLink.getAttribute('href');
      const targetId = await targetLink.getAttribute('data-heading-id');
      expect(targetHref).toBeTruthy();
      expect(targetId).toBeTruthy();

      await page.goto(`${testPostUrl}${targetHref}`);

      await expect(page.locator('.toc-desktop')).toHaveAttribute('data-visible', 'true');
      await expect(
        page.locator(`.toc-desktop .toc-link[data-heading-id="${targetId}"]`)
      ).toHaveClass(/active/);
    });

    test('GIVEN a restored article position WHEN returning through browser history THEN desktop TOC recalculates as visible', async ({
      page,
    }) => {
      await page.goto(testPostUrl);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await expect(page.locator('.toc-desktop')).toHaveAttribute('data-visible', 'true');

      await page.goto('/');
      await page.goBack({ waitUntil: 'domcontentloaded' });

      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
      await expect(page.locator('.toc-desktop')).toHaveAttribute('data-visible', 'true');
      await expect(page.locator('.toc-desktop .toc-link.active')).toHaveCount(1);
    });

    test('GIVEN the viewport crosses the desktop breakpoint WHEN layout changes THEN visibility recalculates without overwriting mobile disclosure state', async ({
      page,
    }) => {
      await page.goto(testPostUrl);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(page.locator('.toc-desktop')).toHaveAttribute('data-visible', 'true');

      await page.setViewportSize({ width: 390, height: 844 });
      const mobileContainer = page.locator('.toc-mobile .toc-toggle-container');
      const mobileToggle = page.locator('.toc-mobile .toc-toggle-header');
      await expect(page.locator('.toc-desktop')).toHaveAttribute('data-visible', 'false');
      await mobileToggle.click();
      await expect(mobileContainer).toHaveAttribute('data-open', 'true');
      await expect
        .poll(async () => {
          await page.locator('.site-footer').scrollIntoViewIfNeeded();
          return page
            .locator('.post-header')
            .evaluate((header) => header.getBoundingClientRect().bottom);
        })
        .toBeLessThan(0);

      await page.setViewportSize({ width: 1400, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const desktopToc = document.querySelector('.toc-desktop');
            const postHeader = document.querySelector('.post-header');
            if (!(desktopToc instanceof HTMLElement) || !(postHeader instanceof HTMLElement)) {
              throw new Error('Expected post header and desktop TOC');
            }

            const tocStyle = getComputedStyle(desktopToc);
            return {
              display: tocStyle.display,
              headerPassed:
                postHeader.getBoundingClientRect().bottom <= Number.parseFloat(tocStyle.top),
              visible: desktopToc.dataset.visible,
            };
          })
        )
        .toEqual({ display: 'block', headerPassed: true, visible: 'true' });
      await expect(mobileContainer).toHaveAttribute('data-open', 'true');

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.toc-desktop')).toHaveAttribute('data-visible', 'false');
      await expect(mobileContainer).toHaveAttribute('data-open', 'true');
      await expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');
    });

    test('GIVEN the desktop TOC is hidden WHEN tabbing past the source THEN hidden links are skipped until the TOC reveals', async ({
      page,
      browserName,
    }) => {
      await page.goto(testPostUrl);

      const sourceCitation = page.locator('.source-citation');
      const firstDesktopLink = page.locator('.toc-desktop .toc-link').first();
      const nextFocusKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
      await sourceCitation.focus();
      await page.keyboard.press(nextFocusKey);
      await expect(firstDesktopLink).not.toBeFocused();
      expect(
        await page.evaluate(() => document.activeElement?.closest('.toc-desktop') !== null)
      ).toBe(false);

      await scrollPastHeader(page);
      await sourceCitation.evaluate((element) => {
        (element as HTMLElement).focus({ preventScroll: true });
      });
      await page.keyboard.press(nextFocusKey);
      await expect(firstDesktopLink).toBeFocused();
    });

    for (const theme of ['dark', 'light'] as const) {
      test(`GIVEN the ${theme} theme WHEN a TOC link is active THEN it uses the orange marker token`, async ({
        page,
      }) => {
        await page.addInitScript((selectedTheme) => {
          localStorage.setItem('theme', selectedTheme);
        }, theme);
        await page.goto(testPostUrl);
        await scrollPastHeader(page);

        const activeLink = page.locator('.toc-desktop .toc-link.active').first();
        await expect(activeLink).toBeVisible();
        const expected = await activeLink.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-mogu-orange)';
          document.body.appendChild(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          return expected;
        });
        await expect
          .poll(() => activeLink.evaluate((element) => getComputedStyle(element).color))
          .toBe(expected);

        const sidebar = page.locator('.toc-sidebar');
        const sidebarStyle = await sidebar.evaluate((element) => {
          const style = getComputedStyle(element);
          const parseRgb = (value: string) =>
            (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
          const luminance = ([r, g, b]: number[]) => {
            const [red, green, blue] = [r, g, b].map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          };
          const railLuminance = luminance(parseRgb(style.borderLeftColor));
          const backgroundLuminance = luminance(
            parseRgb(getComputedStyle(document.body).backgroundColor)
          );

          return {
            backgroundColor: style.backgroundColor,
            borderTopWidth: style.borderTopWidth,
            borderLeftWidth: style.borderLeftWidth,
            railContrast:
              (Math.max(railLuminance, backgroundLuminance) + 0.05) /
              (Math.min(railLuminance, backgroundLuminance) + 0.05),
          };
        });
        expect(sidebarStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(sidebarStyle.borderTopWidth).toBe('0px');
        expect(sidebarStyle.borderLeftWidth).toBe('1px');
        expect(sidebarStyle.railContrast).toBeGreaterThanOrEqual(3);

        const hoverLink = page.locator('.toc-desktop .toc-link:not(.active)').first();
        await hoverLink.hover();
        const hoverExpected = await hoverLink.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-source-link)';
          document.body.appendChild(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          return expected;
        });
        await expect
          .poll(() => hoverLink.evaluate((element) => getComputedStyle(element).color))
          .toBe(hoverExpected);
      });
    }
  });
});

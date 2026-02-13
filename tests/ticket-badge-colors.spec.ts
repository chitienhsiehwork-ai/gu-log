import { test, expect } from '@playwright/test';

/**
 * Ticket Badge Color Consistency Tests
 *
 * BUG: PrevNextNav uses a generic .nav-ticket-id class with accent blue color
 * for ALL ticket types. CP tickets should be orange (#cb7551), SD should be
 * green (#268b79), SP should be blue (#268bd2) — matching TicketBadge component.
 *
 * These tests verify that ticket badge colors are consistent everywhere they appear.
 */

// Expected colors by prefix (from TicketBadge.astro)
const EXPECTED_COLORS: Record<string, { text: string; bg: string }> = {
  SD: { text: 'rgb(38, 139, 121)', bg: 'rgba(38, 139, 121, 0.15)' },
  SP: { text: 'rgb(38, 139, 210)', bg: 'rgba(38, 139, 210, 0.15)' },
  CP: { text: 'rgb(203, 117, 81)', bg: 'rgba(203, 117, 81, 0.15)' },
};

test.describe('Ticket Badge Colors', () => {
  test('GIVEN a post page with PrevNextNav WHEN viewing ticket badges THEN CP badges should be orange, not blue', async ({
    page,
  }) => {
    // Navigate to a post that has CP neighbors in PrevNextNav
    // Use the listing page to find a CP post first
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find a CP post link to click
    const cpBadge = page.locator('.ticket-cp').first();
    const hasCp = (await cpBadge.count()) > 0;

    if (!hasCp) {
      test.skip(true, 'No CP posts found on index');
      return;
    }

    // Go to clawd-picks listing to find a CP post in the middle (has prev/next)
    await page.goto('/clawd-picks');
    await page.waitForLoadState('networkidle');

    // Click on a post that's not the first or last (so it has both prev and next)
    const postLinks = page.locator('a[href*="/posts/"]');
    const linkCount = await postLinks.count();

    if (linkCount < 3) {
      test.skip(true, 'Not enough CP posts to test PrevNextNav');
      return;
    }

    // Click the second post (index 1) — should have both prev and next
    await postLinks.nth(1).click();
    await page.waitForLoadState('networkidle');

    // Now check the PrevNextNav for ticket badge colors
    const navTicketIds = page.locator('.prev-next-nav .ticket-badge, .prev-next-nav .nav-ticket-id');
    const navCount = await navTicketIds.count();

    expect(navCount).toBeGreaterThan(0);

    for (let i = 0; i < navCount; i++) {
      const badge = navTicketIds.nth(i);
      const text = await badge.textContent();
      const prefix = text?.split('-')[0]?.trim();

      if (prefix && EXPECTED_COLORS[prefix]) {
        const color = await badge.evaluate((el) => getComputedStyle(el).color);
        expect
          .soft(color, `${text} should have ${prefix} color (${EXPECTED_COLORS[prefix].text})`)
          .toBe(EXPECTED_COLORS[prefix].text);
      }
    }
  });

  test('GIVEN any post page WHEN viewing TicketBadge in post-meta THEN colors should match prefix', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check all ticket badges on the index page
    for (const [prefix, expected] of Object.entries(EXPECTED_COLORS)) {
      const badges = page.locator(`.ticket-${prefix.toLowerCase()}`);
      const count = await badges.count();

      if (count > 0) {
        const color = await badges.first().evaluate((el) => getComputedStyle(el).color);
        expect
          .soft(color, `${prefix} badge on index should be ${expected.text}`)
          .toBe(expected.text);

        const bgColor = await badges.first().evaluate((el) => getComputedStyle(el).backgroundColor);
        expect
          .soft(bgColor, `${prefix} badge bg on index should be ${expected.bg}`)
          .toBe(expected.bg);
      }
    }
  });
});

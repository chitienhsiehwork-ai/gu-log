import { test, expect } from './fixtures';

/**
 * Theme Toggle Tests
 * 
 * Tests dark/light theme switching via ThemeToggle button.
 * Covers: toggle click, persistence, default state, icon visibility.
 */

test.describe('Theme Toggle', () => {
  test('GIVEN default page WHEN loaded THEN theme should be dark by default', async ({ page }) => {
    await page.goto('/');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('GIVEN dark theme WHEN toggle clicked THEN switches to light theme', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();

    const toggle = page.locator('#theme-toggle');
    await toggle.click();

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('light');

    // Should persist to localStorage
    const stored = await page.evaluate(() => localStorage.getItem('theme'));
    expect(stored).toBe('light');
  });

  test('GIVEN light theme WHEN toggle clicked THEN switches to dark theme', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();

    // Verify starting in light
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(initialTheme).toBe('light');

    const toggle = page.locator('#theme-toggle');
    await toggle.click();

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });

  test('GIVEN saved theme in localStorage WHEN page loads THEN restores that theme', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();

    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('light');
  });

  test('GIVEN dark theme WHEN viewing THEN moon icon should be visible', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.reload();

    const moonIcon = page.locator('#theme-toggle .icon-moon');
    const sunIcon = page.locator('#theme-toggle .icon-sun');

    // In dark mode, the icon that is displayed is moon (to indicate "switch to light")
    await expect(moonIcon).toBeVisible();
    await expect(sunIcon).not.toBeVisible();
  });

  test('GIVEN light theme WHEN viewing THEN sun icon should be visible', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();

    const moonIcon = page.locator('#theme-toggle .icon-moon');
    const sunIcon = page.locator('#theme-toggle .icon-sun');

    await expect(sunIcon).toBeVisible();
    await expect(moonIcon).not.toBeVisible();
  });
});

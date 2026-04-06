import { chromium } from 'playwright';

const browser = await chromium.launch();

const pages = [
  { path: '/shroomdog-picks/', name: 'sp-listing', fullPage: true },
  { path: '/clawd-picks/', name: 'cp-listing', fullPage: true },
  { path: '/shroomdog-originals/', name: 'sd-listing', fullPage: true },
  { path: '/', name: 'homepage', fullPage: true },
];

const themes = ['dark', 'light'];

for (const theme of themes) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  for (const { path, name, fullPage } of pages) {
    const page = await ctx.newPage();
    await page.goto(`http://localhost:4330${path}`, { waitUntil: 'networkidle' });

    // Set theme
    if (theme === 'light') {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'light');
      });
      await page.waitForTimeout(300);
    }

    await page.screenshot({
      path: `/tmp/ui-audit/theme-check/${theme}-${name}-mobile.png`,
      fullPage: fullPage,
    });
    await page.close();
  }
  await ctx.close();
}

await browser.close();
console.log('✅ All theme screenshots captured');

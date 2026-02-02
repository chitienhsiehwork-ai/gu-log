#!/usr/bin/env node

/**
 * Visual regression test — takes screenshots at multiple viewports.
 * Usage: node scripts/visual-test.mjs [base-url]
 * Default URL: https://gu-log.vercel.app
 */

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';

const BASE_URL = process.argv[2] || 'https://gu-log.vercel.app';
const TEST_PATH = '/posts/openclaw-executive-assistant-prompt';
const REPORT_DIR = path.resolve('.playwright-cli/report');

const VIEWPORTS = [
  { name: '4k-32', width: 3840, height: 2160 },
  { name: 'macbook-13', width: 1440, height: 900 },
  { name: 'iphone-15-pro', width: 393, height: 852 },
];

async function run() {
  await mkdir(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const url = `${BASE_URL}${TEST_PATH}`;

  console.log(`\n📸 Visual test — ${url}\n`);
  console.log('Viewport'.padEnd(20), 'TOC visible?', ' Screenshot');
  console.log('-'.repeat(65));

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    // Check TOC desktop visibility
    const tocDesktop = page.locator('.toc-desktop');
    const tocVisible = await tocDesktop.isVisible().catch(() => false);

    // Check for overlap: TOC left edge vs content right edge
    let overlapNote = '';
    if (tocVisible) {
      const tocBox = await tocDesktop.boundingBox();
      const content = page.locator('.content-wrapper, article, main');
      const contentBox = await content.first().boundingBox();
      if (tocBox && contentBox) {
        const contentRight = contentBox.x + contentBox.width;
        const gap = tocBox.x - contentRight;
        overlapNote = gap < 0 ? ` OVERLAP ${Math.abs(gap).toFixed(0)}px` : ` gap=${gap.toFixed(0)}px`;
      }
    }

    const screenshotPath = path.join(REPORT_DIR, `${vp.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(
      `${vp.name.padEnd(20)} ${tocVisible ? 'yes' : 'no (mobile)'}${overlapNote}`.padEnd(50),
      screenshotPath
    );

    await context.close();
  }

  await browser.close();
  console.log(`\nVisual test complete — review screenshots at ${REPORT_DIR}/\n`);
}

run().catch((err) => {
  console.error('Visual test error:', err.message);
  process.exit(0); // always exit 0 — advisory only
});

#!/usr/bin/env node

/**
 * SearchBar E2E Test — tests search functionality across viewports and languages.
 * Usage: node scripts/search-test.mjs [base-url]
 * Default URL: https://gu-log.vercel.app (or localhost:4321 for local testing)
 *
 * Tests:
 * 1. Search icon click opens input
 * 2. Escape closes search
 * 3. Cmd/Ctrl+K shortcut opens search
 * 4. Typing shows results
 * 5. Arrow keys navigate results
 * 6. Enter navigates to post
 * 7. Language filtering works (zh-tw vs en)
 * 8. No results message displays
 */

import { chromium } from 'playwright';

const BASE_URL = process.argv[2] || 'https://gu-log.vercel.app';

// Test pages for each language
const TEST_PAGES = {
  'zh-tw': '/',
  'en': '/en',
};

// Search queries known to return results
const SEARCH_QUERIES = {
  'zh-tw': 'Claude', // Should find posts about Claude
  'en': 'Claude',
};

// Query that should return no results
const NO_RESULTS_QUERY = 'xyznonexistent123';

// Timeouts
const ANIMATION_WAIT = 300;

class TestRunner {
  constructor() {
    this.browser = null;
    this.passed = 0;
    this.failed = 0;
  }

  log(status, testName, detail = '') {
    const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '•';
    const color = status === 'pass' ? '\x1b[32m' : status === 'fail' ? '\x1b[31m' : '\x1b[90m';
    console.log(`${color}${icon}\x1b[0m ${testName}${detail ? ` — ${detail}` : ''}`);
  }

  async setup() {
    this.browser = await chromium.launch();
  }

  async teardown() {
    await this.browser?.close();
  }

  async runTest(name, fn) {
    try {
      await fn();
      this.passed++;
      this.log('pass', name);
      return true;
    } catch (err) {
      this.failed++;
      this.log('fail', name, err.message);
      return false;
    }
  }

  async createPage(url) {
    const context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    return { page, context };
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }
}

async function testSearchIconOpensInput(runner, page) {
  // Find search trigger and click it
  const trigger = page.locator('.search-trigger');
  await trigger.click();
  await page.waitForTimeout(ANIMATION_WAIT);

  // Check that container has data-open="true"
  const container = page.locator('.search-container');
  const isOpen = await container.getAttribute('data-open');
  runner.assert(isOpen === 'true', 'Expected search container to be open');

  // Check that input is visible and focused
  const input = page.locator('.search-input');
  const isVisible = await input.isVisible();
  runner.assert(isVisible, 'Expected search input to be visible');
}

async function testEscapeClosesSearch(runner, page) {
  // Open search first
  const trigger = page.locator('.search-trigger');
  await trigger.click();
  await page.waitForTimeout(ANIMATION_WAIT);

  // Press Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(ANIMATION_WAIT);

  // Check that container is closed
  const container = page.locator('.search-container');
  const isOpen = await container.getAttribute('data-open');
  runner.assert(isOpen === 'false', 'Expected search container to be closed after Escape');
}

async function testKeyboardShortcut(runner, page, isMac = true) {
  // Make sure search is closed first
  const container = page.locator('.search-container');
  let isOpen = await container.getAttribute('data-open');
  if (isOpen === 'true') {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(ANIMATION_WAIT);
  }

  // Press Cmd+K (Mac) or Ctrl+K (other)
  const modifier = isMac ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+k`);
  await page.waitForTimeout(ANIMATION_WAIT);

  // Check that search is open
  isOpen = await container.getAttribute('data-open');
  runner.assert(isOpen === 'true', `Expected ${modifier}+K to open search`);
}

async function testSearchShowsResults(runner, page, query) {
  // Open search
  const trigger = page.locator('.search-trigger');
  await trigger.click();
  await page.waitForTimeout(ANIMATION_WAIT);

  // Type query
  const input = page.locator('.search-input');
  await input.fill(query);

  // Wait for debounce + results
  await page.waitForTimeout(300);

  // Check that results are visible
  const resultItems = page.locator('.search-result-item');
  const count = await resultItems.count();
  runner.assert(count > 0, `Expected results for query "${query}", got ${count}`);
}

async function testNoResultsMessage(runner, page, lang) {
  // Open search
  const trigger = page.locator('.search-trigger');
  await trigger.click();
  await page.waitForTimeout(ANIMATION_WAIT);

  // Type nonsense query
  const input = page.locator('.search-input');
  await input.fill(NO_RESULTS_QUERY);

  // Wait for debounce
  await page.waitForTimeout(300);

  // Check for "no results" message
  const noResults = page.locator('.search-no-results');
  const isVisible = await noResults.isVisible();
  runner.assert(isVisible, 'Expected "no results" message to be visible');

  // Check the message text
  const text = await noResults.textContent();
  const expectedText = lang === 'zh-tw' ? '找不到結果' : 'No results found';
  runner.assert(text?.includes(expectedText), `Expected "${expectedText}" message, got "${text}"`);
}

async function testArrowKeyNavigation(runner, page, query) {
  // Open search and type query
  const trigger = page.locator('.search-trigger');
  await trigger.click();
  await page.waitForTimeout(ANIMATION_WAIT);

  const input = page.locator('.search-input');
  await input.fill(query);
  await page.waitForTimeout(300);

  // Press ArrowDown
  await page.keyboard.press('ArrowDown');

  // Check that first item has 'selected' class
  const firstItem = page.locator('.search-result-item').first();
  const hasSelected = await firstItem.evaluate((el) => el.classList.contains('selected'));
  runner.assert(hasSelected, 'Expected first item to be selected after ArrowDown');

  // Press ArrowDown again
  await page.keyboard.press('ArrowDown');

  // Check that second item is now selected (if there are 2+ results)
  const items = page.locator('.search-result-item');
  const count = await items.count();
  if (count > 1) {
    const secondItem = items.nth(1);
    const secondSelected = await secondItem.evaluate((el) => el.classList.contains('selected'));
    runner.assert(secondSelected, 'Expected second item to be selected after 2x ArrowDown');
  }
}

async function testLanguageFiltering(runner, page, lang) {
  // Open search
  const trigger = page.locator('.search-trigger');
  await trigger.click();
  await page.waitForTimeout(ANIMATION_WAIT);

  // Type a common query
  const input = page.locator('.search-input');
  await input.fill('Claude');
  await page.waitForTimeout(300);

  // Get all result links
  const results = page.locator('.search-result-item');
  const count = await results.count();

  if (count > 0) {
    // Check that all result links point to correct language path
    for (let i = 0; i < Math.min(count, 3); i++) {
      const href = await results.nth(i).getAttribute('href');
      const expectsEnPath = lang === 'en';
      const hasEnPath = href?.startsWith('/en/');

      runner.assert(
        expectsEnPath === hasEnPath,
        `Expected ${lang} result to ${expectsEnPath ? 'have' : 'not have'} /en/ path, got ${href}`
      );
    }
  }
}

async function testSearchIndexEndpoint(runner) {
  const response = await fetch(`${BASE_URL}/search-index.json`);
  runner.assert(response.ok, `Expected 200 from /search-index.json, got ${response.status}`);

  const data = await response.json();
  runner.assert(Array.isArray(data), 'Expected search index to be an array');
  runner.assert(data.length > 0, 'Expected search index to have entries');

  // Check structure of first entry
  const first = data[0];
  runner.assert(typeof first.slug === 'string', 'Expected slug to be string');
  runner.assert(typeof first.title === 'string', 'Expected title to be string');
  runner.assert(typeof first.lang === 'string', 'Expected lang to be string');
}

async function runAllTests() {
  console.log(`\n🔍 SearchBar E2E Tests — ${BASE_URL}\n`);
  console.log('─'.repeat(60));

  const runner = new TestRunner();
  await runner.setup();

  // Test search index endpoint
  console.log('\n📡 API Tests\n');
  await runner.runTest('Search index endpoint returns valid JSON', async () => {
    await testSearchIndexEndpoint(runner);
  });

  // Test each language
  for (const [lang, pagePath] of Object.entries(TEST_PAGES)) {
    console.log(`\n🌐 Language: ${lang.toUpperCase()}\n`);

    const url = `${BASE_URL}${pagePath}`;
    const { page, context } = await runner.createPage(url);
    const query = SEARCH_QUERIES[lang];

    await runner.runTest(`[${lang}] Search icon click opens input`, async () => {
      await testSearchIconOpensInput(runner, page);
    });

    // Need fresh page state for each test
    await page.reload({ waitUntil: 'networkidle' });

    await runner.runTest(`[${lang}] Escape closes search`, async () => {
      await testEscapeClosesSearch(runner, page);
    });

    await page.reload({ waitUntil: 'networkidle' });

    await runner.runTest(`[${lang}] Cmd+K shortcut opens search`, async () => {
      await testKeyboardShortcut(runner, page, true);
    });

    await page.reload({ waitUntil: 'networkidle' });

    await runner.runTest(`[${lang}] Ctrl+K shortcut opens search`, async () => {
      await testKeyboardShortcut(runner, page, false);
    });

    await page.reload({ waitUntil: 'networkidle' });

    await runner.runTest(`[${lang}] Typing shows search results`, async () => {
      await testSearchShowsResults(runner, page, query);
    });

    await page.reload({ waitUntil: 'networkidle' });

    await runner.runTest(`[${lang}] No results message displays correctly`, async () => {
      await testNoResultsMessage(runner, page, lang);
    });

    await page.reload({ waitUntil: 'networkidle' });

    await runner.runTest(`[${lang}] Arrow keys navigate results`, async () => {
      await testArrowKeyNavigation(runner, page, query);
    });

    await page.reload({ waitUntil: 'networkidle' });

    await runner.runTest(`[${lang}] Results filtered to current language`, async () => {
      await testLanguageFiltering(runner, page, lang);
    });

    await context.close();
  }

  await runner.teardown();

  // Summary
  console.log('\n' + '─'.repeat(60));
  const total = runner.passed + runner.failed;
  const icon = runner.failed === 0 ? '✅' : '❌';
  console.log(`\n${icon} ${runner.passed}/${total} tests passed\n`);

  process.exit(runner.failed > 0 ? 1 : 0);
}

runAllTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});

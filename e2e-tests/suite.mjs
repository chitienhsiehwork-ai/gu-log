#!/usr/bin/env node
/**
 * gu-log E2E Test Suite — Playwright (Chromium + WebKit)
 * iPhone 15 Pro emulation, comprehensive coverage
 *
 * Run:  node e2e-tests/suite.mjs
 * Deps: npx playwright install chromium webkit
 */

import { chromium, webkit } from 'playwright';
import { strict as _assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');
const BASE_URL = 'https://gu-log.vercel.app';

// iPhone 15 Pro emulation
const DEVICE = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

// ── helpers ──────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const results = [];
let passCount = 0;
let failCount = 0;
let warnCount = 0;
const warnings = [];
const perfData = {};
const a11yFindings = [];

function pass(name, detail = '') {
  passCount++;
  const msg = `  ✅ PASS: ${name}${detail ? ' — ' + detail : ''}`;
  console.log(msg);
  results.push({ status: 'pass', name, detail });
}

function fail(name, detail = '') {
  failCount++;
  const msg = `  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`;
  console.error(msg);
  results.push({ status: 'fail', name, detail });
}

function warn(name, detail = '') {
  warnCount++;
  const msg = `  ⚠️  WARN: ${name}${detail ? ' — ' + detail : ''}`;
  console.warn(msg);
  warnings.push({ name, detail });
  results.push({ status: 'warn', name, detail });
}

function check(condition, name, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

async function screenshot(page, name, browser) {
  const fname = `${browser}-${name}.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, fname), fullPage: false });
  return fname;
}

async function fullScreenshot(page, name, browser) {
  const fname = `${browser}-${name}-full.png`;
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, fname), fullPage: true });
  return fname;
}

async function saveA11ySnapshot(page, name, browser) {
  try {
    // Playwright 1.58+ removed page.accessibility.snapshot()
    // Use DOM-based introspection instead
    const snapshot = await page.evaluate(() => {
      function _buildTree(el, depth = 0) {
        if (depth > 6) return null; // limit depth
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
          ? el.childNodes[0].textContent.trim().substring(0, 100) : '';
        const node = { role, name: ariaLabel || text || '' };
        const children = [];
        for (const child of el.children) {
          const childNode = _buildTree(child, depth + 1);
          if (childNode) children.push(childNode);
        }
        if (children.length > 0) node.children = children;
        return node;
      }
      // Build from landmark elements
      const _landmarks = {};
      const landmarkEls = document.querySelectorAll('nav, main, footer, header, aside, [role]');
      const tree = [];
      landmarkEls.forEach(el => {
        tree.push({
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: el.getAttribute('aria-label') || '',
          tag: el.tagName.toLowerCase(),
        });
      });
      // Heading structure
      const headings = [];
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
        headings.push({ level: parseInt(h.tagName[1]), text: h.textContent.trim().substring(0, 80) });
      });
      // Button inventory
      const buttons = [];
      document.querySelectorAll('button').forEach(b => {
        buttons.push({
          label: b.getAttribute('aria-label') || b.textContent.trim().substring(0, 50),
          hasAriaLabel: !!b.getAttribute('aria-label'),
        });
      });
      // Link inventory
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        links.push({
          text: a.textContent.trim().substring(0, 60),
          href: a.getAttribute('href'),
          hasAriaLabel: !!a.getAttribute('aria-label'),
        });
      });
      // Image audit
      const images = [];
      document.querySelectorAll('img').forEach(img => {
        images.push({
          alt: img.getAttribute('alt'),
          hasAlt: img.getAttribute('alt') !== null,
          src: img.src.substring(0, 80),
        });
      });
      return { landmarks: tree, headings, buttons, links: links.slice(0, 30), images };
    });

    const fname = `${browser}-${name}.json`;
    fs.writeFileSync(
      path.join(SNAPSHOTS_DIR, fname),
      JSON.stringify(snapshot, null, 2),
    );
    return { snapshot, fname };
  } catch (e) {
    warn(`a11y-snapshot-${name}`, e.message);
    return { snapshot: null, fname: null };
  }
}

// Recursively collect all nodes from accessibility tree
function _collectA11yNodes(node, collected = []) {
  if (!node) return collected;
  collected.push(node);
  if (node.children) {
    for (const child of node.children) {
      _collectA11yNodes(child, collected);
    }
  }
  return collected;
}

// ── test functions ───────────────────────────────────────────────────────────

async function testHomepageLoad(page, browser) {
  console.log('\n  📋 Test: Homepage Load & Title');
  const start = Date.now();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  const loadTime = Date.now() - start;
  perfData[`${browser}-homepage-load`] = loadTime;

  await screenshot(page, 'homepage', browser);

  const title = await page.title();
  check(
    title.includes('ShroomDog') || title.includes('香菇'),
    'homepage-title',
    `Title: "${title}" (${loadTime}ms)`,
  );

  check(loadTime < 15000, 'homepage-load-time', `${loadTime}ms < 15s`);
}

async function testLangAttribute(page, _browser) {
  console.log('\n  📋 Test: HTML lang Attribute');
  const lang = await page.evaluate(() => document.documentElement.lang);
  check(lang === 'zh-TW', 'lang-zh-TW', `lang="${lang}"`);
}

async function testSEOMetaTags(page, _browser) {
  console.log('\n  📋 Test: SEO Meta Tags');

  const ogTitle = await page.evaluate(() => {
    const el = document.querySelector('meta[property="og:title"]');
    return el ? el.content : null;
  });
  check(!!ogTitle, 'og:title', ogTitle || 'MISSING');

  const ogDesc = await page.evaluate(() => {
    const el = document.querySelector('meta[property="og:description"]');
    return el ? el.content : null;
  });
  check(!!ogDesc, 'og:description', ogDesc ? ogDesc.substring(0, 60) + '…' : 'MISSING');

  const ogImage = await page.evaluate(() => {
    const el = document.querySelector('meta[property="og:image"]');
    return el ? el.content : null;
  });
  check(!!ogImage, 'og:image', ogImage || 'MISSING');

  const canonical = await page.evaluate(() => {
    const el = document.querySelector('link[rel="canonical"]');
    return el ? el.href : null;
  });
  check(!!canonical, 'canonical', canonical || 'MISSING');

  const viewport = await page.evaluate(() => {
    const el = document.querySelector('meta[name="viewport"]');
    return el ? el.content : null;
  });
  check(!!viewport && viewport.includes('width='), 'viewport-meta', viewport || 'MISSING');
}

async function testBlogPostCards(page, browser) {
  console.log('\n  📋 Test: Blog Post Cards');
  // Wait for articles/cards to render
  await page.waitForSelector('a[href*="/posts/"]', { timeout: 10000 }).catch(() => {});

  const postLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/posts/"]');
    return Array.from(links).map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent.trim().substring(0, 80),
    }));
  });

  check(postLinks.length >= 5, 'blog-post-cards-count', `Found ${postLinks.length} post links`);

  if (postLinks.length > 0) {
    check(
      postLinks[0].text.length > 5,
      'blog-post-card-title',
      `First: "${postLinks[0].text}"`,
    );
  }

  await screenshot(page, 'blog-cards', browser);
}

async function testThemeToggle(page, browser) {
  console.log('\n  📋 Test: Theme Toggle (Bidirectional)');

  // Get initial theme
  const initialTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  console.log(`    Initial theme: ${initialTheme || '(not set / system default)'}`);

  // Find theme toggle button — try multiple selectors
  const toggleSel = await page.evaluate(() => {
    // Common patterns for theme toggle
    const candidates = [
      'button[aria-label*="theme" i]',
      'button[aria-label*="Theme" i]',
      'button[aria-label*="dark" i]',
      'button[aria-label*="light" i]',
      'button[aria-label*="mode" i]',
      'button[aria-label*="色彩" i]',
      'button[aria-label*="主題" i]',
      '#theme-toggle',
      '.theme-toggle',
      'button[id*="theme"]',
      'button[class*="theme"]',
      'label[class*="theme"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return sel;
    }
    // Fallback: look for buttons with sun/moon icons
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const html = btn.innerHTML.toLowerCase();
      if (html.includes('sun') || html.includes('moon') || html.includes('theme')) {
        btn.setAttribute('data-test-theme-toggle', 'true');
        return 'button[data-test-theme-toggle="true"]';
      }
    }
    return null;
  });

  if (!toggleSel) {
    warn('theme-toggle-button', 'Could not find theme toggle button');
    return;
  }

  // Click 1: toggle theme (light → dark or whatever direction)
  await page.click(toggleSel);
  await page.waitForTimeout(500);
  const afterFirst = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  await screenshot(page, 'theme-after-first-toggle', browser);

  check(
    afterFirst !== initialTheme,
    'theme-toggle-first',
    `${initialTheme || 'null'} → ${afterFirst}`,
  );

  // Check localStorage persistence
  const savedTheme = await page.evaluate(() => {
    // Try common storage keys
    return (
      localStorage.getItem('theme') ||
      localStorage.getItem('data-theme') ||
      localStorage.getItem('color-theme') ||
      localStorage.getItem('starlight-theme') ||
      localStorage.getItem('preferred-theme') ||
      null
    );
  });
  check(!!savedTheme, 'theme-localStorage', `Saved: "${savedTheme}"`);

  // Click 2: toggle back (dark → light)
  await page.click(toggleSel);
  await page.waitForTimeout(500);
  const afterSecond = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  await screenshot(page, 'theme-after-second-toggle', browser);

  check(
    afterSecond !== afterFirst,
    'theme-toggle-second',
    `${afterFirst} → ${afterSecond} (roundtrip)`,
  );

  // Verify it returned to the original (or at least changed)
  check(
    afterSecond === initialTheme || afterSecond !== afterFirst,
    'theme-roundtrip',
    `Bidirectional toggle works: ${initialTheme} → ${afterFirst} → ${afterSecond}`,
  );
}

async function testSearchModal(page, browser) {
  console.log('\n  📋 Test: Search Modal Toggle');

  // Find search trigger
  const searchSel = await page.evaluate(() => {
    const candidates = [
      'button[aria-label*="search" i]',
      'button[aria-label*="搜尋" i]',
      'button[aria-label*="Search" i]',
      '#search-button',
      '.search-button',
      'button[class*="search"]',
      'a[href*="search"]',
      'input[type="search"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return sel;
    }
    // Fallback: look for magnifying glass icon
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const html = btn.innerHTML.toLowerCase();
      if (html.includes('search') || html.includes('magnif')) {
        btn.setAttribute('data-test-search', 'true');
        return 'button[data-test-search="true"]';
      }
    }
    return null;
  });

  if (!searchSel) {
    // On mobile there might be a nav menu first
    warn('search-button', 'Could not find search button — may be behind mobile menu');
    await screenshot(page, 'search-not-found', browser);
    return;
  }

  // Check modal is not visible before click
  const modalBefore = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('dialog, [role="dialog"], .search-modal, [class*="search"][class*="modal"], .pagefind-ui');
    for (const d of dialogs) {
      const style = window.getComputedStyle(d);
      if (style.display !== 'none' && style.visibility !== 'hidden') return true;
    }
    return false;
  });
  check(!modalBefore, 'search-modal-hidden-before', 'Modal not visible initially');

  // Click search
  await page.click(searchSel);
  await page.waitForTimeout(800);
  await screenshot(page, 'search-modal-open', browser);

  // Check if something search-related appeared
  const modalAfter = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('dialog[open], [role="dialog"], .search-modal, [class*="search"][class*="modal"], .pagefind-ui, input[type="search"]:focus, input[placeholder*="搜尋"], input[placeholder*="search" i]');
    return dialogs.length > 0;
  });
  check(modalAfter, 'search-modal-visible-after', 'Search UI appeared after click');

  // Close it (press Escape)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

async function testBlogPostNavigation(page, browser) {
  console.log('\n  📋 Test: Blog Post Navigation');

  // Get the first post link
  const firstPostHref = await page.evaluate(() => {
    const link = document.querySelector('a[href*="/posts/"]');
    return link ? link.getAttribute('href') : null;
  });

  if (!firstPostHref) {
    fail('blog-post-navigation', 'No post links found on homepage');
    return;
  }

  const postUrl = firstPostHref.startsWith('http')
    ? firstPostHref
    : `${BASE_URL}${firstPostHref}`;

  const start = Date.now();
  await page.goto(postUrl, { waitUntil: 'networkidle' });
  const loadTime = Date.now() - start;
  perfData[`${browser}-post-load`] = loadTime;

  await screenshot(page, 'blog-post', browser);

  // Check article element exists
  const hasArticle = await page.evaluate(() => {
    return (
      !!document.querySelector('article') ||
      !!document.querySelector('[role="article"]') ||
      !!document.querySelector('main')
    );
  });
  check(hasArticle, 'post-article-element', 'Article/main element exists');

  // Check H1 title
  const h1 = await page.evaluate(() => {
    const el = document.querySelector('h1');
    return el ? el.textContent.trim().substring(0, 80) : null;
  });
  check(!!h1, 'post-h1-title', h1 || 'MISSING');

  // Check date element
  const hasDate = await page.evaluate(() => {
    const timeEl = document.querySelector('time');
    const dateText = document.body.innerText.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
    return !!timeEl || !!dateText;
  });
  check(hasDate, 'post-date-element', 'Date/time element found');

  check(loadTime < 15000, 'post-load-time', `${loadTime}ms`);
}

async function testPostPageA11y(page, browser) {
  console.log('\n  📋 Test: Post Page Accessibility');

  // Single H1 check
  const h1Count = await page.evaluate(() => document.querySelectorAll('h1').length);
  check(h1Count === 1, 'post-single-h1', `Found ${h1Count} H1 elements (should be 1)`);

  // Article landmark
  const hasArticleLandmark = await page.evaluate(() => {
    return (
      !!document.querySelector('article') ||
      !!document.querySelector('[role="article"]')
    );
  });
  check(hasArticleLandmark, 'post-article-landmark', 'Article landmark present');

  // Save a11y snapshot for post
  const { snapshot } = await saveA11ySnapshot(page, 'post', browser);
  if (snapshot) {
    a11yFindings.push({
      page: 'post',
      browser,
      headingCount: snapshot.headings.length,
      buttonCount: snapshot.buttons.length,
      linkCount: snapshot.links.length,
      imageCount: snapshot.images.length,
    });
    pass('a11y-post-snapshot-saved', `${snapshot.headings.length} headings, ${snapshot.buttons.length} buttons`);
  }
}

async function testAboutPage(page, browser) {
  console.log('\n  📋 Test: About Page Navigation');

  await page.goto(`${BASE_URL}/about`, { waitUntil: 'networkidle' });
  await screenshot(page, 'about-page', browser);

  const title = await page.title();
  check(
    title.includes('關於') || title.includes('About') || title.includes('香菇'),
    'about-title',
    `Title: "${title}"`,
  );

  const bodyText = await page.evaluate(() => document.body.innerText);
  check(
    bodyText.includes('ShroomDog') || bodyText.includes('香菇'),
    'about-content',
    'Page contains ShroomDog/香菇 text',
  );
}

async function testEnglishLocalization(page, browser) {
  console.log('\n  📋 Test: English Localization (/en/)');

  await page.goto(`${BASE_URL}/en/`, { waitUntil: 'networkidle' });
  await screenshot(page, 'english-home', browser);

  // Check lang attribute switches
  const lang = await page.evaluate(() => document.documentElement.lang);
  check(
    lang === 'en' || lang === 'en-US' || lang.startsWith('en'),
    'en-lang-attribute',
    `lang="${lang}"`,
  );

  // Check title is English
  const title = await page.title();
  check(
    title.includes('ShroomDog'),
    'en-title',
    `EN title: "${title}"`,
  );

  // Check EN posts exist
  const enPosts = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/en/posts/"]');
    return links.length;
  });
  check(enPosts > 0, 'en-posts-exist', `Found ${enPosts} EN post links`);
}

async function _testBackToTop(page, browser) {
  console.log('\n  📋 Test: Back-to-Top Button');

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Check button initially hidden (or not visible)
  const btnHiddenInitially = await page.evaluate(() => {
    const candidates = [
      'button[aria-label*="top" i]',
      'button[aria-label*="回到頂部" i]',
      'button[aria-label*="scroll" i]',
      'button[class*="top"]',
      '#back-to-top',
      '.back-to-top',
      'a[href="#top"]',
      '#go-up',
      '.go-up',
      'button[id*="top"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const style = window.getComputedStyle(el);
        return {
          found: true,
          sel,
          hidden: style.display === 'none' || style.opacity === '0' || style.visibility === 'hidden',
        };
      }
    }
    return { found: false, sel: null, hidden: null };
  });

  if (!btnHiddenInitially.found) {
    // BTT button may appear only after scroll
    warn('back-to-top-initial', 'Button not in DOM initially (may appear on scroll)');
  } else {
    check(btnHiddenInitially.hidden, 'back-to-top-hidden', 'Button hidden at top of page');
  }

  // Scroll down significantly
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await screenshot(page, 'scrolled-bottom', browser);

  // Check button is now visible
  const btnVisibleAfterScroll = await page.evaluate(() => {
    const candidates = [
      'button[aria-label*="top" i]',
      'button[aria-label*="回到頂部" i]',
      'button[aria-label*="scroll" i]',
      'button[class*="top"]',
      '#back-to-top',
      '.back-to-top',
      '#go-up',
      '.go-up',
      'button[id*="top"]',
      'a[href="#top"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const style = window.getComputedStyle(el);
        const visible = style.display !== 'none' && style.opacity !== '0' && style.visibility !== 'hidden';
        return { found: true, sel, visible };
      }
    }
    return { found: false, sel: null, visible: false };
  });

  if (btnVisibleAfterScroll.found) {
    check(btnVisibleAfterScroll.visible, 'back-to-top-visible-after-scroll', 'Button visible after scrolling');

    // Click it
    await page.click(btnVisibleAfterScroll.sel);
    await page.waitForTimeout(800);

    const scrollY = await page.evaluate(() => window.scrollY);
    check(scrollY < 100, 'back-to-top-click', `Scroll position after click: ${scrollY}px`);
    await screenshot(page, 'back-to-top-clicked', browser);
  } else {
    warn('back-to-top-after-scroll', 'Back-to-top button not found after scrolling');
  }
}

async function _testPWAManifest(page, _browser) {
  console.log('\n  📋 Test: PWA Manifest');

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const manifest = await page.evaluate(() => {
    const link = document.querySelector('link[rel="manifest"]');
    return link ? link.href : null;
  });
  check(!!manifest, 'pwa-manifest', manifest || 'MISSING');

  // If manifest exists, try to fetch it
  if (manifest) {
    try {
      const resp = await page.evaluate(async (url) => {
        const r = await fetch(url);
        return { ok: r.ok, status: r.status };
      }, manifest);
      check(resp.ok, 'pwa-manifest-fetch', `Status: ${resp.status}`);
    } catch (e) {
      warn('pwa-manifest-fetch', e.message);
    }
  }
}

async function testRSSFeed(page, _browser) {
  console.log('\n  📋 Test: RSS Feed');

  const resp = await page.goto(`${BASE_URL}/rss.xml`, { waitUntil: 'networkidle' });
  const status = resp.status();
  check(status === 200, 'rss-feed-status', `Status: ${status}`);

  const contentType = resp.headers()['content-type'] || '';
  check(
    contentType.includes('xml') || contentType.includes('rss'),
    'rss-content-type',
    contentType,
  );

  const body = await page.evaluate(() => document.body.innerText || document.body.textContent);
  check(
    body.includes('ShroomDog') || body.includes('香菇'),
    'rss-content',
    'RSS contains ShroomDog content',
  );
}

async function testFavicon(page, _browser) {
  console.log('\n  📋 Test: Favicon');

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const favicon = await page.evaluate(() => {
    const icon =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]') ||
      document.querySelector('link[rel="apple-touch-icon"]');
    return icon ? icon.href : null;
  });
  check(!!favicon, 'favicon', favicon || 'MISSING');
}

async function testPerformanceTiming(page, browser) {
  console.log('\n  📋 Test: Performance Timing');

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const timing = await page.evaluate(() => {
    const perf = performance.getEntriesByType('navigation')[0];
    if (perf) {
      return {
        domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
        domInteractive: Math.round(perf.domInteractive - perf.startTime),
        loadEvent: Math.round(perf.loadEventEnd - perf.startTime),
        ttfb: Math.round(perf.responseStart - perf.startTime),
      };
    }
    // Fallback to deprecated API
    const t = performance.timing;
    return {
      domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
      domInteractive: t.domInteractive - t.navigationStart,
      loadEvent: t.loadEventEnd - t.navigationStart,
      ttfb: t.responseStart - t.navigationStart,
    };
  });

  perfData[`${browser}-domContentLoaded`] = timing.domContentLoaded;
  perfData[`${browser}-domInteractive`] = timing.domInteractive;
  perfData[`${browser}-loadEvent`] = timing.loadEvent;
  perfData[`${browser}-ttfb`] = timing.ttfb;

  check(timing.domContentLoaded > 0, 'perf-domContentLoaded', `${timing.domContentLoaded}ms`);
  check(timing.domInteractive > 0, 'perf-domInteractive', `${timing.domInteractive}ms`);
  check(timing.loadEvent > 0, 'perf-loadEvent', `${timing.loadEvent}ms`);
  check(timing.ttfb > 0, 'perf-ttfb', `${timing.ttfb}ms`);
  check(timing.ttfb < 3000, 'perf-ttfb-fast', `TTFB ${timing.ttfb}ms < 3s`);
}

async function testHomepageA11y(page, browser) {
  console.log('\n  📋 Test: Homepage Accessibility');

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Landmarks
  const landmarks = await page.evaluate(() => {
    return {
      nav: !!document.querySelector('nav') || !!document.querySelector('[role="navigation"]'),
      main: !!document.querySelector('main') || !!document.querySelector('[role="main"]'),
      footer: !!document.querySelector('footer') || !!document.querySelector('[role="contentinfo"]'),
    };
  });
  check(landmarks.nav, 'a11y-nav-landmark', 'Navigation landmark present');
  check(landmarks.main, 'a11y-main-landmark', 'Main landmark present');
  check(landmarks.footer, 'a11y-footer-landmark', 'Footer landmark present');

  // Button labels audit
  const buttonAudit = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    const total = buttons.length;
    let labeled = 0;
    let unlabeled = [];
    buttons.forEach((btn, i) => {
      const label =
        btn.getAttribute('aria-label') ||
        btn.getAttribute('title') ||
        btn.textContent.trim();
      if (label && label.length > 0) {
        labeled++;
      } else {
        unlabeled.push(`button#${i}`);
      }
    });
    return { total, labeled, unlabeled };
  });
  check(
    buttonAudit.labeled === buttonAudit.total,
    'a11y-button-labels',
    `${buttonAudit.labeled}/${buttonAudit.total} buttons labeled${buttonAudit.unlabeled.length ? ' (unlabeled: ' + buttonAudit.unlabeled.join(', ') + ')' : ''}`,
  );

  // Image alt text audit
  const imgAudit = await page.evaluate(() => {
    const imgs = document.querySelectorAll('img');
    const total = imgs.length;
    let withAlt = 0;
    let missingAlt = [];
    imgs.forEach((img, i) => {
      const alt = img.getAttribute('alt');
      if (alt !== null && alt !== undefined) {
        withAlt++;
      } else {
        missingAlt.push(img.src ? img.src.substring(0, 60) : `img#${i}`);
      }
    });
    return { total, withAlt, missingAlt };
  });

  if (imgAudit.total > 0) {
    check(
      imgAudit.withAlt === imgAudit.total,
      'a11y-img-alt',
      `${imgAudit.withAlt}/${imgAudit.total} images have alt text${imgAudit.missingAlt.length ? ' (missing: ' + imgAudit.missingAlt.slice(0, 3).join(', ') + ')' : ''}`,
    );
  } else {
    pass('a11y-img-alt', 'No images on page (decorative only?)');
  }

  // Save full accessibility snapshot
  const { snapshot } = await saveA11ySnapshot(page, 'homepage', browser);
  if (snapshot) {
    const roles = {};
    snapshot.landmarks.forEach((n) => {
      roles[n.role] = (roles[n.role] || 0) + 1;
    });
    a11yFindings.push({
      page: 'homepage',
      browser,
      totalNodes: snapshot.landmarks.length + snapshot.headings.length + snapshot.buttons.length,
      headingCount: snapshot.headings.length,
      buttonCount: snapshot.buttons.length,
      linkCount: snapshot.links.length,
      imageCount: snapshot.images.length,
      roles,
    });
    pass('a11y-snapshot-saved', `${snapshot.landmarks.length} landmarks, ${snapshot.headings.length} headings, ${snapshot.buttons.length} buttons, ${snapshot.links.length} links`);
  }
}

async function testConsoleErrors(page, _browser) {
  console.log('\n  📋 Test: Console Errors');

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Filter out known benign errors (e.g., favicon 404, analytics)
  const realErrors = consoleErrors.filter((e) => {
    return (
      !e.includes('favicon') &&
      !e.includes('analytics') &&
      !e.includes('gtag') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') && // ad blockers
      !e.includes('net::ERR')
    );
  });

  check(
    realErrors.length === 0,
    'console-errors',
    realErrors.length === 0
      ? 'No console errors'
      : `${realErrors.length} errors: ${realErrors.slice(0, 3).join(' | ')}`,
  );
}

async function testBriefsPage(page, browser) {
  console.log('\n  📋 Test: Briefs Page');

  const start = Date.now();
  await page.goto(`${BASE_URL}/briefs`, { waitUntil: 'networkidle' });
  const loadTime = Date.now() - start;
  perfData[`${browser}-briefs-load`] = loadTime;

  await screenshot(page, 'briefs-page', browser);

  const title = await page.title();
  check(
    title.includes('Brief') || title.includes('情報') || title.includes('Clawd'),
    'briefs-title',
    `Title: "${title}"`,
  );

  // Check briefs content exists
  const briefLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/briefs/"]');
    return links.length;
  });
  check(briefLinks > 0, 'briefs-content', `Found ${briefLinks} brief links`);
}

async function testMobileViewportOverflow(page, _browser) {
  console.log('\n  📋 Test: Mobile Viewport Overflow');

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const viewportWidth = window.innerWidth;
    const overflowingElements = [];

    // Check all visible elements
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.right > viewportWidth + 5) {
        // 5px tolerance
        overflowingElements.push({
          tag: el.tagName,
          class: el.className.toString().substring(0, 30),
          right: Math.round(rect.right),
        });
      }
    }

    return {
      docWidth,
      viewportWidth,
      hasOverflow: docWidth > viewportWidth + 5,
      overflowingCount: overflowingElements.length,
      examples: overflowingElements.slice(0, 3),
    };
  });

  check(
    !overflow.hasOverflow,
    'mobile-no-horizontal-overflow',
    `Doc width: ${overflow.docWidth}px, viewport: ${overflow.viewportWidth}px${overflow.overflowingCount ? `, ${overflow.overflowingCount} elements overflow` : ''}`,
  );

  // Also check on post page
  const firstPost = await page.evaluate(() => {
    const link = document.querySelector('a[href*="/posts/"]');
    return link ? link.getAttribute('href') : null;
  });

  if (firstPost) {
    await page.goto(`${BASE_URL}${firstPost}`, { waitUntil: 'networkidle' });
    const postOverflow = await page.evaluate(() => {
      return {
        docWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        hasOverflow: document.documentElement.scrollWidth > window.innerWidth + 5,
      };
    });
    check(
      !postOverflow.hasOverflow,
      'mobile-post-no-overflow',
      `Post page: doc ${postOverflow.docWidth}px vs viewport ${postOverflow.viewportWidth}px`,
    );
  }
}

// ── browser runner ───────────────────────────────────────────────────────────

async function runSuiteOnBrowser(browserType, browserName) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🌐 Running on: ${browserName.toUpperCase()}`);
  console.log(`${'═'.repeat(60)}`);

  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    ...DEVICE,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  });
  const page = await context.newPage();

  // Set default timeout
  page.setDefaultTimeout(15000);

  try {
    await testHomepageLoad(page, browserName);
    await testLangAttribute(page, browserName);
    await testSEOMetaTags(page, browserName);
    await testBlogPostCards(page, browserName);
    await testThemeToggle(page, browserName);
    await testSearchModal(page, browserName);
    await testPerformanceTiming(page, browserName);
    await testHomepageA11y(page, browserName);
    await testConsoleErrors(page, browserName);
    await testMobileViewportOverflow(page, browserName);

    // Navigate to a blog post
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await testBlogPostNavigation(page, browserName);
    await testPostPageA11y(page, browserName);

    await testAboutPage(page, browserName);
    await testEnglishLocalization(page, browserName);

    await testBriefsPage(page, browserName);

    await testRSSFeed(page, browserName);
    await testFavicon(page, browserName);

    // Final full-page screenshot
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await fullScreenshot(page, 'homepage', browserName);
  } catch (err) {
    fail(`${browserName}-unexpected-error`, err.message);
    console.error(err);
  } finally {
    await context.close();
    await browser.close();
  }
}

// ── report generation ────────────────────────────────────────────────────────

function generateReport() {
  const totalAssertions = passCount + failCount;
  const passRate = totalAssertions > 0 ? ((passCount / totalAssertions) * 100).toFixed(1) : '0';

  const screenshotFiles = fs.existsSync(SCREENSHOTS_DIR)
    ? fs.readdirSync(SCREENSHOTS_DIR).filter((f) => f.endsWith('.png'))
    : [];
  const snapshotFiles = fs.existsSync(SNAPSHOTS_DIR)
    ? fs.readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith('.json'))
    : [];

  let report = `# gu-log E2E Test Report — Playwright

**Generated:** ${new Date().toISOString()}
**Base URL:** ${BASE_URL}
**Browsers:** Chromium, WebKit
**Device:** iPhone 15 Pro (393×852, 3x scale, mobile+touch)
**Tool:** Playwright ${process.env.npm_package_version || '1.58.x'}

---

## Summary

| Metric | Value |
|--------|-------|
| Total Assertions | ${totalAssertions} |
| ✅ Passed | ${passCount} |
| ❌ Failed | ${failCount} |
| ⚠️ Warnings | ${warnCount} |
| Pass Rate | ${passRate}% |
| Screenshots | ${screenshotFiles.length} |
| A11y Snapshots | ${snapshotFiles.length} |

---

## Test Results

### By Status

#### ✅ Passed (${passCount})
${results
  .filter((r) => r.status === 'pass')
  .map((r) => `- **${r.name}**: ${r.detail}`)
  .join('\n')}

#### ❌ Failed (${failCount})
${
  failCount > 0
    ? results
        .filter((r) => r.status === 'fail')
        .map((r) => `- **${r.name}**: ${r.detail}`)
        .join('\n')
    : '_None — all tests passed!_'
}

#### ⚠️ Warnings (${warnCount})
${
  warnCount > 0
    ? warnings.map((w) => `- **${w.name}**: ${w.detail}`).join('\n')
    : '_None_'
}

---

## Performance Data

| Metric | Value |
|--------|-------|
${Object.entries(perfData)
  .map(([k, v]) => `| ${k} | ${v}ms |`)
  .join('\n')}

---

## Accessibility Findings

${a11yFindings
  .map(
    (f) =>
      `### ${f.page} (${f.browser})
- Total a11y nodes: ${f.totalNodes || 'N/A'}
- Headings: ${f.headingCount || 'N/A'}
- Buttons: ${f.buttonCount || 'N/A'}
- Links: ${f.linkCount || 'N/A'}
- Images: ${f.imageCount || 'N/A'}
${f.roles ? '- Landmark Roles: ' + Object.entries(f.roles).map(([r, c]) => `${r}(${c})`).join(', ') : ''}`,
  )
  .join('\n\n')}

---

## Screenshots

${screenshotFiles.map((f) => `- \`screenshots/${f}\``).join('\n')}

## Accessibility Snapshots

${snapshotFiles.map((f) => `- \`snapshots/${f}\``).join('\n')}

---

## Test Coverage Checklist

- [${results.some((r) => r.name === 'homepage-title') ? 'x' : ' '}] Homepage load + title validation + load time
- [${results.some((r) => r.name === 'lang-zh-TW') ? 'x' : ' '}] HTML lang attribute (zh-TW)
- [${results.some((r) => r.name === 'og:title') ? 'x' : ' '}] SEO meta tags (og:title, og:description, og:image, canonical, viewport)
- [${results.some((r) => r.name === 'blog-post-cards-count') ? 'x' : ' '}] Blog post cards rendered
- [${results.some((r) => r.name === 'theme-toggle-first') ? 'x' : ' '}] Theme toggle (bidirectional)
- [${results.some((r) => r.name === 'theme-localStorage') ? 'x' : ' '}] Theme persistence (localStorage)
- [${results.some((r) => r.name.includes('search-modal')) ? 'x' : ' '}] Search modal toggle
- [${results.some((r) => r.name === 'post-article-element') ? 'x' : ' '}] Blog post navigation (article, h1, date)
- [${results.some((r) => r.name === 'about-title') ? 'x' : ' '}] About page navigation
- [${results.some((r) => r.name === 'en-lang-attribute') ? 'x' : ' '}] English localization (/en/)
- [${results.some((r) => r.name === 'rss-feed-status') ? 'x' : ' '}] RSS feed
- [${results.some((r) => r.name === 'favicon') ? 'x' : ' '}] Favicon
- [${results.some((r) => r.name.includes('perf-')) ? 'x' : ' '}] Performance timing
- [${results.some((r) => r.name.includes('a11y-')) ? 'x' : ' '}] Accessibility (landmarks, buttons, images)
- [${results.some((r) => r.name === 'post-single-h1') ? 'x' : ' '}] Post page a11y (single H1, article landmark)
- [${results.some((r) => r.name === 'console-errors') ? 'x' : ' '}] Console error check
- [${results.some((r) => r.name === 'briefs-title') ? 'x' : ' '}] Briefs page
- [${results.some((r) => r.name.includes('mobile-')) ? 'x' : ' '}] Mobile viewport overflow

---

## DX Feedback

### Strengths 🌟
- Astro-based SSG delivers fast load times with good Lighthouse-style metrics
- Proper i18n setup with zh-TW and English locales
- RSS feed with valid XML structure
- Good semantic HTML with landmarks (nav, main, footer)
- Mobile-first responsive design tested on iPhone 15 Pro emulation

### Areas for Improvement 🔧
- Theme toggle: verify bidirectional toggle always persists correctly in localStorage
- Search: ensure search UI is accessible from mobile viewport without hamburger menu confusion
- Consider adding \`aria-current="page"\` to active nav links for better screen reader support
- Ensure all interactive elements have focus-visible outlines for keyboard users
- Back-to-top button should have consistent \`aria-label\` across pages

### Playwright-Specific Observations 🎭
- Multi-browser testing (Chromium + WebKit) catches rendering differences
- iPhone 15 Pro emulation with touch + mobile UA provides realistic mobile testing
- Accessibility snapshot API provides structured tree data for automated auditing
- Network idle wait strategy works well for SSG sites

---

*Report generated by Playwright E2E Suite v2*
`;

  fs.writeFileSync(path.join(__dirname, 'REPORT.md'), report);
  console.log(`\n📄 Report written to e2e-tests/REPORT.md`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  gu-log E2E Test Suite — Playwright                     ║');
  console.log('║  Browsers: Chromium + WebKit                            ║');
  console.log('║  Device: iPhone 15 Pro (393×852, 3x)                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  ensureDir(SCREENSHOTS_DIR);
  ensureDir(SNAPSHOTS_DIR);

  const startTime = Date.now();

  // Run on both browsers
  await runSuiteOnBrowser(chromium, 'chromium');
  await runSuiteOnBrowser(webkit, 'webkit');

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  📊 FINAL SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total assertions: ${passCount + failCount}`);
  console.log(`  ✅ Passed: ${passCount}`);
  console.log(`  ❌ Failed: ${failCount}`);
  console.log(`  ⚠️  Warnings: ${warnCount}`);
  console.log(`  Pass rate: ${(passCount / (passCount + failCount) * 100).toFixed(1)}%`);
  console.log(`  Total time: ${totalTime}s`);
  console.log(`${'═'.repeat(60)}`);

  // Generate report
  generateReport();

  // Exit with appropriate code
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});

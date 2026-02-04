#!/usr/bin/env node

/**
 * Visual regression test with programmatic UI checks
 * Takes screenshots and verifies critical UI elements
 * 
 * Usage: node scripts/visual-test.mjs [base-url] [post-path]
 * Default: https://gu-log.vercel.app /posts/recursive-language-models-mit
 * 
 * Exit codes:
 *   0 = PASS (all checks passed)
 *   1 = FAIL (UI issues detected)
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const BASE_URL = process.argv[2] || 'https://gu-log.vercel.app';
const TEST_PATH = process.argv[3] || '/posts/recursive-language-models-mit';
const REPORT_DIR = path.resolve('.playwright-cli/report');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, checkTocVisible: true },
  { name: 'mobile', width: 393, height: 852, checkTocVisible: false },
];

async function checkPage(page, viewport) {
  const issues = [];
  const checks = [];

  // 1. Check ClawdNote elements
  const clawdNotes = page.locator('blockquote.claude-note');
  const clawdNoteCount = await clawdNotes.count();
  
  if (clawdNoteCount === 0) {
    issues.push({ severity: 'WARNING', description: 'No ClawdNote found on page (might be below fold)' });
  } else {
    checks.push(`✓ Found ${clawdNoteCount} ClawdNote(s)`);
    
    // Check if ClawdNotes have the prefix
    for (let i = 0; i < Math.min(clawdNoteCount, 3); i++) {
      const note = clawdNotes.nth(i);
      const prefix = note.locator('.clawd-prefix');
      const hasPrefix = await prefix.count() > 0;
      
      if (!hasPrefix) {
        // Check if content starts with "Clawd"
        const text = await note.textContent();
        if (!text.includes('Clawd')) {
          issues.push({ 
            severity: 'CRITICAL', 
            description: `ClawdNote #${i + 1} missing "Clawd" attribution` 
          });
        }
      } else {
        const prefixText = await prefix.textContent();
        checks.push(`✓ ClawdNote #${i + 1} has prefix: "${prefixText.trim()}"`);
      }
    }
    
    // Check orange border (computed style)
    const firstNote = clawdNotes.first();
    const borderColor = await firstNote.evaluate(el => 
      getComputedStyle(el).borderLeftColor
    );
    
    // Check if it's orange-ish (RGB values)
    const isOrange = borderColor.includes('203') || // #cb7551
                     borderColor.includes('orange') ||
                     borderColor.includes('rgb(203');
    
    if (!isOrange) {
      issues.push({ 
        severity: 'WARNING', 
        description: `ClawdNote border color might not be orange: ${borderColor}` 
      });
    } else {
      checks.push(`✓ ClawdNote has orange border`);
    }
  }

  // 2. Check TOC (Table of Contents)
  if (viewport.checkTocVisible) {
    const toc = page.locator('[class*="toc"], nav[aria-label*="目錄"], aside:has(nav)');
    const tocVisible = await toc.first().isVisible().catch(() => false);
    
    if (tocVisible) {
      checks.push(`✓ TOC is visible on desktop`);
      
      // Check TOC has links
      const tocLinks = toc.first().locator('a');
      const linkCount = await tocLinks.count();
      if (linkCount > 0) {
        checks.push(`✓ TOC has ${linkCount} links`);
      } else {
        issues.push({ severity: 'WARNING', description: 'TOC visible but has no links' });
      }
    } else {
      // TOC might be in a collapsible component
      const tocButton = page.locator('button:has-text("目錄")');
      const hasTocButton = await tocButton.count() > 0;
      
      if (hasTocButton) {
        checks.push(`✓ TOC is collapsible (has button)`);
      } else {
        issues.push({ severity: 'WARNING', description: 'TOC not visible on desktop (might be OK for short articles)' });
      }
    }
  }

  // 3. Check headings have IDs (for anchor links)
  const h2Headings = page.locator('article h2');
  const h2Count = await h2Headings.count();
  
  if (h2Count > 0) {
    let missingIds = 0;
    for (let i = 0; i < h2Count; i++) {
      const id = await h2Headings.nth(i).getAttribute('id');
      if (!id) missingIds++;
    }
    
    if (missingIds > 0) {
      issues.push({ 
        severity: 'WARNING', 
        description: `${missingIds}/${h2Count} h2 headings missing ID attribute (TOC links may not work)` 
      });
    } else {
      checks.push(`✓ All ${h2Count} h2 headings have IDs`);
    }
  }

  // 4. Check for Chinese text rendering (no tofu/boxes)
  const articleText = await page.locator('article').textContent();
  const hasChineseChars = /[\u4e00-\u9fff]/.test(articleText);
  
  if (hasChineseChars) {
    checks.push(`✓ Chinese characters present`);
  }

  // 5. Check code blocks have proper styling
  const codeBlocks = page.locator('pre code, pre');
  const codeBlockCount = await codeBlocks.count();
  
  if (codeBlockCount > 0) {
    const firstCode = codeBlocks.first();
    const bgColor = await firstCode.evaluate(el => 
      getComputedStyle(el).backgroundColor
    );
    
    // Should have some background color (not transparent)
    if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
      issues.push({ severity: 'WARNING', description: 'Code blocks may not have background styling' });
    } else {
      checks.push(`✓ Code blocks have background color`);
    }
  }

  // 6. Check no horizontal overflow
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = viewport.width;
  
  if (bodyWidth > viewportWidth + 10) { // 10px tolerance
    issues.push({ 
      severity: 'CRITICAL', 
      description: `Page has horizontal overflow: body ${bodyWidth}px > viewport ${viewportWidth}px` 
    });
  } else {
    checks.push(`✓ No horizontal overflow`);
  }

  return { checks, issues };
}

async function run() {
  await mkdir(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const url = `${BASE_URL}${TEST_PATH}`;

  console.log(`\n📸 Visual UI test — ${url}\n`);
  
  const allResults = [];
  let hasFailure = false;

  for (const vp of VIEWPORTS) {
    console.log(`\n📱 Testing ${vp.name} (${vp.width}x${vp.height})...`);
    
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);

      // Take screenshot
      const screenshotPath = path.join(REPORT_DIR, `${vp.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`  📷 Screenshot: ${screenshotPath}`);

      // Run checks
      const { checks, issues } = await checkPage(page, vp);
      
      // Print checks
      for (const check of checks) {
        console.log(`  ${check}`);
      }
      
      // Print issues
      const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
      const warnings = issues.filter(i => i.severity === 'WARNING');
      
      for (const issue of criticalIssues) {
        console.log(`  🚨 [CRITICAL] ${issue.description}`);
        hasFailure = true;
      }
      
      for (const issue of warnings) {
        console.log(`  ⚠️ [WARNING] ${issue.description}`);
      }
      
      allResults.push({ viewport: vp.name, checks, issues });
      
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      hasFailure = true;
      allResults.push({ viewport: vp.name, error: err.message });
    }

    await context.close();
  }

  await browser.close();
  
  // Write report
  const reportPath = path.join(REPORT_DIR, 'ui-check.json');
  await writeFile(reportPath, JSON.stringify(allResults, null, 2));
  console.log(`\n📄 Report: ${reportPath}`);

  // Final result
  console.log('\n' + '='.repeat(50));
  
  if (hasFailure) {
    console.log('❌ VISUAL TEST FAILED');
    console.log('   Fix CRITICAL issues before committing.');
    process.exit(1);
  } else {
    console.log('✅ VISUAL TEST PASSED');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('❌ Visual test error:', err.message);
  process.exit(1);
});

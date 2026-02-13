#!/usr/bin/env node

/**
 * Mermaid Visual Quality Check
 *
 * Takes screenshots of Mermaid diagrams at iPhone viewport (390×844)
 * and uses an LLM (Anthropic Claude) to judge mobile readability.
 *
 * Usage:
 *   node scripts/check-mermaid-visual.mjs              # Scan all posts with Mermaid
 *   node scripts/check-mermaid-visual.mjs --files a.mdx b.mdx  # Scan specific files
 *
 * Environment:
 *   ANTHROPIC_API_KEY  — Required. Anthropic API key for vision judging.
 *   MERMAID_CHECK_MODEL — Optional. Model to use (default: claude-sonnet-4-20250514).
 *   BASE_URL           — Optional. Base URL (default: http://localhost:4321).
 *
 * Exit codes:
 *   0 = All diagrams PASS
 *   1 = At least one diagram FAIL
 *   2 = Script error (missing deps, server not up, etc.)
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const SCREENSHOT_DIR = path.join(REPO_ROOT, '.mermaid-screenshots');

// iPhone 14 viewport
const VIEWPORT = { width: 390, height: 844 };
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4321';
const MODEL = process.env.MERMAID_CHECK_MODEL || 'claude-sonnet-4-20250514';

const JUDGE_PROMPT = `你是一個 UI/UX 品質審查員。這張圖是一個 Mermaid 圖表在 iPhone 上的截圖（390px 寬）。

請判定：
1. 文字是否可讀？（字體大小至少要能辨識，不能是螞蟻字）
2. 節點關係是否看得出來？（箭頭/連線清楚）
3. 整體是否有意義？（不是一坨模糊色塊）

回答 PASS 或 FAIL，後面附一句理由。
格式範例：
PASS: 文字清晰，關係明確
FAIL: 文字太小無法閱讀`;

// ─── Helpers ─────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const files = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--files') {
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        files.push(args[i]);
        i++;
      }
    } else {
      // Treat bare args as files too
      files.push(args[i]);
      i++;
    }
  }
  return { files };
}

/**
 * Find all .mdx files that contain <Mermaid
 * @param {string[]} specificFiles - Optional list of specific files (relative to repo root)
 * @returns {string[]} - Array of absolute file paths
 */
async function findMermaidFiles(specificFiles) {
  let candidates;

  if (specificFiles && specificFiles.length > 0) {
    // Use the specific files provided
    candidates = specificFiles.map((f) => {
      const abs = path.isAbsolute(f) ? f : path.resolve(REPO_ROOT, f);
      return abs;
    });
  } else {
    // Scan all posts
    const allFiles = await readdir(POSTS_DIR);
    candidates = allFiles
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => path.join(POSTS_DIR, f));
  }

  // Filter to only files that contain <Mermaid
  return candidates.filter((f) => {
    if (!existsSync(f)) return false;
    const content = readFileSync(f, 'utf-8');
    return content.includes('<Mermaid');
  });
}

/**
 * Map a .mdx file path to its URL path on the dev server
 */
function fileToUrl(filePath) {
  const filename = path.basename(filePath, '.mdx');
  const content = readFileSync(filePath, 'utf-8');

  // Check if it's an English post
  const langMatch = content.match(/^lang:\s*["']?(en)["']?/m);
  const isEnglish = langMatch !== null;

  if (isEnglish) {
    return `/en/posts/${filename}`;
  } else {
    return `/posts/${filename}`;
  }
}

/**
 * Count how many <Mermaid occurrences in a file
 */
function countMermaids(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const matches = content.match(/<Mermaid/g);
  return matches ? matches.length : 0;
}

/**
 * Judge a screenshot using Claude vision API
 */
async function judgeScreenshot(screenshotPath) {
  const imageData = readFileSync(screenshotPath);
  const base64Image = imageData.toString('base64');

  // Try Anthropic SDK first
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: JUDGE_PROMPT,
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return text.trim();
  } catch (sdkError) {
    // Fallback: try claude -p with --input-format stream-json
    console.warn(
      `  ⚠️  SDK failed (${sdkError.message}), trying claude CLI fallback...`
    );
    return judgeWithClaudeCli(base64Image);
  }
}

/**
 * Fallback: use claude -p with stream-json to pass image
 */
function judgeWithClaudeCli(base64Image) {
  return new Promise((resolve, reject) => {
    const inputMsg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: JUDGE_PROMPT,
          },
        ],
      },
    });

    try {
      const result = execSync(
        `echo '${inputMsg.replace(/'/g, "'\\''")}' | claude -p --input-format stream-json --output-format json --model ${MODEL} --dangerously-skip-permissions 2>/dev/null`,
        {
          encoding: 'utf-8',
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      // Parse JSON output
      try {
        const parsed = JSON.parse(result);
        resolve(parsed.result || parsed.text || result.trim());
      } catch {
        resolve(result.trim());
      }
    } catch (err) {
      reject(
        new Error(
          `claude CLI fallback failed: ${err.message}\n` +
            'Please set ANTHROPIC_API_KEY environment variable.'
        )
      );
    }
  });
}

/**
 * Wait for dev server to be ready
 */
async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const { files } = parseArgs();

  console.log('🔍 Mermaid Visual Quality Check');
  console.log(`   Viewport: ${VIEWPORT.width}×${VIEWPORT.height} (iPhone 14)`);
  console.log(`   Model: ${MODEL}`);
  console.log('');

  // 1. Find files with Mermaid diagrams
  const mermaidFiles = await findMermaidFiles(
    files.length > 0 ? files : undefined
  );

  if (mermaidFiles.length === 0) {
    console.log('✅ No Mermaid diagrams found in target files.');
    process.exit(0);
  }

  console.log(
    `📄 Found ${mermaidFiles.length} file(s) with Mermaid diagrams:`
  );
  for (const f of mermaidFiles) {
    const count = countMermaids(f);
    console.log(`   ${path.relative(REPO_ROOT, f)} (${count} diagram${count > 1 ? 's' : ''})`);
  }
  console.log('');

  // 2. Check API key availability
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      '⚠️  ANTHROPIC_API_KEY not set. Will try claude CLI fallback.'
    );
    console.warn(
      '   For best results: export ANTHROPIC_API_KEY=sk-ant-...'
    );
    console.log('');
  }

  // 3. Check if dev server is running, start if needed
  let serverProcess = null;
  const serverUp = await waitForServer(BASE_URL, 3_000);

  if (!serverUp) {
    console.log('🚀 Starting dev server...');
    serverProcess = spawn('npm', ['run', 'dev'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      detached: true,
    });

    const ready = await waitForServer(BASE_URL, 60_000);
    if (!ready) {
      console.error('❌ Dev server failed to start within 60s');
      serverProcess.kill();
      process.exit(2);
    }
    console.log('✓ Dev server ready');
    console.log('');
  }

  // 4. Prepare screenshot directory
  if (existsSync(SCREENSHOT_DIR)) {
    rmSync(SCREENSHOT_DIR, { recursive: true });
  }
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // 5. Launch Playwright browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT,
    deviceScaleFactor: 3, // Retina for crisp screenshots
    isMobile: true,
    hasTouch: true,
  });

  const results = [];
  let totalDiagrams = 0;
  let failures = 0;

  try {
    for (const filePath of mermaidFiles) {
      const urlPath = fileToUrl(filePath);
      const fullUrl = `${BASE_URL}${urlPath}`;
      const relPath = path.relative(REPO_ROOT, filePath);

      console.log(`📸 ${relPath}`);
      console.log(`   URL: ${urlPath}`);

      const page = await context.newPage();

      try {
        // Navigate and wait for Mermaid to render
        await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30_000 });

        // Wait for Mermaid diagrams to render (they load async via CDN)
        await page.waitForSelector('.mermaid-render svg', { timeout: 15_000 });

        // Small extra wait for fonts to load
        await page.waitForTimeout(2000);

        // Find all rendered Mermaid diagrams
        const wrappers = page.locator('.mermaid-wrapper');
        const count = await wrappers.count();

        console.log(`   Found ${count} diagram(s)`);

        for (let i = 0; i < count; i++) {
          totalDiagrams++;
          const wrapper = wrappers.nth(i);

          // Get the caption if available
          const caption = await wrapper
            .locator('.mermaid-caption')
            .textContent()
            .catch(() => null);
          const label = caption || `Diagram #${i + 1}`;

          // Screenshot the render area (the actual SVG diagram)
          const renderEl = wrapper.locator('.mermaid-render');

          // Ensure element is visible and scrolled into view
          await renderEl.scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);

          const screenshotName = `${path.basename(filePath, '.mdx')}_diagram_${i + 1}.png`;
          const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);

          await renderEl.screenshot({ path: screenshotPath });

          console.log(`   📷 ${label} → ${screenshotName}`);

          // Judge with LLM
          try {
            const verdict = await judgeScreenshot(screenshotPath);
            const isPassing = verdict.toUpperCase().startsWith('PASS');

            results.push({
              file: relPath,
              diagram: label,
              index: i + 1,
              screenshot: screenshotName,
              verdict,
              pass: isPassing,
            });

            if (isPassing) {
              console.log(`   ✅ ${verdict}`);
            } else {
              failures++;
              console.log(`   ❌ ${verdict}`);
            }
          } catch (judgeErr) {
            failures++;
            const errorMsg = `ERROR: ${judgeErr.message}`;
            results.push({
              file: relPath,
              diagram: label,
              index: i + 1,
              screenshot: screenshotName,
              verdict: errorMsg,
              pass: false,
            });
            console.log(`   ⚠️  Judge error: ${judgeErr.message}`);
          }
        }
      } catch (pageErr) {
        console.log(`   ⚠️  Page error: ${pageErr.message}`);
        results.push({
          file: relPath,
          diagram: 'N/A',
          index: 0,
          screenshot: '',
          verdict: `PAGE_ERROR: ${pageErr.message}`,
          pass: false,
        });
        failures++;
      } finally {
        await page.close();
      }

      console.log('');
    }
  } finally {
    await browser.close();

    // Kill dev server if we started it
    if (serverProcess) {
      process.kill(-serverProcess.pid);
      console.log('🛑 Dev server stopped');
    }
  }

  // 6. Print summary
  console.log('═══════════════════════════════════════════');
  console.log('📊 Mermaid Visual Quality Report');
  console.log('═══════════════════════════════════════════');
  console.log(`Total diagrams checked: ${totalDiagrams}`);
  console.log(`Passed: ${totalDiagrams - failures}`);
  console.log(`Failed: ${failures}`);
  console.log('');

  if (failures > 0) {
    console.log('❌ FAILED diagrams:');
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`   ${r.file} — ${r.diagram}`);
      console.log(`     ${r.verdict}`);
    }
    console.log('');
    console.log('Screenshots saved to: .mermaid-screenshots/');
    console.log(
      'Tip: Consider making the diagram simpler or using a horizontal scroll layout.'
    );
    process.exit(1);
  } else {
    console.log('✅ All Mermaid diagrams are mobile-readable!');
    // Clean up screenshots on success
    rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('💥 Unexpected error:', err.message);
  process.exit(2);
});

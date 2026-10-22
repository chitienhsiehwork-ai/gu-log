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
 *   MERMAID_CHECK_MODEL — Optional. Model to use (default: DEFAULT_MODEL below).
 *   BASE_URL           — Optional. Base URL (default: http://localhost:4321).
 *
 * Exit codes:
 *   0 = All diagrams PASS
 *   1 = At least one diagram FAIL (the judge said so, or the page did not render)
 *   2 = Check incomplete: script error, or the judge could not be reached / gave
 *       no PASS-or-FAIL verdict. pre-commit only warns on this; it never blocks.
 */

import { readFileSync, existsSync, mkdirSync, rmSync, realpathSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { waitForHttpReady } from './lib/wait-for-http-ready.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const SCREENSHOT_DIR = path.join(REPO_ROOT, '.mermaid-screenshots');

// iPhone 14 viewport
const VIEWPORT = { width: 390, height: 844 };
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4321';
// Undated model ID, so no snapshot date to retire. If the model does go away,
// the judge call fails and the check ends incomplete (exit 2), not FAIL.
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MODEL = process.env.MERMAID_CHECK_MODEL || DEFAULT_MODEL;
export const EXIT = { PASS: 0, FAIL: 1, INCOMPLETE: 2 };

const JUDGE_PROMPT = `你是一個 UI/UX 品質審查員。這張圖是一個 Mermaid 圖表在 iPhone 上的截圖（390px 寬）。

請嚴格判定以下所有條件（任何一項 FAIL 就整體 FAIL）：
1. 文字是否可讀？（字體大小至少要能辨識，不能是螞蟻字）
2. 節點關係是否看得出來？（箭頭/連線清楚）
3. 整體是否有意義？（不是一坨模糊色塊）
4. 文字與背景對比度是否足夠？（特別注意：深色或彩色背景上的黑色/深色文字、手繪風格的斜線填充會進一步降低可讀性。如果需要瞇眼或費力才能讀出某個節點的文字，就是 FAIL）

回答 PASS 或 FAIL，後面附一句理由。
格式範例：
PASS: 文字清晰，對比度充足，關係明確
FAIL: 紫色背景上的黑色文字對比度不足，手繪填充線進一步干擾閱讀`;

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
 * @returns {Promise<string[]>} - Array of absolute file paths
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
    candidates = allFiles.filter((f) => f.endsWith('.mdx')).map((f) => path.join(POSTS_DIR, f));
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
    const client = new Anthropic({ timeout: 60_000 });

    // Current models think by default and thinking counts toward max_tokens,
    // so leave room for it and keep effort low for a one-line verdict.
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: 'low' },
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
    console.warn(`  ⚠️  SDK failed (${sdkError.message}), trying claude CLI fallback...`);
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
      // Claude Code refuses --dangerously-skip-permissions under root (CCC).
      // Use spawnSync with an argv array + stdin so MODEL / inputMsg never
      // hit the shell — avoids command injection when MERMAID_CHECK_MODEL
      // comes from the environment.
      const args = [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'json',
        '--model',
        MODEL,
      ];
      if (!(process.getuid && process.getuid() === 0)) {
        args.push('--dangerously-skip-permissions');
      }
      const child = spawnSync('claude', args, {
        input: inputMsg,
        encoding: 'utf-8',
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      if (child.error) throw child.error;
      if (child.status !== 0) {
        throw new Error(`claude exited with status ${child.status}`);
      }
      const result = child.stdout;

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
 * Read the judge's answer. Only an explicit PASS or FAIL counts; anything else
 * (empty, refusal, cut off) throws so it is reported as a judge error.
 */
export function parseVerdict(text) {
  const match = /^[\s*_`#>:-]*(PASS|FAIL)\b/i.exec(text ?? '');
  if (!match) {
    throw new Error(`no PASS/FAIL verdict in judge reply: ${JSON.stringify(text ?? '')}`);
  }
  return match[1].toUpperCase() === 'PASS';
}

/**
 * Judge one screenshot. A failed SDK + CLI call or an unreadable reply comes
 * back as status "error", never "fail": that is the judge breaking, not a
 * verdict on the diagram.
 */
export async function judgeDiagram(screenshotPath) {
  try {
    const verdict = (await judgeScreenshot(screenshotPath)).trim();
    return { status: parseVerdict(verdict) ? 'pass' : 'fail', verdict };
  } catch (err) {
    return { status: 'error', verdict: `JUDGE_ERROR: ${err.message}` };
  }
}

/** Any FAIL blocks; otherwise any judge error leaves the check incomplete. */
export function exitCodeFor(results) {
  if (results.some((r) => r.status === 'fail')) return EXIT.FAIL;
  if (results.some((r) => r.status === 'error')) return EXIT.INCOMPLETE;
  return EXIT.PASS;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const { files } = parseArgs();

  console.log('🔍 Mermaid Visual Quality Check');
  console.log(`   Viewport: ${VIEWPORT.width}×${VIEWPORT.height} (iPhone 14)`);
  console.log(`   Model: ${MODEL}`);
  console.log('');

  // 1. Find files with Mermaid diagrams
  const mermaidFiles = await findMermaidFiles(files.length > 0 ? files : undefined);

  if (mermaidFiles.length === 0) {
    console.log('✅ No Mermaid diagrams found in target files.');
    process.exit(0);
  }

  console.log(`📄 Found ${mermaidFiles.length} file(s) with Mermaid diagrams:`);
  for (const f of mermaidFiles) {
    const count = countMermaids(f);
    console.log(`   ${path.relative(REPO_ROOT, f)} (${count} diagram${count > 1 ? 's' : ''})`);
  }
  console.log('');

  // 2. Check API key availability
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set. Will try claude CLI fallback.');
    console.warn('   For best results: export ANTHROPIC_API_KEY=sk-ant-...');
    console.log('');
  }

  // 3. Check if dev server is running, start if needed
  let serverProcess = null;
  const serverUp = await waitForHttpReady(BASE_URL, { timeoutMs: 3_000 });

  if (!serverUp) {
    console.log('🚀 Starting dev server...');
    serverProcess = spawn('pnpm', ['run', 'dev'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      detached: true,
    });

    const ready = await waitForHttpReady(BASE_URL, { timeoutMs: 60_000 });
    if (!ready) {
      console.error('❌ Dev server failed to start within 60s');
      serverProcess.kill();
      process.exit(EXIT.INCOMPLETE);
    }
    console.log('✓ Dev server ready');
    console.log('');
  }

  // 4. Prepare screenshot directory
  if (existsSync(SCREENSHOT_DIR)) {
    rmSync(SCREENSHOT_DIR, { recursive: true });
  }
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // 5. Launch Playwright browser (imported here so a missing install is a
  // script error, exit 2, instead of a module-load crash with exit 1)
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT,
    deviceScaleFactor: 3, // Retina for crisp screenshots
    isMobile: true,
    hasTouch: true,
  });

  const results = [];

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
          const { status, verdict } = await judgeDiagram(screenshotPath);
          results.push({
            file: relPath,
            diagram: label,
            screenshot: screenshotName,
            verdict,
            status,
          });
          console.log(`   ${{ pass: '✅', fail: '❌', error: '⚠️ ' }[status]} ${verdict}`);
        }
      } catch (pageErr) {
        console.log(`   ⚠️  Page error: ${pageErr.message}`);
        results.push({
          file: relPath,
          diagram: 'N/A',
          screenshot: '',
          verdict: `PAGE_ERROR: ${pageErr.message}`,
          status: 'fail',
        });
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
  const tally = (status) => results.filter((r) => r.status === status).length;
  console.log(`Checked: ${results.length}`);
  console.log(`Passed: ${tally('pass')}`);
  console.log(`Failed: ${tally('fail')}`);
  console.log(`Judge errors (no verdict): ${tally('error')}`);
  console.log('');

  const code = exitCodeFor(results);
  if (code === EXIT.PASS) {
    console.log('✅ All Mermaid diagrams are mobile-readable!');
    // Clean up screenshots on success
    rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
  } else {
    const failed = code === EXIT.FAIL;
    console.log(failed ? '❌ FAILED diagrams:' : '⚠️  Diagrams the judge could not rate:');
    for (const r of results.filter((r) => r.status === (failed ? 'fail' : 'error'))) {
      console.log(`   ${r.file} — ${r.diagram}`);
      console.log(`     ${r.verdict}`);
    }
    console.log('');
    console.log('Screenshots saved to: .mermaid-screenshots/');
    if (failed) {
      console.log('Tip: Consider making the diagram simpler or using a horizontal scroll layout.');
    }
  }
  process.exit(code);
}

// Compare real paths: a symlinked repo path must still run main(), or the
// hook would get a silent exit 0.
const entry = process.argv[1];
if (entry && existsSync(entry) && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('💥 Unexpected error:', err.message);
    process.exit(EXIT.INCOMPLETE);
  });
}

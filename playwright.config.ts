import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4321';
const useRemoteBaseURL = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

// CCC sandboxes pre-install a pinned Chromium under PLAYWRIGHT_BROWSERS_PATH whose
// build number can lag what playwright-core wants, and the on-demand download is
// blocked by the sandbox proxy (ECONNREFUSED). When that pre-installed binary
// exists, point Chromium projects at it instead of letting Playwright resolve a
// missing build. On mac / CI (where the path is absent) executablePath stays
// undefined and Playwright's default resolution is untouched.
const preinstalledChromium = '/opt/pw-browsers/chromium';
const chromiumExecutablePath = existsSync(preinstalledChromium) ? preinstalledChromium : undefined;

const reporter = [['list']] as NonNullable<ReturnType<typeof defineConfig>['reporter']>;

try {
  await import('monocart-reporter');
  reporter.push([
    'monocart-reporter',
    {
      name: 'gu-log Coverage Report',
      outputFile: './quality/coverage/report.html',
      coverage: {
        reports: [
          ['v8'],
          ['console-details'],
          // Path is relative to outputFile's dir (quality/coverage/), not cwd —
          // the previous './quality/coverage/coverage.json' doubled the prefix.
          ['json', { file: './coverage.json' }],
        ],
        entryFilter: (entry: { url: string }) => {
          // Static build serves bundled/hashed output under /_astro/ (not the
          // /src/ paths that only exist in dev-server mode) plus first-party
          // inline <script> blocks, which V8 attributes to the page's own
          // URL — neither carries a stable path marker, but both share our
          // own origin. Match same-origin instead of hand-maintaining a
          // third-party host denylist that silently misses new embeds.
          try {
            return new URL(entry.url).origin === new URL(baseURL).origin;
          } catch {
            return true;
          }
        },
        sourceFilter: (sourcePath: string) => {
          return !sourcePath.includes('node_modules');
        },
      },
    },
  ]);
} catch {
  // Reporter is optional for local runs where devDependencies may be partial.
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter,
  use: {
    baseURL,
    trace: 'on-first-retry',
    extraHTTPHeaders: vercelBypassSecret
      ? {
          'x-vercel-protection-bypass': vercelBypassSecret,
          'x-vercel-set-bypass-cookie': 'true',
        }
      : undefined,
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          executablePath: chromiumExecutablePath,
        },
      },
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        launchOptions: { executablePath: chromiumExecutablePath },
      },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: useRemoteBaseURL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:4321',
        reuseExistingServer: !process.env.CI,
      },
});

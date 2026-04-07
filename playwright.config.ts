import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4321';
const useRemoteBaseURL = Boolean(process.env.PLAYWRIGHT_BASE_URL);

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
          ['json', { file: './quality/coverage/coverage.json' }],
        ],
        entryFilter: (entry: { url: string }) => {
          // Only measure our own code, not node_modules or external
          return entry.url.includes('/src/') || entry.url.includes('/scripts/');
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
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
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

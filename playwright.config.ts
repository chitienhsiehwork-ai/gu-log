import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    [
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
          entryFilter: (entry: any) => {
            // Only measure our own code, not node_modules or external
            return entry.url.includes('/src/') || entry.url.includes('/scripts/');
          },
          sourceFilter: (sourcePath: string) => {
            return !sourcePath.includes('node_modules');
          },
        },
      },
    ],
  ],
  use: {
    baseURL: 'http://localhost:4321',
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
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
  },
});

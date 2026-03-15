import { test as testBase, expect, type Page } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let addCoverageReport: any = null;

try {
  const monocart = await import('monocart-reporter');
  addCoverageReport = monocart.addCoverageReport;
} catch {
  // Coverage reporting is optional in local/dev environments.
}

const test = testBase.extend<{ autoTestFixture: string }>({
  autoTestFixture: [
    async ({ page }: { page: Page }, use: (arg: string) => Promise<void>) => {
      await page.addInitScript(() => {
        const hideDevToolbar = () => {
          const styleId = 'codex-hide-astro-dev-toolbar';
          if (document.getElementById(styleId)) return;

          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = 'astro-dev-toolbar { display: none !important; }';
          document.head.appendChild(style);
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', hideDevToolbar, { once: true });
        } else {
          hideDevToolbar();
        }
      });

      // Coverage API is chromium only
      const isChromium = test.info().project.use.browserName === 'chromium';

      let coverageStarted = false;
      if (isChromium) {
        try {
          await Promise.all([
            page.coverage.startJSCoverage({
              resetOnNavigation: false,
            }),
            page.coverage.startCSSCoverage({
              resetOnNavigation: false,
            }),
          ]);
          coverageStarted = true;
        } catch {
          // Coverage start failed, skip collection
        }
      }

      await use('autoTestFixture');

      if (isChromium && coverageStarted) {
        try {
          // Add timeout to prevent hanging on failed tests
          const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
          const coveragePromise = (async () => {
            const [jsCoverage, cssCoverage] = await Promise.all([
              page.coverage.stopJSCoverage(),
              page.coverage.stopCSSCoverage(),
            ]);
            return [...jsCoverage, ...cssCoverage];
          })();

          const coverageList = await Promise.race([coveragePromise, timeout]);
          if (coverageList && coverageList.length > 0 && addCoverageReport) {
            await addCoverageReport(coverageList, test.info());
          }
        } catch {
          // Coverage collection failed (page may have crashed), skip
        }
      }
    },
    {
      scope: 'test',
      auto: true,
    },
  ],
});

export { test, expect };

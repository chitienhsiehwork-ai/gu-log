import { test as testBase, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

const test = testBase.extend({
  autoTestFixture: [async ({ page }, use) => {
    // Coverage API is chromium only
    const isChromium = test.info().project.name === 'Desktop Chrome';

    let coverageStarted = false;
    if (isChromium) {
      try {
        await Promise.all([
          page.coverage.startJSCoverage({
            resetOnNavigation: false
          }),
          page.coverage.startCSSCoverage({
            resetOnNavigation: false
          })
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
            page.coverage.stopCSSCoverage()
          ]);
          return [...jsCoverage, ...cssCoverage];
        })();

        const coverageList = await Promise.race([coveragePromise, timeout]);
        if (coverageList && coverageList.length > 0) {
          await addCoverageReport(coverageList, test.info());
        }
      } catch {
        // Coverage collection failed (page may have crashed), skip
      }
    }

  }, {
    scope: 'test',
    auto: true
  }]
});

export { test, expect };

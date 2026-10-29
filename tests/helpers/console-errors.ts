import type { ConsoleMessage, Page } from '@playwright/test';

/** 收集頁面的 console error 與未捕捉的例外；忽略跟我們程式無關的第三方雜訊。 */
export function attachConsoleErrorWatcher(page: Page) {
  const errs: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        text.includes('favicon') ||
        text.includes('giscus') ||
        text.includes('Failed to load resource') ||
        text.includes('Vercel Analytics')
      ) {
        return;
      }
      errs.push(text);
    }
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  return errs;
}

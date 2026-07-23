import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

type ProjectUse = TestInfo['project']['use'] & {
  browserName?: string;
  defaultBrowserType?: string;
  isMobile?: boolean;
};

type SelectionMethod = 'mouse' | 'programmatic';

interface SelectPostTextOptions {
  characters?: number;
  method?: SelectionMethod;
}

function projectUse(testInfo: TestInfo): ProjectUse {
  return testInfo.project.use as ProjectUse;
}

export function isDesktopChromiumProject(testInfo: TestInfo): boolean {
  const use = projectUse(testInfo);
  const browserType = use.browserName ?? use.defaultBrowserType;
  return browserType === 'chromium' && !use.isMobile;
}

export function isMobileProject(testInfo: TestInfo): boolean {
  return Boolean(projectUse(testInfo).isMobile);
}

async function selectProgrammatically(page: Page, characters: number): Promise<string> {
  return page.evaluate((selectionLength) => {
    const paragraph = document.querySelector('.post-content p');
    if (!paragraph) throw new Error('No post-content paragraph found');

    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const textNode = walker.nextNode();
    if (!textNode?.textContent) throw new Error('No selectable text node found');

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(selectionLength, textNode.textContent.length));

    const selection = window.getSelection();
    if (!selection) throw new Error('Selection API unavailable');
    selection.removeAllRanges();
    selection.addRange(range);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return selection.toString().trim();
  }, characters);
}

async function selectWithMouse(page: Page, characters: number): Promise<string> {
  const textRect = await page
    .locator('.post-content p')
    .first()
    .evaluate((paragraph, length) => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      const textNode = walker.nextNode();
      if (!textNode?.textContent) throw new Error('No selectable text node found');

      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(length, textNode.textContent.length));
      const rect = range.getClientRects()[0];
      if (!rect) throw new Error('Selected text has no client rect');

      return {
        left: rect.left,
        right: rect.right,
        y: rect.top + rect.height / 2,
      };
    }, characters);

  await page.mouse.move(textRect.left + 1, textRect.y);
  await page.mouse.down();
  await page.mouse.move(Math.max(textRect.left + 2, textRect.right - 1), textRect.y);
  await page.mouse.up();

  return page.evaluate(() => window.getSelection()?.toString().trim() ?? '');
}

export async function selectPostText(
  page: Page,
  { characters = 20, method = 'programmatic' }: SelectPostTextOptions = {}
): Promise<string> {
  await expect(page.locator('.post-content p').first()).toBeVisible();

  const selectedText =
    method === 'mouse'
      ? await selectWithMouse(page, characters)
      : await selectProgrammatically(page, characters);

  if (selectedText.length < Math.min(characters, 2)) {
    throw new Error(`Text selection was too short: ${JSON.stringify(selectedText)}`);
  }
  return selectedText;
}

export async function selectPostTextAndShowPopup(
  page: Page,
  options: SelectPostTextOptions = {}
): Promise<Locator> {
  await selectPostText(page, options);
  const popup = page.locator('#ai-popup');
  await expect(popup).toBeVisible({ timeout: 3000 });
  await popup.evaluate(async (element) => {
    const animations = element
      .getAnimations()
      .filter((animation) => animation.playState !== 'finished');
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
  return popup;
}

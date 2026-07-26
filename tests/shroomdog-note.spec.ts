import { test, expect } from './fixtures';

test.describe('ShroomDogNote auto-fold', () => {
  const fixtureUrl = '/artifacts/shroomdog-note-fixture/';
  const sd26PostUrl = '/posts/sd-26-20260616-loop-engineering-at-gu-log/';

  test('GIVEN a long ShroomDogNote WHEN page loads THEN it is collapsed behind a toggle', async ({
    page,
  }) => {
    await page.goto(fixtureUrl);

    const note = page.locator('#long-note .shroomdog-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('data-collapsible', 'true');
    await expect(note).toHaveAttribute('data-collapsed', 'true');

    const toggle = note.locator('.shroomdog-note-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('展開完整 Note');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('GIVEN a collapsed ShroomDogNote WHEN reader clicks toggle THEN it expands and can collapse again', async ({
    page,
  }) => {
    await page.goto(fixtureUrl);

    const note = page.locator('#long-note .shroomdog-note');
    const toggle = note.locator('.shroomdog-note-toggle');

    await toggle.click();
    await expect(note).toHaveAttribute('data-collapsed', 'false');
    await expect(toggle).toContainText('收合 Note');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(note).toHaveAttribute('data-collapsed', 'true');
    await expect(toggle).toContainText('展開完整 Note');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('GIVEN a short ShroomDogNote WHEN page loads THEN its inactive toggle stays visually hidden', async ({
    page,
  }) => {
    await page.goto(fixtureUrl);

    const note = page.locator('#short-note .shroomdog-note');
    const toggle = note.locator('.shroomdog-note-toggle');

    await expect(note).not.toHaveAttribute('data-collapsible');
    await expect(toggle).toHaveAttribute('hidden', '');
    await expect(toggle).toBeHidden();
  });

  test('GIVEN a visible ShroomDogNote toggle THEN expanding reveals meaningful hidden content', async ({
    page,
  }) => {
    await page.goto(sd26PostUrl);

    const badToggles = await page.locator('.shroomdog-note').evaluateAll((notes) =>
      notes
        .map((note, index) => {
          const content = note.querySelector<HTMLElement>('.shroomdog-note-content');
          const toggle = note.querySelector<HTMLButtonElement>('.shroomdog-note-toggle');
          if (!content || !toggle || toggle.hidden) return null;

          const threshold = Number(
            (note as HTMLElement).dataset.collapseThreshold ||
              getComputedStyle(content)
                .getPropertyValue('--shroomdog-note-collapsed-height')
                .replace('px', '') ||
              260
          );
          const hiddenHeight = content.scrollHeight - threshold;
          return hiddenHeight >= 72
            ? null
            : {
                index,
                hiddenHeight,
                label: toggle.textContent?.trim(),
                text: content.textContent?.trim().slice(0, 80),
              };
        })
        .filter(Boolean)
    );

    expect(badToggles).toEqual([]);
  });

  test('GIVEN SD-26 on mobile with larger text WHEN page loads THEN short single-paragraph notes do not show toggles', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = 'html { font-size: 22px !important; }';
      document.head.appendChild(style);
    });
    await page.goto(sd26PostUrl);

    const visibleToggles = await page.locator('.shroomdog-note').evaluateAll((notes) =>
      notes
        .map((note, index) => {
          const content = note.querySelector<HTMLElement>('.shroomdog-note-content');
          const toggle = note.querySelector<HTMLButtonElement>('.shroomdog-note-toggle');
          if (!content || !toggle || toggle.hidden) return null;

          return {
            index,
            paragraphCount: content.querySelectorAll('p').length,
            textLength: content.textContent?.trim().length,
            scrollHeight: content.scrollHeight,
            label: toggle.textContent?.trim(),
            text: content.textContent?.trim().slice(0, 80),
          };
        })
        .filter(Boolean)
    );

    expect(visibleToggles).toEqual([]);
  });

  test('GIVEN both themes WHEN rendered THEN persona accents pass contrast and typography stays stable', async ({
    page,
  }) => {
    await page.goto(fixtureUrl);

    for (const theme of ['light', 'dark']) {
      await page.evaluate((activeTheme) => {
        document.documentElement.dataset.theme = activeTheme;
      }, theme);
      await page.waitForTimeout(500);

      const result = await page
        .locator('#long-note .shroomdog-note')
        .evaluate((note) => {
          const parseRgb = (value: string) => {
            const channels = value.match(/[\d.]+/g)!.map(Number);
            const scale = value.startsWith('color(') ? 255 : 1;
            return [
              channels[0] * scale,
              channels[1] * scale,
              channels[2] * scale,
              channels[3] ?? 1,
            ];
          };
          const composite = (foreground: number[], background: number[]) =>
            foreground
              .slice(0, 3)
              .map(
                (channel, index) =>
                  channel * foreground[3] + background[index] * (1 - foreground[3])
              );
          const luminance = (rgb: number[]) => {
            const [r, g, b] = rgb.map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const contrast = (foreground: number[], background: number[]) => {
            const fg = luminance(foreground);
            const bg = luminance(background);
            return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          };

          const noteStyle = getComputedStyle(note);
          const prefixStyle = getComputedStyle(
            note.querySelector<HTMLElement>('.shroomdog-prefix')!
          );
          const toggleStyle = getComputedStyle(
            note.querySelector<HTMLElement>('.shroomdog-note-toggle')!
          );
          const pageBackground = parseRgb(getComputedStyle(document.body).backgroundColor);
          const noteBackground = composite(parseRgb(noteStyle.backgroundColor), pageBackground);

          return {
            noteTextContrast: contrast(parseRgb(noteStyle.color), noteBackground),
            prefixContrast: contrast(parseRgb(prefixStyle.color), noteBackground),
            toggleContrast: contrast(parseRgb(toggleStyle.color), noteBackground),
            borderContrast: contrast(parseRgb(noteStyle.borderLeftColor), pageBackground),
            fontStyle: noteStyle.fontStyle,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });

      expect(result.noteTextContrast, theme).toBeGreaterThanOrEqual(4.5);
      expect(result.prefixContrast, theme).toBeGreaterThanOrEqual(4.5);
      expect(result.toggleContrast, theme).toBeGreaterThanOrEqual(4.5);
      expect(result.borderContrast, theme).toBeGreaterThanOrEqual(3);
      expect(result.fontStyle, theme).toBe('normal');
      expect(result.overflow, theme).toBe(0);
    }
  });
});

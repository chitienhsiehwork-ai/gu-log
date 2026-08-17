import { test, expect } from '@playwright/test';

const POST = '/posts/gp-275-20260817-article-qwen-3-8-27b/';

function channelToLinear(channel: number) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string) {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${color}`);
  const [red, green, blue] = channels.map(channelToLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const theme of ['dark', 'light'] as const) {
  test(`post links distinguish internal and external destinations in ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript(
      (selectedTheme) => localStorage.setItem('theme', selectedTheme),
      theme
    );
    await page.goto(POST);

    const colors = await page.evaluate(() => {
      const content = document.querySelector('.post-content');
      const internal = content?.querySelector<HTMLAnchorElement>('a[href="/glossary#pi"]');
      const external = content?.querySelector<HTMLAnchorElement>('a[href="https://pi.dev/"]');
      const noteInternal = content?.querySelector<HTMLAnchorElement>(
        '[data-mogu-note] a[href^="/posts/gp-141"]'
      );
      const moguPrefix = content?.querySelector<HTMLAnchorElement>('.mogu-prefix-link');
      if (!content || !internal || !external || !noteInternal || !moguPrefix) {
        throw new Error('Link color fixtures are missing');
      }

      const noteExternal = external.cloneNode(true) as HTMLAnchorElement;
      noteInternal.parentElement?.append(noteExternal);

      return {
        internal: getComputedStyle(internal).color,
        external: getComputedStyle(external).color,
        background: getComputedStyle(document.body).backgroundColor,
        noteInternal: getComputedStyle(noteInternal).color,
        noteExternal: getComputedStyle(noteExternal).color,
        noteBackground: getComputedStyle(noteInternal.closest('[data-mogu-note]')!).backgroundColor,
        internalKind: internal.dataset.linkKind,
        externalKind: external.dataset.linkKind,
        externalMarker: external
          .querySelector('.external-link-marker')
          ?.textContent?.replaceAll('\u2060', ''),
        externalMarkerHidden: external
          .querySelector('.external-link-marker')
          ?.getAttribute('aria-hidden'),
        moguPrefix: getComputedStyle(moguPrefix).color,
        moguPrefixParent: getComputedStyle(moguPrefix.parentElement!).color,
        moguPrefixDecoration: getComputedStyle(moguPrefix).textDecorationLine,
        internalDecoration: getComputedStyle(internal).textDecorationLine,
        externalDecoration: getComputedStyle(external).textDecorationLine,
      };
    });

    expect(colors.internal).not.toBe(colors.external);
    expect(colors.internalKind).toBe('internal');
    expect(colors.externalKind).toBe('external');
    expect(colors.externalMarker).toBe('↗');
    expect(colors.externalMarkerHidden).toBe('true');
    expect(colors.internalDecoration).toContain('underline');
    expect(colors.externalDecoration).toBe('none');
    expect(contrast(colors.internal, colors.background)).toBeGreaterThanOrEqual(5);
    expect(contrast(colors.external, colors.background)).toBeGreaterThanOrEqual(5);
    expect(contrast(colors.noteInternal, colors.noteBackground)).toBeGreaterThanOrEqual(5);
    expect(contrast(colors.noteExternal, colors.noteBackground)).toBeGreaterThanOrEqual(5);
    expect(colors.noteInternal).not.toBe(colors.noteExternal);
    expect(colors.moguPrefix).toBe(colors.moguPrefixParent);
    expect(colors.moguPrefixDecoration).toBe('none');

    const external = page.locator('.post-content a[href="https://pi.dev/"]').last();
    await external.hover();
    await expect(external).toHaveCSS('text-decoration-line', 'underline');

    const orphanWidths = await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.className = 'post-content';
      fixture.style.cssText = 'position:fixed;left:-1000px;top:0;font-size:16px;';
      const link = document.createElement('a');
      link.dataset.linkKind = 'external';
      const label = document.createTextNode('external destination');
      const marker = document.createElement('span');
      marker.className = 'external-link-marker';
      marker.ariaHidden = 'true';
      marker.textContent = '\u2060↗';
      link.append(label, marker);
      fixture.append(link);
      document.body.append(fixture);

      const lastCharacter = document.createRange();
      lastCharacter.setStart(label, label.length - 1);
      lastCharacter.setEnd(label, label.length);
      fixture.style.width = '1000px';
      const sameLineOffset =
        marker.getBoundingClientRect().top - lastCharacter.getBoundingClientRect().top;
      const failures: number[] = [];
      for (let width = 80; width <= 260; width += 2) {
        fixture.style.width = `${width}px`;
        const currentOffset =
          marker.getBoundingClientRect().top - lastCharacter.getBoundingClientRect().top;
        if (Math.abs(currentOffset - sameLineOffset) > 2) {
          failures.push(width);
        }
      }
      fixture.remove();
      return failures;
    });
    expect(orphanWidths).toEqual([]);
  });
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('human signal UI wiring', () => {
  it('article pages pass a version snapshot into read and share controls', () => {
    for (const path of ['src/pages/posts/[...slug].astro', 'src/pages/en/posts/[...slug].astro']) {
      const src = read(path);
      expect(src).toContain('postId={legacyPostId}');
      expect(src).toContain('ticketId={post.data.ticketId}');
      expect(src).toContain('postVersion={Number(postVersion)}');
      expect(src).toContain('pathname={Astro.url.pathname}');
    }
  });

  it('read and share components expose snapshot fields and record human-signal events', () => {
    const readStatus = read('src/components/ReadStatusButton.astro');
    expect(readStatus).toContain('data-post-id={postId}');
    expect(readStatus).toContain('data-post-version={postVersion}');
    expect(readStatus).toContain('recordManualMarkRead');
    expect(readStatus).toContain('recordReadFinish');
    expect(readStatus).toContain('recordReadAbandonCandidate');
    expect(readStatus).toContain('pagehide');
    expect(readStatus).toContain('document.visibilityState');
    expect(readStatus).toContain('lastActivityAt');
    expect(readStatus).toContain('FINISH_SCROLL_GUARD_PERCENT');
    expect(readStatus).not.toContain('Date.now() - startedAt');

    const share = read('src/components/ShareButton.astro');
    expect(share).toContain('data-post-id={postId}');
    expect(share).toContain('data-post-version={postVersion}');
    expect(share).toContain('recordShareIntent');
  });

  it('rebrand controls keep accessible focus, touch targets, and theme-owned colors', () => {
    const globalCss = read('src/styles/global.css');
    const share = read('src/components/ShareButton.astro');
    const toc = read('src/components/TableOfContents.astro');
    const search = read('src/components/SearchBar.astro');
    const moguNote = read('src/components/MoguNote.astro');

    expect(globalCss).toContain('--color-on-accent:');
    expect(share).toContain('color: var(--color-on-accent)');
    expect(share).toContain('min-height: 44px');
    expect(globalCss).toContain('.toggle-container .toggle-header:focus-visible');
    expect(globalCss).toMatch(/\.toggle-container \.toggle-header\s*\{[\s\S]*?min-height: 44px/);
    expect(toc).toContain('.toc-toggle-header:focus-visible');
    expect(toc).toContain('.toc-link:focus-visible');
    expect(search).toMatch(/\.search-modal-input\s*\{[\s\S]*?min-height: 44px/);
    expect(search).not.toMatch(/rgba\(/);
    for (const series of ['sd', 'gp', 'mp', 'lv']) {
      expect(globalCss).toMatch(
        new RegExp(
          String.raw`\.ticket-wrapper \.ticket-${series}\s*\{[\s\S]*?background-color: var\(--color-badge-${series}-bg\);[\s\S]*?color: var\(--color-badge-${series}\);[\s\S]*?border: 1px solid var\(--color-badge-${series}-border`
        )
      );
    }
    expect(moguNote).toContain('background: var(--color-mogu-murmur-bg)');
  });
});

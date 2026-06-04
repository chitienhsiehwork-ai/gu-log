import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('human signal UI wiring', () => {
  it('article pages pass a version snapshot into read and share controls', () => {
    for (const path of ['src/pages/posts/[...slug].astro', 'src/pages/en/posts/[...slug].astro']) {
      const src = read(path);
      expect(src).toContain('postId={post.id}');
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
});

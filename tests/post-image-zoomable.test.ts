import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync('src/components/PostImage.astro', 'utf8');

describe('PostImage zoomable image contract', () => {
  it('renders an accessible inline open control and modal-style expanded view', () => {
    const component = source();

    expect(component).toContain('data-post-image-open');
    expect(component).toContain('aria-haspopup="dialog"');
    expect(component).toContain('role="dialog"');
    expect(component).toContain('aria-modal="true"');
    expect(component).toContain('aria-label={closeLabel}');
    expect(component).toContain('figcaption id={captionId}');
  });

  it('localizes visible zoom labels for en pages instead of hardcoding zh-tw', () => {
    const component = source();

    expect(component).toContain("Astro.url.pathname.startsWith('/en/')");
    expect(component).toContain("'Click to enlarge'");
    expect(component).toContain('點擊放大');
  });

  it('preserves native iPhone pinch zoom instead of blocking touch gestures', () => {
    const component = source();

    expect(component).toContain('touch-action: pan-x pan-y pinch-zoom');
    expect(component).not.toContain('touch-action: none');
    expect(component).not.toContain('preventDefault()');
  });

  it('loads the high-resolution expanded image lazily on open', () => {
    const component = source();

    expect(component).toContain('data-full-src={fullSrc}');
    expect(component).toContain('if (fullSrc && !expandedImage.src) expandedImage.src = fullSrc;');
    expect(component).toContain('loading="lazy"');
    expect(component).toContain('decoding="async"');
  });

  it('keeps keyboard focus and close behavior safe', () => {
    const component = source();

    expect(component).toContain('previousFocus');
    expect(component).toContain("event.key === 'Escape'");
    expect(component).toContain('previousFocus?.focus({ preventScroll: true })');
    expect(component).toContain('width: 44px');
    expect(component).toContain('height: 44px');
    expect(component).toContain('env(safe-area-inset-top');
  });
});

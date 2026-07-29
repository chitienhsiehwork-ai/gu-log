import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentUrl = new URL('../src/components/TableOfContents.astro', import.meta.url);
const runtimeUrl = new URL('../src/components/table-of-contents-client.js', import.meta.url);

describe('TableOfContents shared runtime budget', () => {
  it("ships its runtime through Vite's forced-external asset contract", () => {
    const component = readFileSync(componentUrl, 'utf8');

    expect(component).toContain(
      "import tocRuntimeUrl from './table-of-contents-client.js?url&no-inline';"
    );
    expect(component).toContain('<script is:inline type="module" src={tocRuntimeUrl}></script>');
    expect(component).not.toContain('function initTableOfContents');
    expect(existsSync(runtimeUrl)).toBe(true);

    const runtime = readFileSync(runtimeUrl, 'utf8');
    expect(runtime).toContain("document.querySelector('.toc-container')");
    expect(runtime).toContain("tocContainer.querySelectorAll('.toc-link')");
    expect(runtime).not.toContain("document.querySelectorAll('.toc-link')");
    expect(runtime).toContain("document.addEventListener('astro:page-load'");
    expect(runtime).toContain("window.addEventListener('scroll'");
    expect(runtime).toContain("window.addEventListener('pageshow'");
    expect(runtime).toContain("window.addEventListener('hashchange'");
    expect(runtime).toContain("window.addEventListener('resize'");
    expect(runtime).toContain("link.removeEventListener('click'");
    expect(runtime).toContain('window.clearTimeout(timeoutId)');
    expect(runtime).toContain("toggleHeader.removeEventListener('click'");
  });
});

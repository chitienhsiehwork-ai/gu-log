import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentUrl = new URL('../src/components/AiPopup.astro', import.meta.url);
const runtimeUrl = new URL('../src/components/ai-popup-client.js', import.meta.url);

describe('AiPopup shared runtime budget', () => {
  it('ships the data-driven runtime as one processed local script', () => {
    const component = readFileSync(componentUrl, 'utf8');

    expect(component).toContain('<script src="./ai-popup-client.js"></script>');
    expect(component).not.toContain('<script is:inline>');
    expect(component).not.toContain("let currentState = 'idle'");
    expect(existsSync(runtimeUrl)).toBe(true);

    const runtime = readFileSync(runtimeUrl, 'utf8');
    expect(runtime).toContain("const root = document.getElementById('ai-popup-root');");
    expect(runtime).toContain("root.getAttribute('data-file-path')");
    expect(runtime).toContain("root.getAttribute('data-post-title')");
    expect(runtime).toContain("root.getAttribute('data-api-url')");
    expect(runtime).toContain("root.getAttribute('data-lang')");
  });
});
